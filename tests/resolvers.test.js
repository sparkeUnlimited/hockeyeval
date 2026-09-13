import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import {
  loadResolver, ctx, fromMapValues, evaluatorIdentity, adminIdentity,
  EVALUATOR_SUB, OTHER_SUB, EarlyReturn,
} from "./helpers/load-resolver.js";

const TRYOUT = "t-2026-u13";
const SESSION = "s-1";

function throwsType(fn, type, messageRe) {
  assert.throws(fn, (err) => {
    assert.equal(err.type, type, `expected error type ${type}, got ${err.type}: ${err.message}`);
    if (messageRe) assert.match(err.message, messageRe);
    return true;
  });
}

// ---------------------------------------------------------------- upsertEvaluation
describe("Mutation.upsertEvaluation step 1 (load context)", () => {
  let mod;
  before(async () => { mod = await loadResolver("Mutation.upsertEvaluation.1.loadContext.js"); });

  const args = { tryoutId: TRYOUT, sessionId: SESSION, playerNumber: "W-14", scores: { skating: 4 }, clientId: "c-1" };

  test("request fetches META, SESSION and PLAYER in one BatchGetItem", () => {
    const req = mod.request(ctx({ args }));
    assert.equal(req.operation, "BatchGetItem");
    const keys = req.tables.TryoutTable.keys.map(fromMapValues);
    assert.deepEqual(keys, [
      { PK: `TRYOUT#${TRYOUT}`, SK: "META" },
      { PK: `TRYOUT#${TRYOUT}`, SK: `SESSION#${SESSION}` },
      { PK: `TRYOUT#${TRYOUT}`, SK: "PLAYER#W-14" },
    ]);
  });

  test("request rejects unauthenticated callers and malformed ids", () => {
    throwsType(() => mod.request(ctx({ args, identity: null })), "Unauthorized");
    throwsType(() => mod.request(ctx({ args: { ...args, playerNumber: "Smith-14" } })), "BadRequest", /playerNumber/);
    throwsType(() => mod.request(ctx({ args: { ...args, tryoutId: "a b" } })), "BadRequest", /tryoutId/);
    throwsType(() => mod.request(ctx({ args: { ...args, clientId: "" } })), "BadRequest", /clientId/);
  });

  const rows = (status = "open") => ({
    data: { TryoutTable: [
      { PK: `TRYOUT#${TRYOUT}`, SK: "META", status },
      { PK: `TRYOUT#${TRYOUT}`, SK: `SESSION#${SESSION}`, sessionId: SESSION },
      { PK: `TRYOUT#${TRYOUT}`, SK: "PLAYER#W-14", playerNumber: "W-14", position: "D", active: true },
    ] },
  });

  test("response stashes the player's position for an open tryout", () => {
    const c = ctx({ args, result: rows("open") });
    mod.response(c);
    assert.equal(c.stash.position, "D");
  });

  test("closed tryout is rejected", () => {
    throwsType(() => mod.response(ctx({ args, result: rows("closed") })), "TryoutClosed", /closed/i);
  });

  test("missing tryout, session or player are rejected", () => {
    throwsType(() => mod.response(ctx({ args, result: { data: { TryoutTable: [] } } })), "NotFound", /Tryout/);
    const noSession = rows(); noSession.data.TryoutTable.splice(1, 1);
    throwsType(() => mod.response(ctx({ args, result: noSession })), "NotFound", /Session/);
    const noPlayer = rows(); noPlayer.data.TryoutTable.splice(2, 1);
    throwsType(() => mod.response(ctx({ args, result: noPlayer })), "NotFound", /Player/);
  });
});

