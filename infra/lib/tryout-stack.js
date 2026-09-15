import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import { bundleResolver } from "./bundle.js";

const TABLE_NAME = "TryoutTable"; // must match infra/resolvers/shared.js (BatchGetItem/BatchPutItem need the physical name)
const here = import.meta.dirname;

export class TryoutStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // ------------------------------------------------------------------ Cognito
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "tryout-evaluator",
      selfSignUpEnabled: false, // admin creates every account
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      // Deliberately no "name" / "given_name" attributes: the app never stores anyone's name.
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: false,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(14),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OFF,
      // Passwordless: evaluators sign in with an emailed one-time code. Password stays enabled as a fallback
      // (CLI-created accounts, scripts). Essentials tier is required for email OTP.
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      signInPolicy: { allowedFirstAuthFactors: { password: true, emailOtp: true } },
      removalPolicy: RemovalPolicy.RETAIN,
      userInvitation: {
        emailSubject: "Your tryout evaluator login",
        emailBody:
          "You have been added as a tryout evaluator. Sign in with {username} and the temporary password {####}. " +
          "You will be asked to choose a new password the first time you sign in.",
      },
    });

    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: "tryout-web",
      generateSecret: false,
      // USER_AUTH is the choice-based flow (EMAIL_OTP or PASSWORD). No SRP library needed in the browser.
      authFlows: { user: true },
      preventUserExistenceErrors: true,
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
    });

    new cognito.CfnUserPoolGroup(this, "AdminGroup", {
      userPoolId: userPool.userPoolId, groupName: "admin", description: "Convenor: full access, by number only",
    });
    new cognito.CfnUserPoolGroup(this, "EvaluatorGroup", {
      userPoolId: userPool.userPoolId, groupName: "evaluator", description: "Evaluator: own scores only",
    });

    // ------------------------------------------------------------------ DynamoDB
    const table = new dynamodb.Table(this, "Table", {
      tableName: TABLE_NAME,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // GSI1: all evaluations for one player across sessions/evaluators; also lists evaluator profiles (GSI1PK = USERS)
    table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // GSI2: all evaluations for a tryout (optionally one session) in a single paginated query for the admin
    table.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ------------------------------------------------------------------ S3: exports (private)
    const exportsBucket = new s3.Bucket(this, "ExportsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: Duration.days(400) }],
      cors: [{
        allowedMethods: [s3.HttpMethods.PUT],
        allowedOrigins: ["*"], // presigned URL is the authorisation; tightened to the CloudFront URL in the README
        allowedHeaders: ["content-type"],
        maxAge: 300,
      }],
    });

    // ------------------------------------------------------------------ Lambda (admin ops only)
    const adminFn = new lambda.Function(this, "AdminOpsFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "admin-ops.handler",
      code: lambda.Code.fromAsset(path.join(here, "..", "lambda")),
      timeout: Duration.seconds(15),
      memorySize: 256,
      logGroup: new logs.LogGroup(this, "AdminOpsFnLogs", { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        TABLE_NAME: table.tableName,
        EXPORTS_BUCKET: exportsBucket.bucketName,
      },
      description: "createEvaluator / deleteEvaluator (Cognito) and exportUrl (S3 presign)",
    });
    adminFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:AdminCreateUser", "cognito-idp:AdminAddUserToGroup",
        "cognito-idp:AdminDeleteUser", "cognito-idp:ListUsers",
      ],
      resources: [userPool.userPoolArn],
    }));
    table.grant(adminFn, "dynamodb:PutItem", "dynamodb:DeleteItem");
    exportsBucket.grantPut(adminFn, "exports/*");

    // ------------------------------------------------------------------ AppSync
    const apiLogRole = new iam.Role(this, "ApiLogRole", {
      assumedBy: new iam.ServicePrincipal("appsync.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSAppSyncPushToCloudWatchLogs")],
    });

    const api = new appsync.GraphqlApi(this, "Api", {
      name: "tryout-evaluator",
      definition: appsync.Definition.fromFile(path.join(here, "..", "schema.graphql")),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: { userPool, defaultAction: appsync.UserPoolDefaultAction.ALLOW },
        },
      },
      // Errors only, and never request/response bodies (excludeVerboseContent). Notes must not land in logs.
      logConfig: {
        fieldLogLevel: appsync.FieldLogLevel.ERROR,
        excludeVerboseContent: true,
        role: apiLogRole,
        retention: logs.RetentionDays.ONE_MONTH,
      },
      xrayEnabled: false,
      introspectionConfig: appsync.IntrospectionConfig.DISABLED,
      queryDepthLimit: 5,
    });

    const tableDs = api.addDynamoDbDataSource("TableDs", table);
    const lambdaDs = api.addLambdaDataSource("AdminOpsDs", adminFn);
    const noneDs = api.addNoneDataSource("NoneDs");

    const JS = appsync.FunctionRuntime.JS_1_0_0;
    const code = (file) => appsync.Code.fromAsset(bundleResolver(file));
    const fn = (name, ds, file) => new appsync.AppsyncFunction(this, `Fn${name}`, {
      name, api, dataSource: ds, runtime: JS, code: code(file),
    });
    const unit = (typeName, fieldName, ds, file) => api.createResolver(`${typeName}${fieldName}Resolver`, {
      typeName, fieldName, dataSource: ds, runtime: JS, code: code(file),
    });
    const pipeline = (typeName, fieldName, fns) => api.createResolver(`${typeName}${fieldName}Resolver`, {
      typeName, fieldName, runtime: JS, code: code("Pipeline.passthrough.js"), pipelineConfig: fns,
    });

    const getTryoutFn = fn("GetTryout", tableDs, "Fn.getTryout.js");

    // Queries
    pipeline("Query", "currentTryout", [fn("GetCurrentPointer", tableDs, "Query.currentTryout.1.getPointer.js"), getTryoutFn]);
    unit("Query", "myEvaluations", tableDs, "Query.myEvaluations.js");
    unit("Query", "allEvaluations", tableDs, "Query.allEvaluations.js");
    unit("Query", "evaluators", tableDs, "Query.evaluators.js");

    // Mutations
    pipeline("Mutation", "upsertEvaluation", [
      fn("LoadEvalContext", tableDs, "Mutation.upsertEvaluation.1.loadContext.js"),
      fn("CheckTeam", tableDs, "Mutation.upsertEvaluation.1b.checkTeam.js"),
      fn("PutEvaluation", tableDs, "Mutation.upsertEvaluation.2.put.js"),
    ]);
    unit("Mutation", "createTryout", tableDs, "Mutation.createTryout.js");
    pipeline("Mutation", "addSession", [fn("CountSessions", tableDs, "Mutation.addSession.1.count.js"), fn("PutSession", tableDs, "Mutation.addSession.2.put.js")]);
    unit("Mutation", "updateSession", tableDs, "Mutation.updateSession.js");
    unit("Mutation", "upsertPlayers", tableDs, "Mutation.upsertPlayers.js");
    unit("Mutation", "setPlayerActive", tableDs, "Mutation.setPlayerActive.js");
    unit("Mutation", "updatePlayer", tableDs, "Mutation.updatePlayer.js");
    unit("Mutation", "setAttendance", tableDs, "Mutation.setAttendance.js");
    unit("Mutation", "setSessionColours", tableDs, "Mutation.setSessionColours.js");
    unit("Mutation", "createTeam", tableDs, "Mutation.createTeam.js");
    unit("Mutation", "updateTeam", tableDs, "Mutation.updateTeam.js");
    unit("Mutation", "deleteTeam", tableDs, "Mutation.deleteTeam.js");
    unit("Mutation", "setTeamPlayers", tableDs, "Mutation.setTeamPlayers.js");
    unit("Mutation", "setSessionTeams", tableDs, "Mutation.setSessionTeams.js");
    pipeline("Mutation", "deletePlayer", [fn("CheckNoScores", tableDs, "Mutation.deletePlayer.1.checkNoScores.js"), fn("DeletePlayer", tableDs, "Mutation.deletePlayer.2.delete.js")]);
    unit("Mutation", "setEvaluatorAccess", tableDs, "Mutation.setEvaluatorAccess.js");
    pipeline("Mutation", "closeTryout", [fn("CloseTryout", tableDs, "Mutation.closeTryout.1.close.js"), getTryoutFn]);
    unit("Mutation", "createEvaluator", lambdaDs, "Lambda.adminOps.js");
    unit("Mutation", "deleteEvaluator", lambdaDs, "Lambda.adminOps.js");
    unit("Mutation", "exportUrl", lambdaDs, "Lambda.adminOps.js");
    void noneDs;

    // ------------------------------------------------------------------ Web hosting: S3 + CloudFront (OAC)
    const webBucket = new s3.Bucket(this, "WebBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [{ header: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()", override: true }],
      },
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "tryout-evaluator web",
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: "/404.html", ttl: Duration.minutes(1) },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: "/404.html", ttl: Duration.minutes(1) },
      ],
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // ------------------------------------------------------------------ Outputs (consumed by scripts/deploy.sh)
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "GraphqlUrl", { value: api.graphqlUrl });
    new CfnOutput(this, "Region", { value: this.region });
    new CfnOutput(this, "WebBucketName", { value: webBucket.bucketName });
    new CfnOutput(this, "ExportsBucketName", { value: exportsBucket.bucketName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "CloudFrontUrl", { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, "TableName", { value: table.tableName });
  }
}
