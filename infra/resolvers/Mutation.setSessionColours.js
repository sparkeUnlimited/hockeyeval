import { util } from "@aws-appsync/utils";
import { tryoutPK, sessionSK, requireAdmin, requireId, sanitizeColourMap, toSession, failOnError } from "./shared.js";

// Replace the per-player jersey colours for one session (skills: forwards one colour, defence another;
// scrimmage: team colours regardless of position). Players not in the map fall back to the session's jersey default.
export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const sessionId = requireId(ctx.args.sessionId, "sessionId");
  const colours = sanitizeColourMap(ctx.args.colours);
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: sessionSK(sessionId) }),
    update: {
      expression: "SET #colours = :colours",
      expressionNames: { "#colours": "colours" },
      expressionValues: util.dynamodb.toMapValues({ ":colours": colours }),
    },
    condition: { expression: "attribute_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toSession(ctx.result);
}
