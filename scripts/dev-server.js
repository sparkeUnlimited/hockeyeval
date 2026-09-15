#!/usr/bin/env node
// Local dev server: serves web/ and a mock GraphQL backend that runs the REAL resolver code
// (infra/resolvers/*.js) against an in-memory DynamoDB. Auth is mocked (see web/js/auth.js mock mode).
//
//   node scripts/dev-server.js [--port 8787] [--seed]
//
// Sign in with any email: addresses starting with "admin" are admins, everything else is an evaluator.
// Nothing here is deployed. Use scripts/deploy.sh for AWS.
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadResolver, fromMapValues, AppSyncError, EarlyReturn } from "../tests/helpers/load-resolver.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf("--port") + 1] || 0) || Number(process.env.PORT) || 8787;
const SEED = args.includes("--seed");
const TABLE = "TryoutTable";

// ----------------------------------------------------------------------------- In-memory DynamoDB
const db = new Map(); // "PK|SK" -> item
const k = (PK, SK) => `${PK}|${SK}`;
const INDEX_KEYS = { GSI1: ["GSI1PK", "GSI1SK"], GSI2: ["GSI2PK", "GSI2SK"] };

function condFail() { const e = new Error("The conditional request failed"); e.type = "DynamoDB:ConditionalCheckFailedException"; throw e; }
function checkCondition(cond, existing) {
  if (!cond) return;
  const m = cond.expression.match(/^attribute_(exists|not_exists)\((\w+)\)$/);
  if (!m) throw new Error(`mock: unsupported condition ${cond.expression}`);
  if (m[1] === "exists" && !existing) condFail();
  if (m[1] === "not_exists" && existing) condFail();
}
function applyUpdate(item, update) {
  const values = fromMapValues(update.expressionValues || {});
  const names = update.expressionNames || {};
  let m = update.expression.match(/^SET (.+)$/);
  if (m) {
    for (const clause of m[1].split(",")) {
      const [lhs, rhs] = clause.split("=").map((s) => s.trim());
      item[names[lhs] || lhs] = values[rhs];
    }
    return item;
  }
  m = update.expression.match(/^(ADD|DELETE) (\S+) (:\w+)$/); // string-set add/remove
  if (m) {
    const attr = names[m[2]] || m[2];
    const set = new Set(item[attr] || []);
    for (const v of values[m[3]]) (m[1] === "ADD" ? set.add(v) : set.delete(v));
    if (set.size) item[attr] = [...set]; else delete item[attr];
    return item;
  }
  throw new Error(`mock: unsupported update ${update.expression}`);
}
async function execute(req) {
  switch (req.operation) {
    case "GetItem": { const key = fromMapValues(req.key); return db.get(k(key.PK, key.SK)) || null; }
    case "PutItem": {
      const key = fromMapValues(req.key); const existing = db.get(k(key.PK, key.SK));
      checkCondition(req.condition, existing);
      const item = { ...key, ...fromMapValues(req.attributeValues || {}) }; db.set(k(key.PK, key.SK), item); return item;
    }
    case "UpdateItem": {
      const key = fromMapValues(req.key); const existing = db.get(k(key.PK, key.SK));
      checkCondition(req.condition, existing);
      const item = applyUpdate({ ...(existing || key) }, req.update); db.set(k(key.PK, key.SK), item); return item;
    }
    case "DeleteItem": {
      const key = fromMapValues(req.key); const existing = db.get(k(key.PK, key.SK));
      checkCondition(req.condition, existing);
      db.delete(k(key.PK, key.SK)); return existing || null;
    }
    case "DeleteItem": {
      const key = fromMapValues(req.key); const existing = db.get(k(key.PK, key.SK));
      checkCondition(req.condition, existing);
      db.delete(k(key.PK, key.SK)); return existing || null;
    }
    case "Query": {
      const values = fromMapValues(req.query.expressionValues);
      const m = req.query.expression.match(/^(\w+) = :(\w+)(?: AND begins_with\((\w+), :(\w+)\))?$/);
      if (!m) throw new Error(`mock: unsupported query ${req.query.expression}`);
      const [, pkName, pkVar, skName, skVar] = m;
      const [, skAttr] = INDEX_KEYS[req.index] || ["PK", "SK"];
      const items = [...db.values()].filter((it) => it[pkName] === values[`:${pkVar}`] && (!skName || String(it[skName] || "").startsWith(values[`:${skVar}`])))
        .sort((a, b) => String(a[skAttr]).localeCompare(String(b[skAttr])));
      return { items, nextToken: null, scannedCount: items.length };
    }
    case "BatchGetItem": {
      const keys = req.tables[TABLE].keys.map(fromMapValues);
      return { data: { [TABLE]: keys.map((key) => db.get(k(key.PK, key.SK)) || null) } };
    }
    case "BatchPutItem": {
      const items = req.tables[TABLE].map(fromMapValues);
      for (const it of items) db.set(k(it.PK, it.SK), it);
      return { data: { [TABLE]: items } };
    }
    case "TransactWriteItems": {
      const keys = [];
      for (const t of req.transactItems) { // check all conditions first (all-or-nothing)
        const key = fromMapValues(t.key);
        try { checkCondition(t.condition, db.get(k(key.PK, key.SK))); }
        catch (e) { const err = new Error("Transaction cancelled, please refer cancellation reasons for specific reasons"); err.type = "DynamoDB:TransactionCanceledException"; throw err; }
      }
      for (const t of req.transactItems) {
        const key = fromMapValues(t.key);
        if (t.operation === "PutItem") db.set(k(key.PK, key.SK), { ...key, ...fromMapValues(t.attributeValues || {}) });
        else if (t.operation === "DeleteItem") db.delete(k(key.PK, key.SK));
        keys.push(key);
      }
      return { keys };
    }
    case "Invoke": return mockLambda(req.payload);
    default: throw new Error(`mock: unsupported operation ${req.operation}`);
  }
}