describe("Mutation.upsertEvaluation step 2 (put)", () => {
  let mod;
  before(async () => { mod = await loadResolver("Mutation.upsertEvaluation.2.put.js"); });

  const baseArgs = {
    tryoutId: TRYOUT, sessionId: SESSION, playerNumber: "W-14", clientId: "c-1",
    scores: { skating: 4, sense: 5 }, tier: "A", notes: "Strong on the rush",
  };

  test("evaluatorId comes from identity, not from args", () => {
    const args = { ...baseArgs, evaluatorId: OTHER_SUB, evaluatorSub: OTHER_SUB }; // an attacker adding extra args
    const req = mod.request(ctx({ args, stash: { position: "D" }, identity: evaluatorIdentity(EVALUATOR_SUB) }));
    assert.equal(req.operation, "PutItem");
    const key = fromMapValues(req.key);
    const item = fromMapValues(req.attributeValues);
    assert.equal(key.PK, `EVAL#${TRYOUT}#${SESSION}#${EVALUATOR_SUB}`);
    assert.equal(key.SK, "PLAYER#W-14");
    assert.equal(item.evaluatorId, EVALUATOR_SUB);
    assert.equal(item.GSI1PK, `TRYOUT#${TRYOUT}#PLAYER#W-14`);
    assert.equal(item.GSI1SK, `SESSION#${SESSION}#EVAL#${EVALUATOR_SUB}`);
    assert.equal(item.GSI2PK, `TRYOUT#${TRYOUT}#EVALS`);
    assert.ok(!JSON.stringify(item).includes(OTHER_SUB), "client-supplied evaluator id must not appear anywhere");
  });

  test("unknown score keys and invalid values are stripped; position-specific keys respected", () => {
    const args = { ...baseArgs, scores: { skating: 4, offence: 5, g_save: 3, bogus: 5, puck: 6, passing: 2.5, shooting: "4", sense: 1 } };
    const req = mod.request(ctx({ args, stash: { position: "D" } }));
    const item = fromMapValues(req.attributeValues);
    assert.deepEqual(item.scores, { skating: 4, sense: 1 }); // offence is F-only, g_save is G-only, others invalid
  });

  test("scores may arrive as a JSON string (AWSJSON) and are parsed", () => {
    const req = mod.request(ctx({ args: { ...baseArgs, scores: JSON.stringify({ dzone: 3, skating: 2 }) }, stash: { position: "D" } }));
    assert.deepEqual(fromMapValues(req.attributeValues).scores, { skating: 2, dzone: 3 });
  });

  test("notes are capped at 280 characters and trimmed", () => {
    const long = "x".repeat(600);
    const req = mod.request(ctx({ args: { ...baseArgs, notes: `  ${long}  ` }, stash: { position: "F" } }));
    assert.equal(fromMapValues(req.attributeValues).notes.length, 280);
    const empty = mod.request(ctx({ args: { ...baseArgs, notes: "   " }, stash: { position: "F" } }));
    assert.equal(fromMapValues(empty.attributeValues).notes, null);
  });

  test("tier must be A/B/C/X or empty", () => {
    throwsType(() => mod.request(ctx({ args: { ...baseArgs, tier: "S" }, stash: { position: "F" } })), "BadRequest", /tier/);
    const req = mod.request(ctx({ args: { ...baseArgs, tier: null }, stash: { position: "F" } }));
    assert.equal(fromMapValues(req.attributeValues).tier, null);
  });

  test("the written item contains no field that could hold a name", () => {
    const req = mod.request(ctx({ args: baseArgs, stash: { position: "F" } }));
    const keys = Object.keys(fromMapValues(req.attributeValues));
    for (const k of keys) assert.ok(!/name|birth|dob|photo|parent|email|phone/i.test(k), `suspicious attribute ${k}`);
  });

  test("response maps the stored item to the Evaluation type", () => {
    const stored = {
      playerNumber: "W-14", sessionId: SESSION, evaluatorId: EVALUATOR_SUB, scores: { skating: 4 },
      tier: "A", notes: null, updatedAt: "2026-09-13T00:00:00.000Z", clientId: "c-1", PK: "x", SK: "y", GSI1PK: "z",
    };
    const out = mod.response(ctx({ result: stored }));
    assert.deepEqual(out, {
      playerNumber: "W-14", sessionId: SESSION, evaluatorId: EVALUATOR_SUB, scores: { skating: 4 },
      tier: "A", notes: null, updatedAt: "2026-09-13T00:00:00.000Z", clientId: "c-1",
    });
  });

  test("DynamoDB errors are surfaced", () => {
    throwsType(() => mod.response(ctx({ error: { message: "boom", type: "DynamoDB:ConditionalCheckFailedException" } })), "DynamoDB:ConditionalCheckFailedException");
  });
});

