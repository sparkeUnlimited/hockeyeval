// Before/after handlers for pipeline resolvers: nothing to do, return the last function's result.
export function request(ctx) {
  return {};
}

export function response(ctx) {
  return ctx.prev.result;
}
