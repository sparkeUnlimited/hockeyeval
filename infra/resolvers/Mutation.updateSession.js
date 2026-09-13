import { util } from "@aws-appsync/utils";
import {
  tryoutPK, sessionSK, requireAdmin, requireId, requireText, requireDate, requireSessionType, requireJersey,
  toSession, failOnError,
} from "./shared.js";

// Partial update of a session: only the provided fields are changed.
export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const sessionId = requireId(ctx.args.sessionId, "sessionId");
  const sets = [];
  const names = {};
  const values = {};
  if (ctx.args.label !== null && ctx.args.label !== undefined) {
    sets.push("#label = :label"); names["#label"] = "label"; values[":label"] = requireText(ctx.args.label, "label", 60);
  }
  if (ctx.args.date !== null && ctx.args.date !== undefined) {
    sets.push("#date = :date"); names["#date"] = "date"; values[":date"] = requireDate(ctx.args.date);
  }
  if (ctx.args.type !== null && ctx.args.type !== undefined) {
    sets.push("#type = :type"); names["#type"] = "type"; values[":type"] = requireSessionType(ctx.args.type);
  }
  if (ctx.args.jersey !== null && ctx.args.jersey !== undefined) {
    sets.push("#jersey = :jersey"); names["#jersey"] = "jersey"; values[":jersey"] = requireJersey(ctx.args.jersey);
  }
  if (sets.length === 0) util.error("Nothing to update", "BadRequest");
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: sessionSK(sessionId) }),
    update: { expression: `SET ${sets.join(", ")}`, expressionNames: names, expressionValues: util.dynamodb.toMapValues(values) },
    condition: { expression: "attribute_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toSession(ctx.result);
}
