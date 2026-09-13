// Step 2: sanitize and write the evaluation. Same evaluator + session + player overwrites (upsert).
import { util } from "@aws-appsync/utils";
import {
  evalPK, playerSK, evalGSI1PK, evalGSI1SK, evalGSI2PK, evalGSI2SK,
  requireSub, sanitizeScores, sanitizeTier, sanitizeNotes, toEvaluation, failOnError,
} from "./shared.js";

export function request(ctx) {
  // evaluatorId comes from the verified token, never from the client.
  const sub = requireSub(ctx);
  const { tryoutId, sessionId, playerNumber, clientId } = ctx.args;
  const position = ctx.stash.position;
  if (!position) util.error("Player position unknown", "InternalError");

  const scores = sanitizeScores(position, ctx.args.scores);
  const tier = sanitizeTier(ctx.args.tier);
  const notes = sanitizeNotes(ctx.args.notes);
  const updatedAt = util.time.nowISO8601();

  const item = {
    tryoutId,
    sessionId,
    playerNumber,
    evaluatorId: sub,
    position,
    scores,
    tier,
    notes,
    clientId,
    updatedAt,
    GSI1PK: evalGSI1PK(tryoutId, playerNumber),
    GSI1SK: evalGSI1SK(sessionId, sub),
    GSI2PK: evalGSI2PK(tryoutId),
    GSI2SK: evalGSI2SK(sessionId, sub, playerNumber),
  };
  return {
    operation: "PutItem",
    key: util.dynamodb.toMapValues({ PK: evalPK(tryoutId, sessionId, sub), SK: playerSK(playerNumber) }),
    attributeValues: util.dynamodb.toMapValues(item),
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toEvaluation(ctx.result);
}
