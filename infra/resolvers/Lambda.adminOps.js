// Used for createEvaluator, deleteEvaluator and exportUrl. The Lambda re-checks the admin group.
// Only the field name, the arguments and the caller's sub/groups are forwarded.
import { util } from "@aws-appsync/utils";
import { requireAdmin, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  return {
    operation: "Invoke",
    payload: {
      field: ctx.info.fieldName,
      args: ctx.args,
      identity: { sub: ctx.identity.sub, groups: ctx.identity.groups },
    },
  };
}

export function response(ctx) {
  failOnError(ctx);
  const r = ctx.result;
  if (r && r.errorMessage) util.error(r.errorMessage, r.errorType || "LambdaError");
  return r;
}