// ---------------------------------------------------------------- myEvaluations
describe("Query.myEvaluations", () => {
  let mod;
  before(async () => { mod = await loadResolver("Query.myEvaluations.js"); });

  test("queries only the caller's own partition", () => {
    const req = mod.request(ctx({ args: { tryoutId: TRYOUT, sessionId: SESSION }, identity: evaluatorIdentity(EVALUATOR_SUB) }));
    assert.equal(req.operation, "Query");
    assert.equal(req.query.expression, "PK = :pk");
    assert.deepEqual(fromMapValues(req.query.expressionValues), { ":pk": `EVAL#${TRYOUT}#${SESSION}#${EVALUATOR_SUB}` });
  });

  test("an evaluator cannot read another evaluator's rows by passing an evaluatorId argument", () => {
    const req = mod.request(ctx({
      args: { tryoutId: TRYOUT, sessionId: SESSION, evaluatorId: OTHER_SUB, sub: OTHER_SUB },
      identity: evaluatorIdentity(EVALUATOR_SUB),
    }));
    const pk = fromMapValues(req.query.expressionValues)[":pk"];
    assert.equal(pk, `EVAL#${TRYOUT}#${SESSION}#${EVALUATOR_SUB}`);
    assert.ok(!pk.includes(OTHER_SUB));
    assert.ok(!JSON.stringify(req).includes(OTHER_SUB));
  });

  test("two different evaluators get two different partitions", () => {
    const a = mod.request(ctx({ args: { tryoutId: TRYOUT, sessionId: SESSION }, identity: evaluatorIdentity(EVALUATOR_SUB) }));
    const b = mod.request(ctx({ args: { tryoutId: TRYOUT, sessionId: SESSION }, identity: evaluatorIdentity(OTHER_SUB) }));
    assert.notEqual(fromMapValues(a.query.expressionValues)[":pk"], fromMapValues(b.query.expressionValues)[":pk"]);
  });

  test("unauthenticated request is rejected", () => {
    throwsType(() => mod.request(ctx({ args: { tryoutId: TRYOUT, sessionId: SESSION }, identity: null })), "Unauthorized");
  });

  test("response maps items and drops internal keys", () => {
    const out = mod.response(ctx({ result: { items: [
      { PK: "p", SK: "s", GSI1PK: "g", playerNumber: "B-07", sessionId: SESSION, evaluatorId: EVALUATOR_SUB, scores: { puck: 3 }, updatedAt: "2026-09-13T00:00:00.000Z" },
    ] } }));
    assert.equal(out.length, 1);
    assert.deepEqual(Object.keys(out[0]).sort(), ["clientId", "evaluatorId", "notes", "playerNumber", "scores", "sessionId", "tier", "updatedAt"]);
    assert.equal(out[0].playerNumber, "B-07");
  });
});

// ---------------------------------------------------------------- admin-only fields
describe("admin-only resolvers re-check the admin group (defence in depth)", () => {
  test("allEvaluations, evaluators, createTryout, addSession, upsertPlayers, setPlayerActive, closeTryout, Lambda ops", async () => {
    const cases = [
      ["Query.allEvaluations.js", { tryoutId: TRYOUT }],
      ["Query.evaluators.js", {}],
      ["Mutation.createTryout.js", { name: "2026-27 U13 Rep B", season: "2026-27" }],
      ["Mutation.addSession.js", { tryoutId: TRYOUT, label: "Skate 1", date: "2026-09-20", type: "skills" }],
      ["Mutation.upsertPlayers.js", { tryoutId: TRYOUT, players: [{ colour: "White", number: 14, position: "D" }] }],
      ["Mutation.setPlayerActive.js", { tryoutId: TRYOUT, playerNumber: "W-14", active: false }],
      ["Mutation.closeTryout.1.close.js", { tryoutId: TRYOUT }],
      ["Lambda.adminOps.js", { email: "e@example.com", displayName: "Evaluator 1" }],
    ];
    for (const [file, args] of cases) {
      const mod = await loadResolver(file);
      throwsType(() => mod.request(ctx({ args, identity: evaluatorIdentity(), info: { fieldName: "createEvaluator" } })), "Unauthorized");
      // and succeeds for an admin
      const req = mod.request(ctx({ args, identity: adminIdentity(), info: { fieldName: "createEvaluator" } }));
      assert.ok(req.operation, `${file} should produce a request for admin`);
    }
  });
});

