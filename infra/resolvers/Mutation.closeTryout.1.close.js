import { util } from "@aws-appsync/utils";
import { tryoutPK, requireAdmin, requireId, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  ctx.stash.tryoutId = tryoutId;
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: "META" }),
    update: {
      expression: "SET #s = :closed, closedAt = :now",
      expressionNames: { "#s": "status" },
      expressionValues: util.dynamodb.toMapValues({ ":closed": "closed", ":now": util.time.nowISO8601() }),
    },
    condition: { expression: "attribute_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return ctx.result;
}
