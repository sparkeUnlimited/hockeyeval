import { util } from "@aws-appsync/utils";
import { tryoutPK, sessionSK, requireAdmin, requireId, requirePlayerNumber, toSession, failOnError } from "./shared.js";

// Add to / remove from the session's `absent` string set. Idempotent either way.
export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const sessionId = requireId(ctx.args.sessionId, "sessionId");
  const playerNumber = requirePlayerNumber(ctx.args.playerNumber);
  const present = ctx.args.present === true;
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: sessionSK(sessionId) }),
    update: {
      expression: present ? "DELETE #absent :p" : "ADD #absent :p",
      expressionNames: { "#absent": "absent" },
      expressionValues: { ":p": util.dynamodb.toStringSet([playerNumber]) },
    },
    condition: { expression: "attribute_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toSession(ctx.result);
}
