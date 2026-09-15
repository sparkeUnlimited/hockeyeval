// Step 1: read the session so the cap can depend on its type (skills: one group; scrimmage/game: two teams).
import { util } from "@aws-appsync/utils";
import { tryoutPK, sessionSK, requireAdmin, requireId, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const sessionId = requireId(ctx.args.sessionId, "sessionId");
  return { operation: "GetItem", key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: sessionSK(sessionId) }) };
}

export function response(ctx) {
  failOnError(ctx);
  if (!ctx.result) util.error("Session not found", "NotFound");
  ctx.stash.sessionType = ctx.result.type || "skills";
  return ctx.stash.sessionType;
}
