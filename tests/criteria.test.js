import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CRITERIA, SCALE, TIERS, criteriaFor, keysFor, weightedScore, isValidScore,
} from "../web/js/criteria.js";

test("rubric shape: scale has 1..5, tiers A/B/C/X, every criterion has key/label/for/weight/help", () => {
  assert.deepEqual(Object.keys(SCALE).map(Number), [1, 2, 3, 4, 5]);
  assert.deepEqual(Object.keys(TIERS), ["A", "B", "C", "X"]);
  for (const c of CRITERIA) {
    assert.ok(c.key && c.label && c.help, `criterion ${c.key} missing fields`);
    assert.ok(Array.isArray(c.for) && c.for.length > 0);
    assert.ok(typeof c.short === "string" && c.short.length <= 10, `criterion ${c.key} needs a short heading`);
    assert.ok(c.weight > 0);
  }
  const keys = CRITERIA.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length, "criterion keys are unique");
});

test("no criterion label or help text asks for a name", () => {
  for (const c of CRITERIA) {
    assert.ok(!/\bname\b/i.test(c.label + " " + c.help), `${c.key} mentions name`);
  }
});

test("a forward is scored only on forward criteria", () => {
  const keys = keysFor("F");
  assert.deepEqual(keys, ["skating", "puck", "passing", "shooting", "sense", "compete", "coachable", "offence"]);
  assert.ok(!keys.includes("dzone"));
  assert.ok(!keys.some((k) => k.startsWith("g_")));
  // Scores on non-forward criteria are ignored
  const withD = weightedScore("F", { skating: 5, dzone: 1, g_save: 1 });
  assert.equal(withD, 5);
});

test("a defenceman gets dzone but not offence; a goalie gets only goalie criteria + coachability", () => {
  assert.ok(keysFor("D").includes("dzone"));
  assert.ok(!keysFor("D").includes("offence"));
  assert.deepEqual(keysFor("G"), ["coachable", "g_skating", "g_save", "g_rebound", "g_sense", "g_compete"]);
});

test("blank criteria are ignored", () => {
  // Only skating (1.5) and passing (1.0) scored
  const s = weightedScore("D", { skating: 4, passing: 2, puck: null, shooting: undefined });
  assert.equal(s, (4 * 1.5 + 2 * 1.0) / 2.5);
});

test("weights are applied", () => {
  // skating weight 1.5 vs shooting weight 1.0: a 5 in skating and 1 in shooting should lean toward 5
  const s = weightedScore("F", { skating: 5, shooting: 1 });
  assert.equal(s, (5 * 1.5 + 1 * 1.0) / 2.5);
  assert.ok(s > 3, "weighted toward skating");
  // equal weights option gives plain mean
  assert.equal(weightedScore("F", { skating: 5, shooting: 1 }, { equalWeights: true }), 3);
});

test("all-blank returns null", () => {
  assert.equal(weightedScore("F", {}), null);
  assert.equal(weightedScore("F", { skating: null, puck: undefined }), null);
  assert.equal(weightedScore("G", null), null);
  assert.equal(weightedScore("F", { dzone: 5 }), null, "only non-applicable keys → null");
});

test("invalid values (0, 6, 3.5, strings) are treated as blank", () => {
  assert.equal(isValidScore(0), false);
  assert.equal(isValidScore(6), false);
  assert.equal(isValidScore(3.5), false);
  assert.equal(isValidScore("3"), false);
  assert.equal(isValidScore(3), true);
  assert.equal(weightedScore("F", { skating: 6, puck: "4", passing: 3 }), 3);
});

test("full sheet all 3s scores exactly 3 regardless of weights", () => {
  for (const pos of ["F", "D", "G"]) {
    const scores = Object.fromEntries(criteriaFor(pos).map((c) => [c.key, 3]));
    assert.equal(weightedScore(pos, scores), 3);
    assert.equal(weightedScore(pos, scores, { equalWeights: true }), 3);
  }
});
