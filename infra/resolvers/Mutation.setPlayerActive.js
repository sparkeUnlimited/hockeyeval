import { util } from "@aws-appsync/utils";
import { tryoutPK, playerSK, requireAdmin, requireId, requirePlayerNumber, toPlayer, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const playerNumber = requirePlayerNumber(ctx.args.playerNumber);
  const active = ctx.args.active === true;
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: playerSK(playerNumber) }),
    update: {
      expression: "SET active = :active",
      expressionValues: util.dynamodb.toMapValues({ ":active": active }),
    },
    condition: { expression: "attribute_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toPlayer(ctx.result);
}
