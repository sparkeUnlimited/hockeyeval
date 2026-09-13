// Step 1: fetch tryout META, the session, the player and the caller's access row in one BatchGetItem, then validate.
import { util } from "@aws-appsync/utils";
import {
  TABLE_NAME, tryoutPK, sessionSK, playerSK, evaluatorSK,
  requireId, requirePlayerNumber, requireSub, failOnError,
} from "./shared.js";

export function request(ctx) {
  const sub = requireSub(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const sessionId = requireId(ctx.args.sessionId, "sessionId");
  const playerNumber = requirePlayerNumber(ctx.args.playerNumber);
  requireId(ctx.args.clientId, "clientId");
  const pk = tryoutPK(tryoutId);
  const keys = [
    { PK: pk, SK: "META" },
    { PK: pk, SK: sessionSK(sessionId) },
    { PK: pk, SK: playerSK(playerNumber) },
    { PK: pk, SK: evaluatorSK(sub) },
  ];
  return {
    operation: "BatchGetItem",
    tables: {
      [TABLE_NAME]: { keys: keys.map((k) => util.dynamodb.toMapValues(k)), consistentRead: true },
    },
  };
}

export function response(ctx) {
  failOnError(ctx);
  const rows = (ctx.result.data && ctx.result.data[TABLE_NAME]) || [];
  let meta = null;
  let session = null;
  let player = null;
  let access = null;
  for (const r of rows) {
    if (r && r.SK === "META") meta = r;
    else if (r && r.SK.startsWith("SESSION#")) session = r;
    else if (r && r.SK.startsWith("PLAYER#")) player = r;
    else if (r && r.SK.startsWith("EVALUATOR#")) access = r;
  }
  if (!meta) util.error("Tryout not found", "NotFound");
  if (meta.status !== "open") util.error("Tryout is closed", "TryoutClosed");
  // Allowlist: the caller must have been added to this tryout by the admin and not be disabled.
  if (!access || access.enabled === false) util.error("You are not an enabled evaluator on this tryout", "Forbidden");
  if (!session) util.error("Session not found", "NotFound");
  if (!player) util.error("Player not found", "NotFound");
  ctx.stash.position = player.position;
  return { position: player.position };
}
