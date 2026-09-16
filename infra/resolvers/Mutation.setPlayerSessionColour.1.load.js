// Step 1: load the session and the caller's access row; evaluators must be enabled on the tryout (admins always may).
import { util } from "@aws-appsync/utils";
import { TABLE_NAME, tryoutPK, sessionSK, evaluatorSK, isAdmin, requireSub, requireId, requirePlayerNumber, optionalColour, failOnError } from "./shared.js";

export function request(ctx) {
  const sub = requireSub(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const sessionId = requireId(ctx.args.sessionId, "sessionId");
  requirePlayerNumber(ctx.args.playerNumber);
  optionalColour(ctx.args.colour);
  const pk = tryoutPK(tryoutId);
  return {
    operation: "BatchGetItem",
    tables: { [TABLE_NAME]: { keys: [util.dynamodb.toMapValues({ PK: pk, SK: sessionSK(sessionId) }), util.dynamodb.toMapValues({ PK: pk, SK: evaluatorSK(sub) })], consistentRead: true } },
  };
}

export function response(ctx) {
  failOnError(ctx);
  const rows = (ctx.result.data && ctx.result.data[TABLE_NAME]) || [];
  let session = null;
  let access = null;
  for (const r of rows) {
    if (r && r.SK.startsWith("SESSION#")) session = r;
    else if (r && r.SK.startsWith("EVALUATOR#")) access = r;
  }
  if (!session) util.error("Session not found", "NotFound");
  if (!isAdmin(ctx) && (!access || access.enabled === false)) util.error("You are not an enabled evaluator on this tryout", "Forbidden");
  ctx.stash.colours = session.colours || {};
  return true;
}
