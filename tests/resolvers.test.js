import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import {
  loadResolver, ctx, fromMapValues, evaluatorIdentity, adminIdentity,
  EVALUATOR_SUB, OTHER_SUB, ADMIN_SUB, EarlyReturn,
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

  test("request fetches META, SESSION, PLAYER and the caller's access row in one BatchGetItem", () => {
    const req = mod.request(ctx({ args }));
    assert.equal(req.operation, "BatchGetItem");
    const keys = req.tables.TryoutTable.keys.map(fromMapValues);
    assert.deepEqual(keys, [
      { PK: `TRYOUT#${TRYOUT}`, SK: "META" },
      { PK: `TRYOUT#${TRYOUT}`, SK: `SESSION#${SESSION}` },
      { PK: `TRYOUT#${TRYOUT}`, SK: "PLAYER#W-14" },
      { PK: `TRYOUT#${TRYOUT}`, SK: `EVALUATOR#${EVALUATOR_SUB}` },
    ]);
  });

  test("the access row looked up is the caller's, even if args carry another evaluator id", () => {
    const req = mod.request(ctx({ args: { ...args, evaluatorId: OTHER_SUB }, identity: evaluatorIdentity(EVALUATOR_SUB) }));
    const keys = req.tables.TryoutTable.keys.map(fromMapValues);
    assert.equal(keys[3].SK, `EVALUATOR#${EVALUATOR_SUB}`);
    assert.ok(!JSON.stringify(keys).includes(OTHER_SUB));
  });

  test("request rejects unauthenticated callers and malformed ids", () => {
    throwsType(() => mod.request(ctx({ args, identity: null })), "Unauthorized");
    throwsType(() => mod.request(ctx({ args: { ...args, playerNumber: "Smith-14" } })), "BadRequest", /playerNumber/);
    throwsType(() => mod.request(ctx({ args: { ...args, tryoutId: "a b" } })), "BadRequest", /tryoutId/);
    throwsType(() => mod.request(ctx({ args: { ...args, clientId: "" } })), "BadRequest", /clientId/);
  });

  const rows = (status = "open", access = { enabled: true }) => ({
    data: { TryoutTable: [
      { PK: `TRYOUT#${TRYOUT}`, SK: "META", status },
      { PK: `TRYOUT#${TRYOUT}`, SK: `SESSION#${SESSION}`, sessionId: SESSION },
      { PK: `TRYOUT#${TRYOUT}`, SK: "PLAYER#W-14", playerNumber: "W-14", position: "D", active: true },
      ...(access ? [{ PK: `TRYOUT#${TRYOUT}`, SK: `EVALUATOR#${EVALUATOR_SUB}`, evaluatorId: EVALUATOR_SUB, ...access }] : []),
    ] },
  });

  test("response stashes the player's position for an open tryout", () => {
    const c = ctx({ args, result: rows("open") });
    mod.response(c);
    assert.equal(c.stash.position, "D");
  });

  test("a player marked absent for the session cannot be scored in it", () => {
    const r = rows("open");
    r.data.TryoutTable[1].absent = ["B-07", "W-14"];
    throwsType(() => mod.response(ctx({ args, result: r })), "Absent", /absent/i);
    r.data.TryoutTable[1].absent = ["B-07"];
    const c = ctx({ args, result: r });
    mod.response(c);
    assert.equal(c.stash.position, "D", "absent list for other players does not block");
  });

  test("step 1 stashes the session's teams for the team check", () => {
    const r = rows("open");
    r.data.TryoutTable[1].teams = [{ teamId: "team1", colour: "Red" }];
    const c = ctx({ args, result: r });
    mod.response(c);
    assert.deepEqual(c.stash.sessionTeams, [{ teamId: "team1", colour: "Red" }]);
    const none = ctx({ args, result: rows("open") });
    mod.response(none);
    assert.deepEqual(none.stash.sessionTeams, []);
  });

  test("closed tryout is rejected", () => {
    throwsType(() => mod.response(ctx({ args, result: rows("closed") })), "TryoutClosed", /closed/i);
  });

  test("an evaluator who was never added to the tryout is rejected", () => {
    throwsType(() => mod.response(ctx({ args, result: rows("open", null) })), "Forbidden", /not an enabled evaluator/);
  });

  test("a disabled evaluator is rejected; re-enabling works", () => {
    throwsType(() => mod.response(ctx({ args, result: rows("open", { enabled: false }) })), "Forbidden");
    const c = ctx({ args, result: rows("open", { enabled: true }) });
    mod.response(c);
    assert.equal(c.stash.position, "D");
  });

  test("closed tryout is reported before the allowlist (so a disabled evaluator on a closed tryout sees 'closed')", () => {
    throwsType(() => mod.response(ctx({ args, result: rows("closed", null) })), "TryoutClosed");
  });

  test("missing tryout, session or player are rejected", () => {
    throwsType(() => mod.response(ctx({ args, result: { data: { TryoutTable: [] } } })), "NotFound", /Tryout/);
    const noSession = rows(); noSession.data.TryoutTable.splice(1, 1);
    throwsType(() => mod.response(ctx({ args, result: noSession })), "NotFound", /Session/);
    const noPlayer = rows(); noPlayer.data.TryoutTable.splice(2, 1);
    throwsType(() => mod.response(ctx({ args, result: noPlayer })), "NotFound", /Player/);
  });
});

