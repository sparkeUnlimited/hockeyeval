import { util } from "@aws-appsync/utils";
import { evalPK, requireId, requireSub, toEvaluation, failOnError } from "./shared.js";

export function request(ctx) {
  // The evaluator id is ALWAYS the caller's own identity. There is no way to ask for another evaluator's rows.
  const sub = requireSub(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const sessionId = requireId(ctx.args.sessionId, "sessionId");
  return {
    operation: "Query",
    query: {
      expression: "PK = :pk",
      expressionValues: util.dynamodb.toMapValues({ ":pk": evalPK(tryoutId, sessionId, sub) }),
    },
    limit: 1000,
    consistentRead: true,
  };
}

export function response(ctx) {
  failOnError(ctx);
  const items = ctx.result.items || [];
  return items.map(toEvaluation);
}
