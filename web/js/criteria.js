// Single source of truth for the scoring rubric. `short` is the column heading used in wide admin tables.
// Used by the evaluator form, the admin rankings/CSV export, and the tests.
// Nothing in this file may identify a player: players are pinnie colour + number only.

export const SCALE = {
  1: "Well below the group — not at this level yet",
  2: "Below the group — inconsistent, noticeable gaps",
  3: "At the group — solid, what you expect from a Rep B player",
  4: "Above the group — stands out most shifts",
  5: "Top of the group — dominant, would start on any line",
};

export const CRITERIA = [
  // Skaters (F and D)
  { key: "speed",     label: "Skating Speed",     short: "Speed", for: ["F", "D"], weight: 1.0,
    help: "Top speed, first three strides, acceleration out of stops and turns, keeps pace with the play" },
  { key: "mobility",  label: "Skating Mobility",  short: "Mobility", for: ["F", "D"], weight: 1.0,
    help: "Edges, crossovers both ways, tight turns, backward skating, pivots and transitions without losing speed" },
  { key: "puck",      label: "Puck Control",      short: "Puck", for: ["F", "D"], weight: 1.0,
    help: "Handles in traffic with head up, protects the puck, receives hard/bad passes, controls at speed" },
  { key: "passing",   label: "Passing",           short: "Passing", for: ["F", "D"], weight: 1.0,
    help: "Accuracy and timing forehand/backhand, passes to space, tape-to-tape under pressure" },
  { key: "shooting",  label: "Shooting",          short: "Shooting", for: ["F", "D"], weight: 1.0,
    help: "Quick release, accuracy, shoots in stride, picks the right shot" },
  { key: "sense",     label: "Hockey Sense",      short: "Sense", for: ["F", "D"], weight: 1.5,
    help: "Positioning, anticipation, reads the play, supports the puck, makes the simple play" },
  { key: "compete",   label: "Compete Level",     short: "Compete", for: ["F", "D"], weight: 1.5,
    help: "Wins battles, back-checks every time, second effort, plays hard in drills not just games" },
  // Defence extras
  { key: "dzone",     label: "Defensive Play",    short: "Defence", for: ["D"], weight: 1.0,
    help: "Gap control, angling, stick on puck, boxes out in front, first pass out of the zone" },
  // Forward extras
  { key: "offence",   label: "Offensive Play",    short: "Offence", for: ["F"], weight: 1.0,
    help: "Drives the net, finds open ice, forecheck angles, creates chances" },
  // Goalies
  { key: "g_skating", label: "Crease Movement",   short: "Crease", for: ["G"], weight: 1.5,
    help: "T-pushes, shuffles, recovers to feet quickly, square to the shooter" },
  { key: "g_save",    label: "Save Technique",    short: "Saves", for: ["G"], weight: 1.5,
    help: "Butterfly control, glove/blocker, sealing the ice, tracks the puck through screens" },
  { key: "g_rebound", label: "Rebound Control",   short: "Rebounds", for: ["G"], weight: 1.0,
    help: "Directs rebounds to corners, covers loose pucks, doesn't give second chances" },
  { key: "g_sense",   label: "Game Awareness",    short: "Aware", for: ["G"], weight: 1.0,
    help: "Reads 2-on-1s, plays the puck sensibly, communicates with D, stays composed after a goal" },
  { key: "g_compete", label: "Compete Level",     short: "G Compete", for: ["G"], weight: 1.0,
    help: "Battles for sightlines, fights through traffic, effort on every rep in drills" },
];

export const TIERS = {
  A: "Clear make — top group",
  B: "Bubble — needs another look",
  C: "Below this level",
  X: "Did not see enough to rate",
};

export const POSITIONS = ["F", "D", "G"];

/** Criteria that apply to a position, in rubric order. */
export function criteriaFor(position) {
  return CRITERIA.filter((c) => c.for.includes(position));
}

/** Set of valid score keys for a position (used by resolvers and the form). */
export function keysFor(position) {
  return criteriaFor(position).map((c) => c.key);
}

/**
 * Weighted average across the criteria that apply to the player's position,
 * ignoring any criterion left blank. Returns null if nothing scored.
 *
 * @param {"F"|"D"|"G"} position
 * @param {Record<string, number|null|undefined>} scores  criterionKey -> 1..5
 * @param {{equalWeights?: boolean}} [opts]  equalWeights=true ignores rubric weights
 * @returns {number|null}
 */
export function weightedScore(position, scores, opts = {}) {
  if (!scores || typeof scores !== "object") return null;
  let num = 0;
  let den = 0;
  for (const c of criteriaFor(position)) {
    const v = scores[c.key];
    if (!isValidScore(v)) continue;
    const w = opts.equalWeights ? 1 : c.weight;
    num += v * w;
    den += w;
  }
  return den === 0 ? null : num / den;
}

/** True when v is an integer 1..5. */
export function isValidScore(v) {
  return typeof v === "number" && Math.floor(v) === v && v >= 1 && v <= 5;
}

export const NOTES_MAX = 280;
