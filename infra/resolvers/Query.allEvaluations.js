import { util } from "@aws-appsync/utils";
import { evalGSI2PK, requireAdmin, requireId, toEvaluation, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const sessionId = ctx.args.sessionId ? requireId(ctx.args.sessionId, "sessionId") : null;
  const values = { ":pk": evalGSI2PK(tryoutId) };
  let expression = "GSI2PK = :pk";
  if (sessionId) {
    expression = "GSI2PK = :pk AND begins_with(GSI2SK, :sk)";
    values[":sk"] = `SESSION#${sessionId}#`;
  }
  const req = {
    operation: "Query",
    index: "GSI2",
    query: { expression, expressionValues: util.dynamodb.toMapValues(values) },
    limit: 1000,
  };
  if (ctx.args.nextToken) req.nextToken = ctx.args.nextToken;
  return req;
}

export function response(ctx) {
  failOnError(ctx);
  const items = ctx.result.items || [];
  return { items: items.map(toEvaluation), nextToken: ctx.result.nextToken || null };
}