describe("Mutation.upsertEvaluation step 1b (team check)", () => {
  let mod;
  before(async () => { mod = await loadResolver("Mutation.upsertEvaluation.1b.checkTeam.js"); });
  const args = { tryoutId: TRYOUT, sessionId: SESSION, playerNumber: "W-14", scores: {}, clientId: "c-1" };

  test("no teams on the session: skipped entirely (everyone plays)", () => {
    assert.throws(() => mod.request(ctx({ args, stash: { sessionTeams: [] } })), (e) => e instanceof EarlyReturn);
    assert.throws(() => mod.request(ctx({ args, stash: {} })), (e) => e instanceof EarlyReturn);
  });

  test("with teams: fetches the rosters live and requires membership", () => {
    const req = mod.request(ctx({ args, stash: { sessionTeams: [{ teamId: "t1", colour: "Red" }, { teamId: "t2", colour: "White" }] } }));
    assert.equal(req.operation, "BatchGetItem");
    assert.deepEqual(req.tables.TryoutTable.keys.map(fromMapValues), [
      { PK: `TRYOUT#${TRYOUT}`, SK: "TEAM#t1" }, { PK: `TRYOUT#${TRYOUT}`, SK: "TEAM#t2" },
    ]);
    const onTeam = { data: { TryoutTable: [{ SK: "TEAM#t1", players: ["B-07"] }, { SK: "TEAM#t2", players: ["W-14", "W-04"] }] } };
    assert.equal(mod.response(ctx({ args, result: onTeam })), true);
    const notOnTeam = { data: { TryoutTable: [{ SK: "TEAM#t1", players: ["B-07"] }, null] } };
    throwsType(() => mod.response(ctx({ args, result: notOnTeam })), "NotPlaying", /not on a team/);
  });
});