// ----------------------------------------------------------------------------- Mock Lambda (admin ops)
const subFor = (email) => "mock-" + email.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40); // must match web/js/auth.js
let origin = `http://localhost:${PORT}`;
function mockLambda({ field, args: a, identity }) {
  if (!identity?.groups?.includes("admin")) return { errorMessage: "Admin only", errorType: "Unauthorized" };
  if (field === "createEvaluator") {
    if (!/^[^\s@]+@[^\s@]+$/.test(a.email)) return { errorMessage: "Invalid email", errorType: "BadRequest" };
    const sub = subFor(a.email);
    if (db.has(k(`USER#${sub}`, "META"))) return { errorMessage: "An account with that email already exists", errorType: "BadRequest" };
    db.set(k(`USER#${sub}`, "META"), { PK: `USER#${sub}`, SK: "META", GSI1PK: "USERS", GSI1SK: `USER#${sub}`, userId: sub, displayName: a.displayName.trim(), role: "evaluator" });
    return { id: sub, displayName: a.displayName.trim(), role: "evaluator" };
  }
  if (field === "deleteEvaluator") {
    const prof = db.get(k(`USER#${a.id}`, "META"));
    if (prof && prof.role === "admin") return { errorMessage: "That login is a convenor and cannot be deleted here", errorType: "Forbidden" };
    db.delete(k(`USER#${a.id}`, "META")); return a.id;
  }
  if (field === "exportUrl") return `${origin}/mock-upload/${encodeURIComponent(a.filename)}`;
  return { errorMessage: `Unknown field ${field}`, errorType: "BadRequest" };
}

// ----------------------------------------------------------------------------- Field -> pipeline (mirrors infra/lib/tryout-stack.js)
const R = async (f) => loadResolver(f);
const FIELDS = {
  currentTryout: [await R("Query.currentTryout.1.getPointer.js"), await R("Fn.getTryout.js")],
  myEvaluations: [await R("Query.myEvaluations.js")],
  allEvaluations: [await R("Query.allEvaluations.js")],
  evaluators: [await R("Query.evaluators.js")],
  upsertEvaluation: [await R("Mutation.upsertEvaluation.1.loadContext.js"), await R("Mutation.upsertEvaluation.1b.checkTeam.js"), await R("Mutation.upsertEvaluation.2.put.js")],
  createTryout: [await R("Mutation.createTryout.js")],
  addSession: [await R("Mutation.addSession.1.count.js"), await R("Mutation.addSession.2.put.js")],
  updateSession: [await R("Mutation.updateSession.js")],
  upsertPlayers: [await R("Mutation.upsertPlayers.js")],
  setPlayerActive: [await R("Mutation.setPlayerActive.js")],
  updatePlayer: [await R("Mutation.updatePlayer.js")],
  setAttendance: [await R("Mutation.setAttendance.js")],
  setSessionColours: [await R("Mutation.setSessionColours.js")],
  createTeam: [await R("Mutation.createTeam.js")],
  updateTeam: [await R("Mutation.updateTeam.js")],
  deleteTeam: [await R("Mutation.deleteTeam.js")],
  setTeamPlayers: [await R("Mutation.setTeamPlayers.js")],
  setSessionTeams: [await R("Mutation.setSessionTeams.1.getSession.js"), await R("Mutation.setSessionTeams.2.put.js")],
  deletePlayer: [await R("Mutation.deletePlayer.1.checkNoScores.js"), await R("Mutation.deletePlayer.2.delete.js")],
  changePlayerColour: [await R("Mutation.changePlayerColour.1.checkNoScores.js"), await R("Mutation.changePlayerColour.2.get.js"), await R("Mutation.changePlayerColour.3.move.js")],
  setEvaluatorAccess: [await R("Mutation.setEvaluatorAccess.js")],
  closeTryout: [await R("Mutation.closeTryout.1.close.js"), await R("Fn.getTryout.js")],
  addSelfAsEvaluator: [await R("Mutation.addSelfAsEvaluator.js")],
  createEvaluator: [await R("Lambda.adminOps.js")],
  deleteEvaluator: [await R("Lambda.adminOps.js")],
  exportUrl: [await R("Lambda.adminOps.js")],
};
const ADMIN_FIELDS = new Set(["allEvaluations", "evaluators", "createTryout", "addSession", "upsertPlayers", "updateSession", "setPlayerActive", "updatePlayer", "deletePlayer", "changePlayerColour", "setAttendance", "setSessionColours", "createTeam", "updateTeam", "deleteTeam", "setTeamPlayers", "setSessionTeams", "setEvaluatorAccess", "addSelfAsEvaluator", "createEvaluator", "deleteEvaluator", "closeTryout", "exportUrl"]);

