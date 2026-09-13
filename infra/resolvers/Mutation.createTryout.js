import { util } from "@aws-appsync/utils";
import { TABLE_NAME, CONFIG_PK, CURRENT_TRYOUT_SK, tryoutPK, requireAdmin, requireText, failOnError } from "./shared.js";

export function request(ctx) {
  requireAdmin(ctx);
  const name = requireText(ctx.args.name, "name", 80);
  const season = requireText(ctx.args.season, "season", 20);
  const id = util.autoId();
  const createdAt = util.time.nowISO8601();
  // Nobody is allowed to score a new tryout until the admin adds them (setEvaluatorAccess).
  ctx.stash.tryout = { id, name, season, status: "open", createdAt, sessions: [], players: [], canEvaluate: false, evaluatorAccess: [] };
  return {
    operation: "TransactWriteItems",
    transactItems: [
      {
        table: TABLE_NAME,
        operation: "PutItem",
        key: util.dynamodb.toMapValues({ PK: tryoutPK(id), SK: "META" }),
        attributeValues: util.dynamodb.toMapValues({ tryoutId: id, name, season, status: "open", createdAt }),
      },
      {
        table: TABLE_NAME,
        operation: "PutItem",
        key: util.dynamodb.toMapValues({ PK: CONFIG_PK, SK: CURRENT_TRYOUT_SK }),
        attributeValues: util.dynamodb.toMapValues({ tryoutId: id, updatedAt: createdAt }),
      },
    ],
  };
}

export function response(ctx) {
  failOnError(ctx);
  return ctx.stash.tryout;
}
