#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TryoutStack } from "../lib/tryout-stack.js";

const app = new cdk.App();
new TryoutStack(app, "TryoutEvaluator", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ca-central-1",
  },
  description: "Hockey tryout evaluation app: Cognito, DynamoDB, AppSync (JS resolvers), S3 + CloudFront",
});