async function runField(field, args, identity) {
  const ctx = { args, arguments: args, identity, stash: {}, prev: { result: null }, result: null, error: null, info: { fieldName: field, parentTypeName: "" } };
  for (const step of FIELDS[field]) {
    let req;
    try { req = step.request(ctx); } catch (e) { if (e instanceof EarlyReturn) { ctx.prev.result = e.value; continue; } throw e; }
    try { ctx.result = await execute(req); ctx.error = null; }
    catch (e) { if (e instanceof AppSyncError) throw e; ctx.result = null; ctx.error = { message: e.message, type: e.type || "MockError" }; }
    ctx.prev.result = step.response(ctx);
  }
  return ctx.prev.result;
}

/** AppSync returns AWSJSON as a string. */
function shape(v) {
  if (Array.isArray(v)) return v.map(shape);
  if (v && typeof v === "object") {
    const o = {};
    for (const [key, val] of Object.entries(v)) o[key] = (key === "scores" || key === "colours") && val && typeof val === "object" ? JSON.stringify(val) : shape(val);
    return o;
  }
  return v;
}

async function graphql(body, identity) {
  const m = String(body.query || "").replace(/^\s*(query|mutation)\b[^{]*/, "").match(/\{\s*([A-Za-z_]\w*)/);
  const field = m && m[1];
  if (!field || !FIELDS[field]) return { data: null, errors: [{ message: `Unknown field ${field}`, errorType: "ValidationError" }] };
  if (!identity) return { data: null, errors: [{ message: "Unauthorized", errorType: "UnauthorizedException" }] };
  if (ADMIN_FIELDS.has(field) && !identity.groups.includes("admin")) return { data: null, errors: [{ message: `Not Authorized to access ${field} on type Mutation`, errorType: "Unauthorized" }] };
  try {
    const result = await runField(field, body.variables || {}, identity);
    return { data: { [field]: shape(result) } };
  } catch (e) {
    if (e instanceof AppSyncError) return { data: null, errors: [{ message: e.message, errorType: e.type }] };
    console.error(e);
    return { data: null, errors: [{ message: e.message, errorType: "InternalFailure" }] };
  }
}

// ----------------------------------------------------------------------------- Seed
function seed() {
  const id = "seed-tryout";
  db.set(k(`TRYOUT#${id}`, "META"), { PK: `TRYOUT#${id}`, SK: "META", tryoutId: id, name: "2026-27 U13 Rep B (seed)", season: "2026-27", status: "open", createdAt: new Date().toISOString() });
  db.set(k("CONFIG", "CURRENT_TRYOUT"), { PK: "CONFIG", SK: "CURRENT_TRYOUT", tryoutId: id });
  const today = new Date().toISOString().slice(0, 10);
  [["s1", "Skate 1 – Skills", today, "skills", 1, "primary"], ["s2", "Skate 2 – Scrimmage", today, "scrimmage", 2, "secondary"]].forEach(([sid, label, date, type, order, jersey]) =>
    db.set(k(`TRYOUT#${id}`, `SESSION#${sid}`), { PK: `TRYOUT#${id}`, SK: `SESSION#${sid}`, tryoutId: id, sessionId: sid, label, date, type, order, jersey }));
  // Every player has two jersey colours; numbers never change.
  const players = [["White", "Green", 1, "G"], ["White", "Green", 4, "D"], ["White", "Green", 7, "F"], ["White", "Green", 9, "F"], ["White", "Green", 12, "D"], ["White", "Green", 14, "F"],
    ["Blue", "Yellow", 1, "G"], ["Blue", "Yellow", 3, "D"], ["Blue", "Yellow", 8, "F"], ["Blue", "Yellow", 10, "F"], ["Blue", "Yellow", 15, "D"], ["Blue", "Yellow", 17, "F"],
    ["Red", "Orange", 2, "D"], ["Red", "Orange", 5, "F"], ["Red", "Orange", 11, "F", "AA"]];
  for (const [colour, colour2, number, position, tag] of players) {
    const pn = `${colour[0]}-${String(number).padStart(2, "0")}`;
    db.set(k(`TRYOUT#${id}`, `PLAYER#${pn}`), { PK: `TRYOUT#${id}`, SK: `PLAYER#${pn}`, tryoutId: id, playerNumber: pn, colour, colour2, number, position, active: true, tag: tag || null });
  }
  db.set(k(`TRYOUT#${id}`, "TEAM#team1"), { PK: `TRYOUT#${id}`, SK: "TEAM#team1", tryoutId: id, teamId: "team1", name: "Team 1", colour: "Red", players: ["W-01", "W-04", "W-07", "B-08", "B-10", "R-02", "R-05"] });
  db.set(k(`TRYOUT#${id}`, "TEAM#team2"), { PK: `TRYOUT#${id}`, SK: "TEAM#team2", tryoutId: id, teamId: "team2", name: "Team 2", colour: "White", players: ["B-01", "B-03", "W-09", "W-12", "W-14", "B-15", "B-17", "R-11"] });
  db.get(k(`TRYOUT#${id}`, "SESSION#s2")).teams = [{ teamId: "team1", colour: "Red" }, { teamId: "team2", colour: "White" }];
  for (const [email, label] of [["evaluator1@mock.test", "Evaluator 1"], ["evaluator2@mock.test", "Evaluator 2"]]) {
    const sub = subFor(email);
    db.set(k(`USER#${sub}`, "META"), { PK: `USER#${sub}`, SK: "META", GSI1PK: "USERS", GSI1SK: `USER#${sub}`, userId: sub, displayName: label, role: "evaluator" });
    db.set(k(`TRYOUT#${id}`, `EVALUATOR#${sub}`), { PK: `TRYOUT#${id}`, SK: `EVALUATOR#${sub}`, tryoutId: id, evaluatorId: sub, enabled: true, updatedAt: new Date().toISOString() });
  }
  console.log("seeded: 1 tryout, 2 sessions, 15 players, 2 evaluators (both allowed on the tryout)");
}
if (SEED) seed();

// ----------------------------------------------------------------------------- HTTP
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".csv": "text/csv" };
const readBody = (req) => new Promise((res) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => res(d)); });

