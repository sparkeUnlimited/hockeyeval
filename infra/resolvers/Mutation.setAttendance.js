import { util } from "@aws-appsync/utils";
import { tryoutPK, sessionSK, requireAdmin, requireId, requirePlayerNumber, toSession, failOnError } from "./shared.js";

const STATUSES = ["present", "absent", "sitting"];

// Move the player between the session's `absent` and `sitting` string sets (present = in neither). Idempotent.
export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const sessionId = requireId(ctx.args.sessionId, "sessionId");
  const playerNumber = requirePlayerNumber(ctx.args.playerNumber);
  const status = ctx.args.status;
  if (!STATUSES.includes(status)) util.error("status must be present, absent or sitting", "BadRequest");
  let expression = "DELETE #absent :p, #sitting :p";
  if (status === "absent") expression = "ADD #absent :p DELETE #sitting :p";
  if (status === "sitting") expression = "ADD #sitting :p DELETE #absent :p";
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: sessionSK(sessionId) }),
    update: {
      expression,
      expressionNames: { "#absent": "absent", "#sitting": "sitting" },
      expressionValues: { ":p": util.dynamodb.toStringSet([playerNumber]) },
    },
    condition: { expression: "attribute_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toSession(ctx.result);
}
