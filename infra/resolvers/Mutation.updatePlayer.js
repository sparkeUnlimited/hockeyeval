import { util } from "@aws-appsync/utils";
import { tryoutPK, playerSK, requireAdmin, requireId, requirePlayerNumber, requirePosition, optionalColour, toPlayer, failOnError } from "./shared.js";

// Partial update: position and/or secondary colour. Pass colour2 = "" to clear it.
export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const playerNumber = requirePlayerNumber(ctx.args.playerNumber);
  const sets = [];
  const names = {};
  const values = {};
  if (ctx.args.position !== null && ctx.args.position !== undefined) {
    sets.push("#position = :position"); names["#position"] = "position"; values[":position"] = requirePosition(ctx.args.position);
  }
  if (ctx.args.colour2 !== null && ctx.args.colour2 !== undefined) {
    sets.push("#colour2 = :colour2"); names["#colour2"] = "colour2"; values[":colour2"] = optionalColour(ctx.args.colour2);
  }
  if (sets.length === 0) util.error("Nothing to update", "BadRequest");
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: playerSK(playerNumber) }),
    update: { expression: `SET ${sets.join(", ")}`, expressionNames: names, expressionValues: util.dynamodb.toMapValues(values) },
    condition: { expression: "attribute_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toPlayer(ctx.result);
}
