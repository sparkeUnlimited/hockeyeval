import { runtime } from "@aws-appsync/utils";
import { CONFIG_PK, CURRENT_TRYOUT_SK, ddbGet, failOnError } from "./shared.js";

export function request(ctx) {
  return ddbGet(CONFIG_PK, CURRENT_TRYOUT_SK);
}

export function response(ctx) {
  failOnError(ctx);
  if (!ctx.result || !ctx.result.tryoutId) return runtime.earlyReturn(null);
  ctx.stash.tryoutId = ctx.result.tryoutId;
  return ctx.result.tryoutId;
}
