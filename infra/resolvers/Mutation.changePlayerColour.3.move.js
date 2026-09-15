// Step 3: put the row under the new code and delete the old one, atomically. Fails if the new code exists.
import { util } from "@aws-appsync/utils";
import { TABLE_NAME, tryoutPK, playerSK, requireColour, makePlayerNumber, toPlayer, failOnError } from "./shared.js";

export function request(ctx) {
  const old = ctx.stash.player;
  const colour = requireColour(ctx.args.colour);
  const playerNumber = makePlayerNumber(colour, old.number);
  if (playerNumber === old.playerNumber) util.error("That is already the player's colour", "BadRequest");
  const pk = tryoutPK(ctx.args.tryoutId);
  const item = {
    tryoutId: old.tryoutId, playerNumber, colour, colour2: old.colour2 || null, number: old.number,
    position: old.position, active: old.active !== false, tag: old.tag || null,
  };
  ctx.stash.moved = item;
  return {
    operation: "TransactWriteItems",
    transactItems: [
      {
        table: TABLE_NAME, operation: "PutItem",
        key: util.dynamodb.toMapValues({ PK: pk, SK: playerSK(playerNumber) }),
        attributeValues: util.dynamodb.toMapValues(item),
        condition: { expression: "attribute_not_exists(PK)" },
      },
      { table: TABLE_NAME, operation: "DeleteItem", key: util.dynamodb.toMapValues({ PK: pk, SK: playerSK(old.playerNumber) }) },
    ],
  };
}

export function response(ctx) {
  if (ctx.error && ctx.error.type && ctx.error.type.indexOf("TransactionCanceled") >= 0) {
    util.error(`A player with code ${ctx.stash.moved.playerNumber} already exists`, "Conflict");
  }
  failOnError(ctx);
  return toPlayer(ctx.stash.moved);
}
