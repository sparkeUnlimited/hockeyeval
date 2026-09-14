import { util } from "@aws-appsync/utils";
import { tryoutPK, teamSK, requireAdmin, requireId, failOnError } from "./shared.js";

// Sessions that still reference the team simply lose it (clients ignore unknown team ids).
export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const teamId = requireId(ctx.args.teamId, "teamId");
  return {
    operation: "DeleteItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: teamSK(teamId) }),
  };
}

export function response(ctx) {
  failOnError(ctx);
  return ctx.args.teamId;
}
