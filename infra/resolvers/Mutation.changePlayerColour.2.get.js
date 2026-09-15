// Step 2: read the current player row so every attribute moves with the code.
import { util } from "@aws-appsync/utils";
import { tryoutPK, playerSK, failOnError } from "./shared.js";

export function request(ctx) {
  return { operation: "GetItem", key: util.dynamodb.toMapValues({ PK: tryoutPK(ctx.args.tryoutId), SK: playerSK(ctx.args.playerNumber) }) };
}

export function response(ctx) {
  failOnError(ctx);
  if (!ctx.result) util.error("Player not found", "NotFound");
  ctx.stash.player = ctx.result;
  return ctx.result.playerNumber;
}
