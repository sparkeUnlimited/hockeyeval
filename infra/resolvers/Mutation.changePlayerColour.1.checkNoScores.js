// Step 1: a player with scores keeps their code (release them and add the new code instead).
import { util } from "@aws-appsync/utils";
import { evalGSI1PK, requireAdmin, requireId, requirePlayerNumber, requireColour, makePlayerNumber, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const playerNumber = requirePlayerNumber(ctx.args.playerNumber);
  requireColour(ctx.args.colour);
  return {
    operation: "Query",
    index: "GSI1",
    query: { expression: "GSI1PK = :pk", expressionValues: util.dynamodb.toMapValues({ ":pk": evalGSI1PK(tryoutId, playerNumber) }) },
    select: "COUNT",
    limit: 1,
  };
}

export function response(ctx) {
  failOnError(ctx);
  const items = ctx.result.items || [];
  const count = typeof ctx.result.scannedCount === "number" ? ctx.result.scannedCount : items.length;
  if (count > 0) util.error("This player already has scores, so their code cannot change. Release them and add the new code.", "HasScores");
  return count;
}
