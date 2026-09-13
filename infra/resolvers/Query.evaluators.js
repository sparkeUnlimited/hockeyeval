import { util } from "@aws-appsync/utils";
import { USERS_GSI1PK, requireAdmin, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  return {
    operation: "Query",
    index: "GSI1",
    query: {
      expression: "GSI1PK = :pk",
      expressionValues: util.dynamodb.toMapValues({ ":pk": USERS_GSI1PK }),
    },
    limit: 500,
  };
}

export function response(ctx) {
  failOnError(ctx);
  const items = ctx.result.items || [];
  return items.map((it) => ({ id: it.userId, displayName: it.displayName, role: it.role || "evaluator" }));
}
