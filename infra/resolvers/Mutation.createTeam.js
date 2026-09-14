import { util } from "@aws-appsync/utils";
import { tryoutPK, teamSK, requireAdmin, requireId, requireTeamName, toTeam, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const name = requireTeamName(ctx.args.name);
  const teamId = util.autoId();
  return {
    operation: "PutItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: teamSK(teamId) }),
    attributeValues: util.dynamodb.toMapValues({ tryoutId, teamId, name, players: [], createdAt: util.time.nowISO8601() }),
    condition: { expression: "attribute_not_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toTeam(ctx.result);
}
