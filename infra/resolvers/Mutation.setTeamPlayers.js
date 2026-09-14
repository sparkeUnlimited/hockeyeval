import { util } from "@aws-appsync/utils";
import { tryoutPK, teamSK, requireAdmin, requireId, requirePlayerList, toTeam, failOnError } from "./shared.js";

// Replace the roster (list of playerNumbers). Empty list empties the team.
export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const teamId = requireId(ctx.args.teamId, "teamId");
  const players = requirePlayerList(ctx.args.players);
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: teamSK(teamId) }),
    update: {
      expression: "SET #players = :players",
      expressionNames: { "#players": "players" },
      expressionValues: util.dynamodb.toMapValues({ ":players": players }),
    },
    condition: { expression: "attribute_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toTeam(ctx.result);
}