const server = http.createServer(async (req, res) => {
  origin = `http://${req.headers.host}`;
  const url = new URL(req.url, origin);
  if (req.method === "POST" && url.pathname === "/graphql") {
    const auth = req.headers.authorization || "";
    let identity = null;
    if (auth.startsWith("mock ")) { try { const s = JSON.parse(auth.slice(5)); identity = { sub: s.sub, username: s.sub, groups: s.groups || [], claims: s }; } catch { /* invalid */ } }
    const body = JSON.parse((await readBody(req)) || "{}");
    const out = await graphql(body, identity);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(out));
  }
  if (req.method === "PUT" && url.pathname.startsWith("/mock-upload/")) { await readBody(req); res.writeHead(200); return res.end(); }
  if (req.method !== "GET") { res.writeHead(405); return res.end(); }
  if (url.pathname === "/js/config.js") {
    res.writeHead(200, { "content-type": MIME[".js"], "cache-control": "no-store" });
    return res.end(`export const config = ${JSON.stringify({ mock: true, region: "local", userPoolId: "mock", userPoolClientId: "mock", graphqlUrl: `${origin}/graphql`, appUrl: origin })};\n`);
  }
  let file = path.join(WEB, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { file = path.join(WEB, "404.html"); res.statusCode = 404; }
  res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
  res.setHeader("cache-control", "no-store");
  fs.createReadStream(file).pipe(res);
});
server.listen(PORT, () => console.log(`dev server: http://localhost:${PORT}  (mock auth; ${SEED ? "seeded" : "empty"} in-memory data)`));
