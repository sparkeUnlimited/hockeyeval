// Pipeline function: Query PK = TRYOUT#<ctx.stash.tryoutId>, return the assembled Tryout.
// Shared by currentTryout and closeTryout.
import { util } from "@aws-appsync/utils";
import { tryoutPK, assembleTryout, failOnError } from "./shared.js";

export function request(ctx) {
  return {
    operation: "Query",
    query: {
      expression: "PK = :pk",
      expressionValues: util.dynamodb.toMapValues({ ":pk": tryoutPK(ctx.stash.tryoutId) }),
    },
    limit: 1000,
    consistentRead: true,
  };
}

export function response(ctx) {
  failOnError(ctx);
  return assembleTryout(ctx.stash.tryoutId, ctx.result.items || []);
}