describe("teams", () => {
  test("createTeam validates the name and starts with an empty roster", async () => {
    const mod = await loadResolver("Mutation.createTeam.js");
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, name: " Team 1 ", colour: "red" } }));
    assert.equal(req.operation, "PutItem");
    const attrs = fromMapValues(req.attributeValues);
    assert.equal(attrs.name, "Team 1");
    assert.equal(attrs.colour, "Red");
    assert.deepEqual(attrs.players, []);
    assert.equal(fromMapValues(mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, name: "Team 2" } })).attributeValues).colour, null);
    assert.match(fromMapValues(req.key).SK, /^TEAM#/);
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, name: "Team <b>" } })), "BadRequest", /Team name/);
    assert.deepEqual(mod.response(ctx({ result: { teamId: "t1", name: "Team 1" } })), { id: "t1", name: "Team 1", colour: null, players: [] });
  });

  test("updateTeam changes name and/or colour only", async () => {
    const mod = await loadResolver("Mutation.updateTeam.js");
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, teamId: "t1", colour: "red" } }));
    assert.equal(req.update.expression, "SET #colour = :colour");
    assert.deepEqual(fromMapValues(req.update.expressionValues), { ":colour": "Red" });
    const both = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, teamId: "t1", name: "Team A", colour: "" } }));
    assert.deepEqual(fromMapValues(both.update.expressionValues), { ":name": "Team A", ":colour": null });
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, teamId: "t1" } })), "BadRequest", /Nothing/);
    assert.deepEqual(mod.response(ctx({ result: { teamId: "t1", name: "Team A", colour: "Red", players: ["W-14"] } })), { id: "t1", name: "Team A", colour: "Red", players: ["W-14"] });
  });

  test("setTeamPlayers replaces the roster, de-duplicated and validated", async () => {
    const mod = await loadResolver("Mutation.setTeamPlayers.js");
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, teamId: "t1", players: ["W-14", "B-07", "W-14"] } }));
    assert.equal(req.update.expression, "SET #players = :players");
    assert.deepEqual(fromMapValues(req.update.expressionValues), { ":players": ["W-14", "B-07"] });
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, teamId: "t1", players: ["Smith-1"] } })), "BadRequest", /playerNumber/);
  });

  test("setSessionTeams step 1 reads the session and stashes its type", async () => {
    const mod = await loadResolver("Mutation.setSessionTeams.1.getSession.js");
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION } }));
    assert.deepEqual(fromMapValues(req.key), { PK: `TRYOUT#${TRYOUT}`, SK: `SESSION#${SESSION}` });
    const c = ctx({ result: { sessionId: SESSION, type: "skills" } });
    mod.response(c);
    assert.equal(c.stash.sessionType, "skills");
    throwsType(() => mod.response(ctx({ result: null })), "NotFound");
  });

  test("setSessionTeams: a skills session takes one group, scrimmages two teams", async () => {
    const mod = await loadResolver("Mutation.setSessionTeams.2.put.js");
    const two = [{ teamId: "t1", colour: "Red" }, { teamId: "t2", colour: "White" }];
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), stash: { sessionType: "skills" }, args: { tryoutId: TRYOUT, sessionId: SESSION, teams: two } })), "BadRequest", /one group/);
    assert.equal(mod.request(ctx({ identity: adminIdentity(), stash: { sessionType: "skills" }, args: { tryoutId: TRYOUT, sessionId: SESSION, teams: [two[0]] } })).operation, "UpdateItem");
    assert.equal(mod.request(ctx({ identity: adminIdentity(), stash: { sessionType: "scrimmage" }, args: { tryoutId: TRYOUT, sessionId: SESSION, teams: two } })).operation, "UpdateItem");
  });

  test("setSessionTeams validates ids/colours, rejects duplicates, empty clears", async () => {
    const mod = await loadResolver("Mutation.setSessionTeams.2.put.js");
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, teams: [{ teamId: "t1", colour: "red" }, { teamId: "t2", colour: "White" }] } }));
    assert.deepEqual(fromMapValues(req.update.expressionValues), { ":teams": [{ teamId: "t1", colour: "Red" }, { teamId: "t2", colour: "White" }] });
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, teams: [{ teamId: "t1", colour: "Red" }, { teamId: "t1", colour: "White" }] } })), "BadRequest", /twice/);
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, teams: [{ teamId: "t1", colour: "R3d" }] } })), "BadRequest", /colour/);
    const group = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, teams: [{ teamId: "t1" }, { teamId: "t2", colour: "" }] } }));
    assert.deepEqual(fromMapValues(group.update.expressionValues), { ":teams": [{ teamId: "t1", colour: null }, { teamId: "t2", colour: null }] }, "skills groups need no colour");
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, teams: [{ teamId: "t1", colour: "Red" }, { teamId: "t2", colour: "White" }, { teamId: "t3", colour: "Blue" }] } })), "BadRequest", /at most 2/);
    const empty = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, teams: [] } }));
    assert.deepEqual(fromMapValues(empty.update.expressionValues), { ":teams": [] });
    const out = mod.response(ctx({ result: { sessionId: SESSION, label: "L", date: "2026-09-20", type: "scrimmage", order: 2, teams: [{ teamId: "t1", colour: "Red" }] } }));
    assert.deepEqual(out.teams, [{ teamId: "t1", colour: "Red" }]);
  });

  test("getTryout includes teams", async () => {
    const mod = await loadResolver("Fn.getTryout.js");
    const out = mod.response(ctx({ stash: { tryoutId: TRYOUT }, result: { items: [
      { SK: "META", name: "n", season: "s", status: "open" },
      { SK: "TEAM#t1", teamId: "t1", name: "Team 1", players: ["W-14"] },
    ] } }));
    assert.deepEqual(out.teams, [{ id: "t1", name: "Team 1", colour: null, players: ["W-14"] }]);
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
      ["Mutation.addSession.1.count.js", { tryoutId: TRYOUT, label: "Skate 1", date: "2026-09-20", type: "skills" }],
      ["Mutation.addSession.2.put.js", { tryoutId: TRYOUT, label: "Skate 1", date: "2026-09-20", type: "skills" }],
      ["Mutation.upsertPlayers.js", { tryoutId: TRYOUT, players: [{ colour: "White", number: 14, position: "D" }] }],
      ["Mutation.updateSession.js", { tryoutId: TRYOUT, sessionId: SESSION, jersey: "secondary" }],
      ["Mutation.setPlayerActive.js", { tryoutId: TRYOUT, playerNumber: "W-14", active: false }],
      ["Mutation.updatePlayer.js", { tryoutId: TRYOUT, playerNumber: "W-14", position: "D" }],
      ["Mutation.setAttendance.js", { tryoutId: TRYOUT, sessionId: SESSION, playerNumber: "W-14", present: false }],
      ["Mutation.setSessionColours.js", { tryoutId: TRYOUT, sessionId: SESSION, colours: { "W-14": "Red" } }],
      ["Mutation.createTeam.js", { tryoutId: TRYOUT, name: "Team 1" }],
      ["Mutation.updateTeam.js", { tryoutId: TRYOUT, teamId: "team1", colour: "Red" }],
      ["Mutation.deleteTeam.js", { tryoutId: TRYOUT, teamId: "team1" }],
      ["Mutation.setTeamPlayers.js", { tryoutId: TRYOUT, teamId: "team1", players: ["W-14"] }],
      ["Mutation.setSessionTeams.1.getSession.js", { tryoutId: TRYOUT, sessionId: SESSION }],
      ["Mutation.setSessionTeams.2.put.js", { tryoutId: TRYOUT, sessionId: SESSION, teams: [{ teamId: "team1", colour: "Red" }] }],
      ["Mutation.deletePlayer.1.checkNoScores.js", { tryoutId: TRYOUT, playerNumber: "W-14" }],
      ["Mutation.deletePlayer.2.delete.js", { tryoutId: TRYOUT, playerNumber: "W-14" }],
      ["Mutation.changePlayerColour.1.checkNoScores.js", { tryoutId: TRYOUT, playerNumber: "W-14", colour: "Red" }],
      ["Mutation.setEvaluatorAccess.js", { tryoutId: TRYOUT, evaluatorId: EVALUATOR_SUB, enabled: true }],
      ["Mutation.closeTryout.1.close.js", { tryoutId: TRYOUT }],
      ["Mutation.addSelfAsEvaluator.js", { displayName: "Convenor" }],
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

  test("derives playerNumber from the PRIMARY colour letter + zero-padded number; secondary colour is optional", () => {
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, players: [
      { colour: "white", number: 7, position: "F", colour2: "green" }, { colour: "Blue", number: 14, position: "D", active: false },
    ] } }));
    assert.equal(req.operation, "BatchPutItem");
    const items = req.tables.TryoutTable.map(fromMapValues);
    assert.equal(items[0].playerNumber, "W-07", "identity uses the primary colour even when a secondary is set");
    assert.equal(items[0].colour, "White");
    assert.equal(items[0].colour2, "Green");
    assert.equal(items[1].colour2, null);
    assert.equal(items[0].active, true);
    assert.equal(items[1].playerNumber, "B-14");
    assert.equal(items[1].active, false);
    assert.equal(items[0].SK, "PLAYER#W-07");
  });

  test("rejects bad positions, colours, numbers, duplicates and >25 per call", () => {
    const base = { tryoutId: TRYOUT };
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { ...base, players: [{ colour: "White", number: 1, position: "C" }] } })), "BadRequest", /position/);
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { ...base, players: [{ colour: "Wh1te", number: 1, position: "F" }] } })), "BadRequest", /colour/);
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { ...base, players: [{ colour: "White", colour2: "Gr33n", number: 1, position: "F" }] } })), "BadRequest", /colour/);
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
  test("pointer step returns null (no stash) when no tryout exists, otherwise stashes id", async () => {
    const mod = await loadResolver("Query.currentTryout.1.getPointer.js");
    const req = mod.request(ctx({}));
    assert.deepEqual(fromMapValues(req.key), { PK: "CONFIG", SK: "CURRENT_TRYOUT" });
    const none = ctx({ result: null });
    assert.equal(mod.response(none), null);
    assert.equal(none.stash.tryoutId, undefined);
    const c = ctx({ result: { tryoutId: TRYOUT } });
    mod.response(c);
    assert.equal(c.stash.tryoutId, TRYOUT);
  });

  test("getTryout early-returns null when no tryout id is stashed", async () => {
    const mod = await loadResolver("Fn.getTryout.js");
    assert.throws(() => mod.request(ctx({ stash: {} })), (e) => e instanceof EarlyReturn && e.value === null);
  });

  test("getTryout assembles META + sessions + players + access; canEvaluate is per caller", async () => {
    const mod = await loadResolver("Fn.getTryout.js");
    const req = mod.request(ctx({ stash: { tryoutId: TRYOUT } }));
    assert.deepEqual(fromMapValues(req.query.expressionValues), { ":pk": `TRYOUT#${TRYOUT}` });
    const items = [
      { SK: `EVALUATOR#${EVALUATOR_SUB}`, evaluatorId: EVALUATOR_SUB, enabled: true },
      { SK: `EVALUATOR#${OTHER_SUB}`, evaluatorId: OTHER_SUB, enabled: false },
      { SK: "PLAYER#W-14", playerNumber: "W-14", colour: "White", number: 14, position: "D", active: true },
      { SK: "SESSION#s2", sessionId: "s2", label: "Skate 2", date: "2026-09-21", type: "scrimmage", order: 2 },
      { SK: "META", name: "2026-27 U13 Rep B", season: "2026-27", status: "open", createdAt: "2026-09-01T00:00:00.000Z" },
      { SK: "PLAYER#B-07", playerNumber: "B-07", colour: "Blue", number: 7, position: "F" },
      { SK: "SESSION#s1", sessionId: "s1", label: "Skate 1", date: "2026-09-20", type: "skills", order: 1 },
    ];
    const out = mod.response(ctx({ stash: { tryoutId: TRYOUT }, result: { items }, identity: evaluatorIdentity(EVALUATOR_SUB) }));
    assert.equal(out.canEvaluate, true, "enabled evaluator can evaluate");
    assert.deepEqual(out.evaluatorAccess.map((a) => [a.evaluatorId, a.enabled]).sort(), [[EVALUATOR_SUB, true], [OTHER_SUB, false]].sort());
    const disabled = mod.response(ctx({ stash: { tryoutId: TRYOUT }, result: { items }, identity: evaluatorIdentity(OTHER_SUB) }));
    assert.equal(disabled.canEvaluate, false, "disabled evaluator cannot");
    const stranger = mod.response(ctx({ stash: { tryoutId: TRYOUT }, result: { items }, identity: evaluatorIdentity("99999999-aaaa-4bbb-8ccc-000000000009") }));
    assert.equal(stranger.canEvaluate, false, "evaluator never added cannot");
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
    assert.equal(out.canEvaluate, false, "a new tryout starts with nobody allowed to score");
    assert.deepEqual(out.evaluatorAccess, []);
  });

  test("setEvaluatorAccess upserts TRYOUT#/EVALUATOR# with the enabled flag", async () => {
    const mod = await loadResolver("Mutation.setEvaluatorAccess.js");
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, evaluatorId: EVALUATOR_SUB, enabled: false } }));
    assert.equal(req.operation, "PutItem");
    assert.deepEqual(fromMapValues(req.key), { PK: `TRYOUT#${TRYOUT}`, SK: `EVALUATOR#${EVALUATOR_SUB}` });
    const attrs = fromMapValues(req.attributeValues);
    assert.equal(attrs.enabled, false);
    assert.equal(attrs.evaluatorId, EVALUATOR_SUB);
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, evaluatorId: "bad id!", enabled: true } })), "BadRequest", /evaluatorId/);
    const out = mod.response(ctx({ result: { evaluatorId: EVALUATOR_SUB, enabled: true, updatedAt: "2026-09-13T00:00:00.000Z", PK: "x", SK: "y" } }));
    assert.deepEqual(out, { evaluatorId: EVALUATOR_SUB, enabled: true, updatedAt: "2026-09-13T00:00:00.000Z" });
  });

  test("addSession validates date/type up front and gives the new session order = existing count + 1 (a small Int)", async () => {
    const count = await loadResolver("Mutation.addSession.1.count.js");
    const put = await loadResolver("Mutation.addSession.2.put.js");
    const args = { tryoutId: TRYOUT, label: "Skate 1", date: "2026-09-20", type: "skills" };
    const q = count.request(ctx({ identity: adminIdentity(), args }));
    assert.equal(q.operation, "Query");
    assert.equal(q.select, "COUNT");
    assert.deepEqual(fromMapValues(q.query.expressionValues), { ":pk": `TRYOUT#${TRYOUT}`, ":sk": "SESSION#" });
    throwsType(() => count.request(ctx({ identity: adminIdentity(), args: { ...args, date: "20/09/2026" } })), "BadRequest", /date/);
    throwsType(() => count.request(ctx({ identity: adminIdentity(), args: { ...args, type: "practice" } })), "BadRequest", /type/);
    const c = ctx({ identity: adminIdentity(), args, result: { items: [], scannedCount: 3 } });
    count.response(c);
    assert.equal(c.stash.order, 4);
    const req = put.request(c);
    assert.equal(req.operation, "PutItem");
    const attrs = fromMapValues(req.attributeValues);
    assert.equal(attrs.order, 4);
    assert.ok(attrs.order <= 2147483647, "order must fit a GraphQL Int");
    // first session of a tryout
    const first = ctx({ identity: adminIdentity(), args, result: { items: [], scannedCount: 0 } });
    count.response(first);
    assert.equal(fromMapValues(put.request(first).attributeValues).order, 1);
    // jersey defaults to primary and must be primary|secondary
    assert.equal(fromMapValues(put.request(first).attributeValues).jersey, "primary");
    const sec = ctx({ identity: adminIdentity(), args: { ...args, jersey: "secondary" }, result: { items: [], scannedCount: 0 } });
    count.response(sec);
    assert.equal(fromMapValues(put.request(sec).attributeValues).jersey, "secondary");
    throwsType(() => count.request(ctx({ identity: adminIdentity(), args: { ...args, jersey: "third" } })), "BadRequest", /jersey/);
  });

  test("updateSession changes only the fields given and rejects an empty update", async () => {
    const mod = await loadResolver("Mutation.updateSession.js");
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, jersey: "secondary" } }));
    assert.equal(req.operation, "UpdateItem");
    assert.equal(req.update.expression, "SET #jersey = :jersey");
    assert.deepEqual(req.update.expressionNames, { "#jersey": "jersey" });
    assert.deepEqual(fromMapValues(req.update.expressionValues), { ":jersey": "secondary" });
    assert.equal(req.condition.expression, "attribute_exists(PK)");
    const two = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, label: " Skate 3 ", type: "game" } }));
    assert.equal(two.update.expression, "SET #label = :label, #type = :type");
    assert.deepEqual(fromMapValues(two.update.expressionValues), { ":label": "Skate 3", ":type": "game" });
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION } })), "BadRequest", /Nothing/);
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, jersey: "both" } })), "BadRequest", /jersey/);
    const out = mod.response(ctx({ result: { sessionId: SESSION, label: "L", date: "2026-09-20", type: "game", order: 2 } }));
    assert.equal(out.jersey, "primary", "sessions created before the jersey field default to primary");
  });

  test("setPlayerActive updates only the active flag with an existence condition", async () => {
    const mod = await loadResolver("Mutation.setPlayerActive.js");
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, playerNumber: "W-14", active: false } }));
    assert.equal(req.operation, "UpdateItem");
    assert.equal(req.update.expression, "SET active = :active");
    assert.equal(fromMapValues(req.update.expressionValues)[":active"], false);
    assert.equal(req.condition.expression, "attribute_exists(PK)");
  });

  test("updatePlayer changes position and/or secondary colour only; identity fields are untouchable", async () => {
    const mod = await loadResolver("Mutation.updatePlayer.js");
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, playerNumber: "W-14", position: "D", colour: "Red", number: 99 } }));
    assert.equal(req.operation, "UpdateItem");
    assert.equal(req.update.expression, "SET #position = :position", "colour/number args are ignored");
    assert.deepEqual(fromMapValues(req.update.expressionValues), { ":position": "D" });
    const c2 = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, playerNumber: "W-14", colour2: "green" } }));
    assert.deepEqual(fromMapValues(c2.update.expressionValues), { ":colour2": "Green" });
    const clear = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, playerNumber: "W-14", colour2: "" } }));
    assert.deepEqual(fromMapValues(clear.update.expressionValues), { ":colour2": null });
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, playerNumber: "W-14", position: "C" } })), "BadRequest", /position/);
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, playerNumber: "W-14" } })), "BadRequest", /Nothing/);
  });

  test("setAttendance adds to / removes from the session's absent string set", async () => {
    const mod = await loadResolver("Mutation.setAttendance.js");
    const absent = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, playerNumber: "W-14", present: false } }));
    assert.equal(absent.operation, "UpdateItem");
    assert.equal(absent.update.expression, "ADD #absent :p");
    assert.deepEqual(absent.update.expressionValues[":p"], { SS: ["W-14"] });
    assert.deepEqual(fromMapValues(absent.key), { PK: `TRYOUT#${TRYOUT}`, SK: `SESSION#${SESSION}` });
    const present = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, playerNumber: "W-14", present: true } }));
    assert.equal(present.update.expression, "DELETE #absent :p");
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, playerNumber: "Smith-14", present: false } })), "BadRequest", /playerNumber/);
    const out = mod.response(ctx({ result: { sessionId: SESSION, label: "L", date: "2026-09-20", type: "skills", order: 1, absent: ["W-14"] } }));
    assert.deepEqual(out.absent, ["W-14"]);
    const none = mod.response(ctx({ result: { sessionId: SESSION, label: "L", date: "2026-09-20", type: "skills", order: 1 } }));
    assert.deepEqual(none.absent, [], "absent defaults to an empty list");
  });

  test("setSessionColours replaces the per-player colour map after validating keys and values", async () => {
    const mod = await loadResolver("Mutation.setSessionColours.js");
    const req = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, colours: { "W-14": "red", "B-07": "White", "W-04": "" } } }));
    assert.equal(req.operation, "UpdateItem");
    assert.equal(req.update.expression, "SET #colours = :colours");
    assert.deepEqual(fromMapValues(req.update.expressionValues), { ":colours": { "W-14": "Red", "B-07": "White" } });
    const str = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, colours: JSON.stringify({ "W-14": "Green" }) } }));
    assert.deepEqual(fromMapValues(str.update.expressionValues), { ":colours": { "W-14": "Green" } }, "AWSJSON string form is accepted");
    const empty = mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, colours: {} } }));
    assert.deepEqual(fromMapValues(empty.update.expressionValues), { ":colours": {} }, "empty map clears overrides");
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, colours: { "Smith-14": "Red" } } })), "BadRequest", /playerNumber/);
    throwsType(() => mod.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, sessionId: SESSION, colours: { "W-14": "R3d" } } })), "BadRequest", /colour/);
    const out = mod.response(ctx({ result: { sessionId: SESSION, label: "L", date: "2026-09-20", type: "skills", order: 1, colours: { "W-14": "Red" } } }));
    assert.deepEqual(out.colours, { "W-14": "Red" });
    assert.deepEqual(mod.response(ctx({ result: { sessionId: SESSION, label: "L", date: "2026-09-20", type: "skills", order: 1 } })).colours, {}, "defaults to empty map");
  });

  test("player tag: short, upper-cased, never free text long enough for a name", async () => {
    const upd = await loadResolver("Mutation.updatePlayer.js");
    const req = upd.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, playerNumber: "W-14", tag: " aa " } }));
    assert.deepEqual(fromMapValues(req.update.expressionValues), { ":tag": "AA" });
    const clear = upd.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, playerNumber: "W-14", tag: "" } }));
    assert.deepEqual(fromMapValues(clear.update.expressionValues), { ":tag": null });
    throwsType(() => upd.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, playerNumber: "W-14", tag: "John Smith AA" } })), "BadRequest", /tag/);
    throwsType(() => upd.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, playerNumber: "W-14", tag: "A.A" } })), "BadRequest", /tag/);
    const ups = await loadResolver("Mutation.upsertPlayers.js");
    const put = ups.request(ctx({ identity: adminIdentity(), args: { tryoutId: TRYOUT, players: [{ colour: "White", number: 7, position: "F", tag: "aa" }, { colour: "White", number: 8, position: "F" }] } }));
    const items = put.tables.TryoutTable.map(fromMapValues);
    assert.equal(items[0].tag, "AA");
    assert.equal(items[1].tag, null);
  });

  test("deletePlayer refuses when the player has scores, otherwise deletes the row", async () => {
    const check = await loadResolver("Mutation.deletePlayer.1.checkNoScores.js");
    const del = await loadResolver("Mutation.deletePlayer.2.delete.js");
    const args = { tryoutId: TRYOUT, playerNumber: "W-14" };
    const q = check.request(ctx({ identity: adminIdentity(), args }));
    assert.equal(q.index, "GSI1");
    assert.deepEqual(fromMapValues(q.query.expressionValues), { ":pk": `TRYOUT#${TRYOUT}#PLAYER#W-14` });
    throwsType(() => check.response(ctx({ args, result: { items: [], scannedCount: 2 } })), "HasScores", /Release/);
    assert.equal(check.response(ctx({ args, result: { items: [], scannedCount: 0 } })), 0);
    const d = del.request(ctx({ identity: adminIdentity(), args }));
    assert.equal(d.operation, "DeleteItem");
    assert.deepEqual(fromMapValues(d.key), { PK: `TRYOUT#${TRYOUT}`, SK: "PLAYER#W-14" });
    assert.equal(d.condition.expression, "attribute_exists(PK)");
    assert.equal(del.response(ctx({ args, result: { PK: "x" } })), "W-14");
  });

  test("changePlayerColour: refuses with scores, moves the row atomically to the new code", async () => {
    const check = await loadResolver("Mutation.changePlayerColour.1.checkNoScores.js");
    const get = await loadResolver("Mutation.changePlayerColour.2.get.js");
    const move = await loadResolver("Mutation.changePlayerColour.3.move.js");
    const args = { tryoutId: TRYOUT, playerNumber: "W-14", colour: "red" };
    assert.equal(check.request(ctx({ identity: adminIdentity(), args })).index, "GSI1");
    throwsType(() => check.response(ctx({ args, result: { items: [], scannedCount: 1 } })), "HasScores", /cannot change/);
    throwsType(() => check.request(ctx({ identity: adminIdentity(), args: { ...args, colour: "R3d" } })), "BadRequest", /colour/);
    const c = ctx({ identity: adminIdentity(), args });
    assert.deepEqual(fromMapValues(get.request(c).key), { PK: `TRYOUT#${TRYOUT}`, SK: "PLAYER#W-14" });
    c.result = { tryoutId: TRYOUT, playerNumber: "W-14", colour: "White", colour2: "Green", number: 14, position: "D", active: true, tag: "AA" };
    get.response(c);
    const req = move.request(c);
    assert.equal(req.operation, "TransactWriteItems");
    const [put, del] = req.transactItems;
    assert.equal(put.operation, "PutItem");
    assert.deepEqual(fromMapValues(put.key), { PK: `TRYOUT#${TRYOUT}`, SK: "PLAYER#R-14" });
    const attrs = fromMapValues(put.attributeValues);
    assert.equal(attrs.colour, "Red"); assert.equal(attrs.colour2, "Green"); assert.equal(attrs.tag, "AA"); assert.equal(attrs.position, "D");
    assert.equal(put.condition.expression, "attribute_not_exists(PK)");
    assert.equal(del.operation, "DeleteItem");
    assert.deepEqual(fromMapValues(del.key), { PK: `TRYOUT#${TRYOUT}`, SK: "PLAYER#W-14" });
    assert.equal(move.response(ctx({ stash: c.stash, result: { keys: [] } })).playerNumber, "R-14");
    throwsType(() => move.response(ctx({ stash: c.stash, error: { message: "x", type: "DynamoDB:TransactionCanceledException" } })), "Conflict", /already exists/);
    const same = ctx({ identity: adminIdentity(), args: { ...args, colour: "White" }, stash: c.stash });
    throwsType(() => move.request(same), "BadRequest", /already/);
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

describe("Mutation.addSelfAsEvaluator", () => {
  test("writes a profile row for the caller's own sub, never for an id from args", async () => {
    const mod = await loadResolver("Mutation.addSelfAsEvaluator.js");
    const req = mod.request(ctx({ identity: adminIdentity(), args: { displayName: " Convenor ", id: OTHER_SUB, evaluatorId: OTHER_SUB } }));
    assert.equal(req.operation, "PutItem");
    assert.deepEqual(fromMapValues(req.key), { PK: `USER#${ADMIN_SUB}`, SK: "META" });
    const attrs = fromMapValues(req.attributeValues);
    assert.equal(attrs.userId, ADMIN_SUB); assert.equal(attrs.displayName, "Convenor"); assert.equal(attrs.role, "admin"); assert.equal(attrs.GSI1PK, "USERS");
    assert.ok(!JSON.stringify(req).includes(OTHER_SUB));
    throwsType(() => mod.request(ctx({ identity: evaluatorIdentity(), args: { displayName: "x" } })), "Unauthorized");
    assert.deepEqual(mod.response(ctx({ result: { userId: ADMIN_SUB, displayName: "Convenor", role: "admin" } })), { id: ADMIN_SUB, displayName: "Convenor", role: "admin" });
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
