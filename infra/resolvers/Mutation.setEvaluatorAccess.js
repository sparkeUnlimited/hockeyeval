import { util } from "@aws-appsync/utils";
import { tryoutPK, evaluatorSK, requireAdmin, requireId, toEvaluatorAccess, failOnError } from "./shared.js";

// Upsert the allowlist row TRYOUT#<id> / EVALUATOR#<sub>. enabled=false keeps the row but blocks writes.
export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const evaluatorId = requireId(ctx.args.evaluatorId, "evaluatorId");
  const enabled = ctx.args.enabled === true;
  return {
    operation: "PutItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: evaluatorSK(evaluatorId) }),
    attributeValues: util.dynamodb.toMapValues({ tryoutId, evaluatorId, enabled, updatedAt: util.time.nowISO8601() }),
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toEvaluatorAccess(ctx.result);
}
