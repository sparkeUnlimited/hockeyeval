// Step 2: write the session's colour map with this one player changed (blank colour removes the entry).
import { util } from "@aws-appsync/utils";
import { tryoutPK, sessionSK, optionalColour, toSession, failOnError } from "./shared.js";

export function request(ctx) {
  const colour = optionalColour(ctx.args.colour);
  const next = {};
  const existing = ctx.stash.colours || {};
  for (const k of Object.keys(existing)) {
    if (k !== ctx.args.playerNumber) next[k] = existing[k];
  }
  if (colour) next[ctx.args.playerNumber] = colour;
  return {
    operation: "UpdateItem",
    key: util.dynamodb.toMapValues({ PK: tryoutPK(ctx.args.tryoutId), SK: sessionSK(ctx.args.sessionId) }),
    update: { expression: "SET #colours = :colours", expressionNames: { "#colours": "colours" }, expressionValues: util.dynamodb.toMapValues({ ":colours": next }) },
    condition: { expression: "attribute_exists(PK)" },
  };
}

export function response(ctx) {
  failOnError(ctx);
  return toSession(ctx.result);
}
