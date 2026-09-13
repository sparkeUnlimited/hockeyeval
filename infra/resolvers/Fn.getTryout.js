// Pipeline function: Query PK = TRYOUT#<ctx.stash.tryoutId> (META, sessions, players, evaluator access), return the assembled Tryout.
// Shared by currentTryout and closeTryout.
import { util, runtime } from "@aws-appsync/utils";
import { tryoutPK, assembleTryout, failOnError } from "./shared.js";

export function request(ctx) {
  if (!ctx.stash.tryoutId) return runtime.earlyReturn(null);
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
  const sub = ctx.identity && ctx.identity.sub ? ctx.identity.sub : null;
  return assembleTryout(ctx.stash.tryoutId, ctx.result.items || [], sub);
}
