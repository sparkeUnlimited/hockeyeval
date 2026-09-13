// Step 1: count the tryout's existing sessions so the new one gets order = count + 1.
// (order is a GraphQL Int, so it must stay small; never store a timestamp here.)
import { util } from "@aws-appsync/utils";
import { tryoutPK, requireAdmin, requireId, requireText, requireDate, requireSessionType, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  requireText(ctx.args.label, "label", 60);
  requireDate(ctx.args.date);
  requireSessionType(ctx.args.type);
  return {
    operation: "Query",
    query: {
      expression: "PK = :pk AND begins_with(SK, :sk)",
      expressionValues: util.dynamodb.toMapValues({ ":pk": tryoutPK(tryoutId), ":sk": "SESSION#" }),
    },
    select: "COUNT",
    limit: 1000,
    consistentRead: true,
  };
}

export function response(ctx) {
  failOnError(ctx);
  const items = ctx.result.items || [];
  const count = typeof ctx.result.scannedCount === "number" ? ctx.result.scannedCount : items.length;
  ctx.stash.order = count + 1;
  return ctx.stash.order;
}
