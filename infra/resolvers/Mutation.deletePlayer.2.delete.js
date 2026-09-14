// Step 2: delete the player row.
import { util } from "@aws-appsync/utils";
import { tryoutPK, playerSK, requireAdmin, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  return {
    operation: "DeleteItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(ctx.args.tryoutId), SK: playerSK(ctx.args.playerNumber) }),
    condition: { expression: "attribute_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return ctx.args.playerNumber;
}