describe("Query.allEvaluations", () => {
  test("uses GSI2 and can narrow to a session; passes nextToken through", async () => {
    const mod = await loadResolver("Query.allEvaluations.js");
    const all = mod.request(ctx({ args: { tryoutId: TRYOUT }, identity: adminIdentity() }));
    assert.equal(all.index, "GSI2");
    assert.equal(all.query.expression, "GSI2PK = :pk");
    const one = mod.request(ctx({ args: { tryoutId: TRYOUT, sessionId: SESSION, nextToken: "tok" }, identity: adminIdentity() }));
    assert.match(one.query.expression, /begins_with\(GSI2SK, :sk\)/);
    assert.equal(fromMapValues(one.query.expressionValues)[":sk"], `SESSION#${SESSION}#`);
    assert.equal(one.nextToken, "tok");
    const out = mod.response(ctx({ result: { items: [], nextToken: "n2" } }));
    assert.deepEqual(out, { items: [], nextToken: "n2" });
  });
});

// ---------------------------------------------------------------- players
describe("Mutation.upsertPlayers", () => {
  let mod;
  before(async () => { mod = await loadResolver("Mutation.upsertPlayers.js"); });

  test("derives playerNumber as colour letter + zero-padded number and defaults active=true", () => {
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, players: [
      { colour: "white", number: 7, position: "F" }, { colour: "Blue", number: 14, position: "D", active: false },
    ] } }));
    assert.equal(req.operation, "BatchPutItem");
    const items = req.tables.TryoutTable.map(fromMapValues);
    assert.equal(items[0].playerNumber, "W-07");
    assert.equal(items[0].colour, "White");
    assert.equal(items[0].active, true);
    assert.equal(items[1].playerNumber, "B-14");
    assert.equal(items[1].active, false);
    assert.equal(items[0].SK, "PLAYER#W-07");
  });

  test("rejects bad positions, colours, numbers, duplicates and >25 per call", () => {
    const base = { tryoutId: TRYOUT };
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { ...base, players: [{ colour: "White", number: 1, position: "C" }] } })), "BadRequest", /position/);
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { ...base, players: [{ colour: "Wh1te", number: 1, position: "F" }] } })), "BadRequest", /colour/);
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { ...base, players: [{ colour: "White", number: 1.5, position: "F" }] } })), "BadRequest", /number/);
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { ...base, players: [
      { colour: "White", number: 1, position: "F" }, { colour: "white", number: 1, position: "D" },
    ] } })), "BadRequest", /Duplicate/);
    const many = Array.from({ length: 26 }, (_, i) => ({ colour: "White", number: i, position: "F" }));
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { ...base, players: many } })), "BadRequest", /25/);
  });

  test("PlayerInput has no name-like field that is persisted", () => {
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, players: [
      { colour: "White", number: 7, position: "F", name: "Should Not Persist", firstName: "x" },
    ] } }));
    const item = fromMapValues(req.tables.TryoutTable[0]);
    assert.ok(!("name" in item) && !("firstName" in item));
    assert.ok(!JSON.stringify(item).includes("Should Not Persist"));
  });
});

// ---------------------------------------------------------------- tryout assembly
describe("currentTryout pipeline", () => {
  test("pointer step early-returns null when no tryout exists, otherwise stashes id", async () => {
    const mod = await loadResolver("Query.currentTryout.1.getPointer.js");
    const req = mod.request(ctx({}));
    assert.deepEqual(fromMapValues(req.key), { PK: "CONFIG", SK: "CURRENT_TRYOUT" });
    assert.throws(() => mod.response(ctx({ result: null })), (e) => e instanceof EarlyReturn && e.value === null);
    const c = ctx({ result: { tryoutId: TRYOUT } });
    mod.response(c);
    assert.equal(c.stash.tryoutId, TRYOUT);
  });

  test("getTryout assembles META + sessions + players (unsorted; clients sort)", async () => {
    const mod = await loadResolver("Fn.getTryout.js");
    const req = mod.request(ctx({ stash: { tryoutId: TRYOUT } }));
    assert.deepEqual(fromMapValues(req.query.expressionValues), { ":pk": `TRYOUT#${TRYOUT}` });
    const out = mod.response(ctx({ stash: { tryoutId: TRYOUT }, result: { items: [
      { SK: "PLAYER#W-14", playerNumber: "W-14", colour: "White", number: 14, position: "D", active: true },
      { SK: "SESSION#s2", sessionId: "s2", label: "Skate 2", date: "2026-09-21", type: "scrimmage", order: 2 },
      { SK: "META", name: "2026-27 U13 Rep B", season: "2026-27", status: "open", createdAt: "2026-09-01T00:00:00.000Z" },
      { SK: "PLAYER#B-07", playerNumber: "B-07", colour: "Blue", number: 7, position: "F" },
      { SK: "SESSION#s1", sessionId: "s1", label: "Skate 1", date: "2026-09-20", type: "skills", order: 1 },
    ] } }));
    assert.equal(out.id, TRYOUT);
    assert.equal(out.status, "open");
    assert.deepEqual(out.sessions.map((s) => s.id).sort(), ["s1", "s2"]);
    assert.deepEqual(out.players.map((p) => p.playerNumber).sort(), ["B-07", "W-14"]);
    assert.equal(out.players[0].active, true, "active defaults to true when missing");
  });
});

