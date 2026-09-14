import { util } from "@aws-appsync/utils";
import { tryoutPK, sessionSK, requireAdmin, requireId, requireSessionTeams, toSession, failOnError } from "./shared.js";

// Replace the list of teams (with colours) on the ice for a session. Empty list = everyone plays.
export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const sessionId = requireId(ctx.args.sessionId, "sessionId");
  const teams = requireSessionTeams(ctx.args.teams || []);
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: sessionSK(sessionId) }),
    update: {
      expression: "SET #teams = :teams",
      expressionNames: { "#teams": "teams" },
      expressionValues: util.dynamodb.toMapValues({ ":teams": teams }),
    },
    condition: { expression: "attribute_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toSession(ctx.result);
}
