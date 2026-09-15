import { util } from "@aws-appsync/utils";
import { USERS_GSI1PK, requireAdmin, requireSub, requireText, failOnError } from "./shared.js";

// Convenor scoring: write a profile row for the caller's own sub (role admin) so they show in the
// evaluator lists and can be added to the tryout like anyone else. Idempotent (overwrites the label).
export function request(ctx) {
  requireAdmin(ctx);
  const sub = requireSub(ctx);
  const displayName = requireText(ctx.args.displayName, "displayName", 40);
  return {
    operation: "PutItem",
    key: util.dynamodb.toMapValues({ PK: `USER#${sub}`, SK: "META" }),
    attributeValues: util.dynamodb.toMapValues({
      GSI1PK: USERS_GSI1PK, GSI1SK: `USER#${sub}`, userId: sub, displayName, role: "admin", createdAt: util.time.nowISO8601(),
    }),
  };
}

export function response(ctx) {
  failOnError(ctx);
  return { id: ctx.result.userId, displayName: ctx.result.displayName, role: ctx.result.role || "admin" };
}