describe("Mutation.createTryout / addSession / setPlayerActive / closeTryout", () => {
  test("createTryout writes META and the CURRENT_TRYOUT pointer in one transaction", async () => {
    const mod = await loadResolver("Mutation.createTryout.js");
    const c = ctx({ identity: adminIdentity(), args: { name: " 2026-27 U13 Rep B ", season: "2026-27" } });
    const req = mod.request(c);
    assert.equal(req.operation, "TransactWriteItems");
    assert.equal(req.transactItems.length, 2);
    const [meta, pointer] = req.transactItems.map((t) => ({ key: fromMapValues(t.key), attrs: fromMapValues(t.attributeValues) }));
    assert.equal(meta.key.SK, "META");
    assert.equal(meta.attrs.name, "2026-27 U13 Rep B");
    assert.equal(meta.attrs.status, "open");
    assert.deepEqual(pointer.key, { PK: "CONFIG", SK: "CURRENT_TRYOUT" });
    assert.equal(pointer.attrs.tryoutId, c.stash.tryout.id);
    const out = mod.response(c);
    assert.deepEqual(out.sessions, []);
    assert.equal(out.name, "2026-27 U13 Rep B");
  });

  test("addSession validates date/type", async () => {
    const mod = await loadResolver("Mutation.addSession.js");
    const good = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, label: "Skate 1", date: "2026-09-20", type: "skills" } }));
    assert.equal(good.operation, "PutItem");
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, label: "x", date: "20/09/2026", type: "skills" } })), "BadRequest", /date/);
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, label: "x", date: "2026-09-20", type: "practice" } })), "BadRequest", /type/);
  });

  test("setPlayerActive updates only the active flag with an existence condition", async () => {
    const mod = await loadResolver("Mutation.setPlayerActive.js");
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, playerNumber: "W-14", active: false } }));
    assert.equal(req.operation, "UpdateItem");
    assert.equal(req.update.expression, "SET active = :active");
    assert.equal(fromMapValues(req.update.expressionValues)[":active"], false);
    assert.equal(req.condition.expression, "attribute_exists(PK)");
  });

  test("closeTryout sets status=closed and stashes the id for the getTryout step", async () => {
    const mod = await loadResolver("Mutation.closeTryout.1.close.js");
    const c = ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT } });
    const req = mod.request(c);
    assert.equal(req.operation, "UpdateItem");
    assert.equal(fromMapValues(req.update.expressionValues)[":closed"], "closed");
    assert.equal(c.stash.tryoutId, TRYOUT);
  });
});

describe("Lambda.adminOps", () => {
  test("forwards only field, args and identity sub/groups; surfaces Lambda errors", async () => {
    const mod = await loadResolver("Lambda.adminOps.js");
    const req = mod.request(ctx({ identity: adminIdentity(), info: { fieldName: "exportUrl" }, args: { tryoutId: TRYOUT, filename: "rankings.csv" } }));
    assert.equal(req.operation, "Invoke");
    assert.deepEqual(Object.keys(req.payload).sort(), ["args", "field", "identity"]);
    assert.deepEqual(Object.keys(req.payload.identity).sort(), ["groups", "sub"]);
    throwsType(() => mod.response(ctx({ result: { errorMessage: "Invalid email", errorType: "BadRequest" } })), "BadRequest", /email/);
    assert.equal(mod.response(ctx({ result: "https://example" })), "https://example");
  });
});
