import { util } from "@aws-appsync/utils";
import { tryoutPK, teamSK, requireAdmin, requireId, requireTeamName, optionalColour, toTeam, failOnError } from "./shared.js";

// Partial update: name and/or colour. colour = "" clears it.
export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const teamId = requireId(ctx.args.teamId, "teamId");
  const sets = [];
  const names = {};
  const values = {};
  if (ctx.args.name !== null && ctx.args.name !== undefined) {
    sets.push("#name = :name"); names["#name"] = "name"; values[":name"] = requireTeamName(ctx.args.name);
  }
  if (ctx.args.colour !== null && ctx.args.colour !== undefined) {
    sets.push("#colour = :colour"); names["#colour"] = "colour"; values[":colour"] = optionalColour(ctx.args.colour);
  }
  if (sets.length === 0) util.error("Nothing to update", "BadRequest");
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: teamSK(teamId) }),
    update: { expression: `SET ${sets.join(", ")}`, expressionNames: names, expressionValues: util.dynamodb.toMapValues(values) },
    condition: { expression: "attribute_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toTeam(ctx.result);
}
