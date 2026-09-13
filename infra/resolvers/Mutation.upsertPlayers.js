import { util } from "@aws-appsync/utils";
import {
  TABLE_NAME, tryoutPK, playerSK, makePlayerNumber,
  requireAdmin, requireId, requireColour, optionalColour, requireNumber, requirePosition, toPlayer, failOnError,
} from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const input = ctx.args.players || [];
  if (input.length === 0) util.error("No players given", "BadRequest");
  if (input.length > 25) util.error("Send at most 25 players per call", "BadRequest");
  const seen = {};
  const items = [];
  for (const p of input) {
    const colour = requireColour(p.colour);
    const colour2 = optionalColour(p.colour2);
    const number = requireNumber(p.number);
    const position = requirePosition(p.position);
    const playerNumber = makePlayerNumber(colour, number);
    if (seen[playerNumber]) util.error(`Duplicate player ${playerNumber}`, "BadRequest");
    seen[playerNumber] = true;
    items.push(util.dynamodb.toMapValues({
      PK: tryoutPK(tryoutId),
      SK: playerSK(playerNumber),
      tryoutId,
      playerNumber,
      colour,
      colour2,
      number,
      position,
      active: p.active !== false,
    }));
  }
  return { operation: "BatchPutItem", tables: { [TABLE_NAME]: items } };
}

export function response(ctx) {
  failOnError(ctx);
  const rows = (ctx.result.data && ctx.result.data[TABLE_NAME]) || [];
  return rows.map(toPlayer);
}
