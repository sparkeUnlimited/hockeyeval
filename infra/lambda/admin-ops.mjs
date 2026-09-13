// The only Lambda in the system. Handles three admin-only AppSync fields that cannot be done
// from a JS resolver: createEvaluator / deleteEvaluator (Cognito) and exportUrl (S3 presign).
// Logging policy: never log the event payload. Log field name and error codes only.
import {
  CognitoIdentityProviderClient, AdminCreateUserCommand, AdminAddUserToGroupCommand,
  AdminDeleteUserCommand, ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient, PutItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const cognito = new CognitoIdentityProviderClient({});
const ddb = new DynamoDBClient({});
const s3 = new S3Client({});

const { USER_POOL_ID, TABLE_NAME, EXPORTS_BUCKET } = process.env;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
const DISPLAY_NAME_RE = /^[A-Za-z0-9 _.-]{1,40}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILENAME_RE = /^[A-Za-z0-9._-]{1,80}\.csv$/;

class ClientError extends Error {
  constructor(message, type = "BadRequest") { super(message); this.errorType = type; }
}

export const handler = async (event) => {
  const field = event?.field;
  try {
    const groups = event?.identity?.groups || [];
    if (!groups.includes("admin")) throw new ClientError("Admin only", "Unauthorized");
    switch (field) {
      case "createEvaluator": return await createEvaluator(event.args || {});
      case "deleteEvaluator": return await deleteEvaluator(event.args || {});
      case "exportUrl": return await exportUrl(event.args || {});
      default: throw new ClientError(`Unknown field ${String(field)}`);
    }
  } catch (err) {
    const type = err.errorType || err.name || "LambdaError";
    console.error(JSON.stringify({ field, errorType: type })); // no payload, no message text
    return { errorMessage: err instanceof ClientError ? err.message : friendly(err), errorType: type };
  }
};

function friendly(err) {
  switch (err?.name) {
    case "UsernameExistsException": return "An account with that email already exists";
    case "InvalidParameterException": return "Invalid email address";
    case "UserNotFoundException": return "Evaluator not found";
    default: return "Request failed";
  }
}

async function createEvaluator({ email, displayName }) {
  if (typeof email !== "string" || !EMAIL_RE.test(email)) throw new ClientError("Invalid email");
  if (typeof displayName !== "string" || !DISPLAY_NAME_RE.test(displayName.trim())) {
    throw new ClientError("displayName must be 1-40 letters, digits, spaces, . _ -");
  }
  const name = displayName.trim();
  const created = await cognito.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: email.toLowerCase(),
    UserAttributes: [
      { Name: "email", Value: email.toLowerCase() },
      { Name: "email_verified", Value: "true" },
    ],
    DesiredDeliveryMediums: ["EMAIL"],
  }));
  const username = created.User.Username;
  const sub = created.User.Attributes.find((a) => a.Name === "sub")?.Value || username;
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: username, GroupName: "evaluator" }));
  await ddb.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: { S: `USER#${sub}` }, SK: { S: "META" },
      GSI1PK: { S: "USERS" }, GSI1SK: { S: `USER#${sub}` },
      userId: { S: sub }, displayName: { S: name }, role: { S: "evaluator" },
      createdAt: { S: new Date().toISOString() },
    },
  }));
  return { id: sub, displayName: name, role: "evaluator" };
}

async function deleteEvaluator({ id }) {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new ClientError("Invalid id");
  const found = await cognito.send(new ListUsersCommand({ UserPoolId: USER_POOL_ID, Filter: `sub = "${id}"`, Limit: 1 }));
  const user = found.Users?.[0];
  if (user) {
    const isAdmin = false; // we never delete admins from here; admins are managed with the AWS CLI
    if (!isAdmin) await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: user.Username }));
  }
  await ddb.send(new DeleteItemCommand({ TableName: TABLE_NAME, Key: { PK: { S: `USER#${id}` }, SK: { S: "META" } } }));
  return id;
}

async function exportUrl({ tryoutId, filename }) {
  if (typeof tryoutId !== "string" || !ID_RE.test(tryoutId)) throw new ClientError("Invalid tryoutId");
  if (typeof filename !== "string" || !FILENAME_RE.test(filename)) {
    throw new ClientError("filename must end in .csv and contain only letters, digits, . _ -");
  }
  const day = new Date().toISOString().slice(0, 10);
  const key = `exports/${tryoutId}/${day}/${filename}`;
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: EXPORTS_BUCKET, Key: key, ContentType: "text/csv" }),
    { expiresIn: 300 },
  );
}
