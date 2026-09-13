import { CONFIG_PK, CURRENT_TRYOUT_SK, ddbGet, failOnError } from "./shared.js";

export function request(ctx) {
  return ddbGet(CONFIG_PK, CURRENT_TRYOUT_SK);
}

export function response(ctx) {
  failOnError(ctx);
  // No tryout yet: leave stash.tryoutId unset; the next function early-returns null.
  const tryoutId = ctx.result && ctx.result.tryoutId ? ctx.result.tryoutId : null;
  if (tryoutId) ctx.stash.tryoutId = tryoutId;
  return tryoutId;
}
