// Step 1: refuse to delete a player who already has evaluations (GSI1 lists them all). Release them instead.
import { util } from "@aws-appsync/utils";
import { evalGSI1PK, requireAdmin, requireId, requirePlayerNumber, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const playerNumber = requirePlayerNumber(ctx.args.playerNumber);
  return {
    operation: "Query",
    index: "GSI1",
    query: {
      expression: "GSI1PK = :pk",
      expressionValues: util.dynamodb.toMapValues({ ":pk": evalGSI1PK(tryoutId, playerNumber) }),
    },
    select: "COUNT",
    limit: 1,
  };
}

export function response(ctx) {
  failOnError(ctx);
  const items = ctx.result.items || [];
  const count = typeof ctx.result.scannedCount === "number" ? ctx.result.scannedCount : items.length;
  if (count > 0) util.error("This player already has scores. Release them instead of deleting.", "HasScores");
  return count;
}
