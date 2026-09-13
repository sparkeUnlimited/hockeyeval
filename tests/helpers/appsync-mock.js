// Minimal Node implementation of the parts of the APPSYNC_JS `util` / `runtime` API our
// resolvers use. The published @aws-appsync/utils package is type definitions only, so tests
// register a module hook that redirects "@aws-appsync/utils" to this file.
import { randomUUID } from "node:crypto";

export class AppSyncError extends Error {
  constructor(message, type, data) {
    super(message);
    this.name = "AppSyncError";
    this.type = type || "Error";
    this.data = data;
  }
}
export class EarlyReturn extends Error {
  constructor(value) { super("earlyReturn"); this.name = "EarlyReturn"; this.value = value; }
}

function toAttr(v) {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === "string") return { S: v };
  if (typeof v === "number") return { N: String(v) };
  if (typeof v === "boolean") return { BOOL: v };
  if (Array.isArray(v)) return { L: v.map(toAttr) };
  if (typeof v === "object") return { M: toMapValues(v) };
  throw new Error(`Unsupported value ${typeof v}`);
}
function toMapValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toAttr(v);
  return out;
}

export const util = {
  autoId: () => randomUUID(),
  error(message, type, data) { throw new AppSyncError(message, type, data); },
  unauthorized() { throw new AppSyncError("Unauthorized", "Unauthorized"); },
  appendError() {},
  matches(pattern, value) { return new RegExp(pattern).test(value); },
  dynamodb: { toMapValues, toDynamoDB: toAttr },
  time: {
    nowISO8601: () => new Date().toISOString(),
    nowEpochMilliSeconds: () => Date.now(),
    nowEpochSeconds: () => Math.floor(Date.now() / 1000),
  },
};

export const runtime = {
  earlyReturn(value) { throw new EarlyReturn(value); },
};

/** Decode a DynamoDB AttributeValue map back to plain JS (for assertions). */
export function fromMapValues(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) out[k] = fromAttr(v);
  return out;
}
function fromAttr(a) {
  if ("S" in a) return a.S;
  if ("N" in a) return Number(a.N);
  if ("BOOL" in a) return a.BOOL;
  if ("NULL" in a) return null;
  if ("L" in a) return a.L.map(fromAttr);
  if ("M" in a) return fromMapValues(a.M);
  return undefined;
}
