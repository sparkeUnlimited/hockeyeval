// Registers a synchronous module resolution hook so that resolvers' `import ... from "@aws-appsync/utils"`
// resolves to our Node mock, then exposes helpers to load a resolver and build a ctx.
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_URL = pathToFileURL(path.join(here, "appsync-mock.js")).href;
const RESOLVERS = path.resolve(here, "..", "..", "infra", "resolvers");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@aws-appsync/utils") return { url: MOCK_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

export async function loadResolver(fileName) {
  return import(pathToFileURL(path.join(RESOLVERS, fileName)).href);
}

/** Build an AppSync-like ctx. */
export function ctx({ args = {}, identity, stash = {}, result, prev, error, info } = {}) {
  return {
    args,
    arguments: args,
    identity: identity === null ? null : identity ?? evaluatorIdentity(),
    stash,
    result,
    prev: prev ?? { result: undefined },
    error,
    info: info ?? { fieldName: "test" },
  };
}

export const EVALUATOR_SUB = "11111111-aaaa-4bbb-8ccc-000000000001";
export const OTHER_SUB = "22222222-aaaa-4bbb-8ccc-000000000002";
export const ADMIN_SUB = "33333333-aaaa-4bbb-8ccc-000000000003";

export function evaluatorIdentity(sub = EVALUATOR_SUB) {
  return { sub, username: sub, groups: ["evaluator"], claims: { sub } };
}
export function adminIdentity(sub = ADMIN_SUB) {
  return { sub, username: sub, groups: ["admin"], claims: { sub } };
}

export { fromMapValues, AppSyncError, EarlyReturn } from "./appsync-mock.js";
