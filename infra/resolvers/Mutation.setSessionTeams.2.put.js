import { util } from "@aws-appsync/utils";
import { tryoutPK, sessionSK, requireAdmin, requireId, requireSessionTeams, toSession, failOnError } from "./shared.js";

// Step 2: replace the list of teams (with colours) on the ice for a session. Empty list = everyone plays.
// A skills session takes one group; scrimmages and games take two teams (full ice).
export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const sessionId = requireId(ctx.args.sessionId, "sessionId");
  const teams = requireSessionTeams(ctx.args.teams || []);
  const skills = ctx.stash.sessionType === "skills";
  if (skills && teams.length > 1) util.error("A skills session has one group on the ice", "BadRequest");
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
