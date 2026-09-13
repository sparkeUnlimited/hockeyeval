import { util } from "@aws-appsync/utils";
import { tryoutPK, sessionSK, requireAdmin, requireId, requireText, requireDate, requireSessionType, toSession, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  const tryoutId = requireId(ctx.args.tryoutId, "tryoutId");
  const label = requireText(ctx.args.label, "label", 60);
  const date = requireDate(ctx.args.date);
  const type = requireSessionType(ctx.args.type);
  const sessionId = util.autoId();
  const order = util.time.nowEpochMilliSeconds();
  return {
    operation: "PutItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(tryoutId), SK: sessionSK(sessionId) }),
    attributeValues: util.dynamodb.toMapValues({ tryoutId, sessionId, label, date, type, order }),
    condition: { expression: "attribute_not_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toSession(ctx.result);
}
