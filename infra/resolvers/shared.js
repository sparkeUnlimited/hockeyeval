// Helpers shared by every AppSync JS resolver. Bundled into each resolver by esbuild at synth time.
// Runtime is APPSYNC_JS: no classes, no try/catch, no for..in, no recursion.
import { util } from "@aws-appsync/utils";
import { keysFor, isValidScore, NOTES_MAX } from "../../web/js/criteria.js";

export const TABLE_NAME = "TryoutTable";

export const CONFIG_PK = "CONFIG";
export const CURRENT_TRYOUT_SK = "CURRENT_TRYOUT";
export const USERS_GSI1PK = "USERS";

export const tryoutPK = (tryoutId) => `TRYOUT#${tryoutId}`;
export const sessionSK = (sessionId) => `SESSION#${sessionId}`;
export const playerSK = (playerNumber) => `PLAYER#${playerNumber}`;
export const evaluatorSK = (sub) => `EVALUATOR#${sub}`;
export const teamSK = (teamId) => `TEAM#${teamId}`;
export const evalPK = (tryoutId, sessionId, sub) => `EVAL#${tryoutId}#${sessionId}#${sub}`;
export const evalGSI1PK = (tryoutId, playerNumber) => `TRYOUT#${tryoutId}#PLAYER#${playerNumber}`;
export const evalGSI1SK = (sessionId, sub) => `SESSION#${sessionId}#EVAL#${sub}`;
export const evalGSI2PK = (tryoutId) => `TRYOUT#${tryoutId}#EVALS`;
export const evalGSI2SK = (sessionId, sub, playerNumber) => `SESSION#${sessionId}#EVAL#${sub}#PLAYER#${playerNumber}`;

// Patterns as strings: APPSYNC_JS has no regex literals; use util.matches(pattern, value).
const ID_RE = "^[A-Za-z0-9_-]{1,64}$";
const PLAYER_NUMBER_RE = "^[A-Z]-[0-9]{2,3}$";
const DATE_RE = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";
const COLOUR_RE = "^[A-Za-z]{2,20}$";
const TAG_RE = "^[A-Za-z0-9 +-]{1,12}$";
const TEAM_NAME_RE = "^[A-Za-z0-9 #&+-]{1,30}$";
const SESSION_TYPES = ["skills", "scrimmage", "game"];
const JERSEYS = ["primary", "secondary"];
const POSITIONS = ["F", "D", "G"];
const TIERS = ["A", "B", "C", "X"];

export function isAdmin(ctx) {
  const groups = ctx.identity && ctx.identity.groups;
  return !!groups && groups.includes("admin");
}

/** Defence in depth: the schema already gates admin fields with @aws_auth. */
export function requireAdmin(ctx) {
  if (!isAdmin(ctx)) util.unauthorized();
}

export function requireSub(ctx) {
  const sub = ctx.identity && ctx.identity.sub;
  if (!sub) util.unauthorized();
  return sub;
}

export function requireId(value, what) {
  if (typeof value !== "string" || !util.matches(ID_RE, value)) util.error(`Invalid ${what}`, "BadRequest");
  return value;
}

export function requirePlayerNumber(value) {
  if (typeof value !== "string" || !util.matches(PLAYER_NUMBER_RE, value)) util.error("Invalid playerNumber", "BadRequest");
  return value;
}

export function requireDate(value) {
  if (typeof value !== "string" || !util.matches(DATE_RE, value)) util.error("Invalid date", "BadRequest");
  return value;
}

export function requireText(value, what, max) {
  if (typeof value !== "string") util.error(`Missing ${what}`, "BadRequest");
  const t = value.trim();
  if (t.length === 0 || t.length > max) util.error(`${what} must be 1-${max} characters`, "BadRequest");
  return t;
}

export function requireSessionType(value) {
  if (!SESSION_TYPES.includes(value)) util.error("type must be skills, scrimmage or game", "BadRequest");
  return value;
}

export function requireJersey(value) {
  if (value === null || value === undefined || value === "") return "primary";
  if (!JERSEYS.includes(value)) util.error("jersey must be primary or secondary", "BadRequest");
  return value;
}

/** Optional secondary colour: null when absent, otherwise validated like the primary. */
export function optionalColour(value) {
  if (value === null || value === undefined || value === "") return null;
  return requireColour(value);
}

export function requireTeamName(value) {
  if (typeof value !== "string") util.error("Missing team name", "BadRequest");
  const t = value.trim();
  if (!util.matches(TEAM_NAME_RE, t)) util.error("Team name must be 1-30 letters, digits, spaces, # & + -", "BadRequest");
  return t;
}

/** A list of player codes, de-duplicated, max 200. */
export function requirePlayerList(value) {
  if (!Array.isArray(value)) util.error("players must be a list", "BadRequest");
  if (value.length > 200) util.error("Too many players", "BadRequest");
  const seen = {};
  const out = [];
  for (const v of value) {
    requirePlayerNumber(v);
    if (!seen[v]) { seen[v] = true; out.push(v); }
  }
  return out;
}

/** [{ teamId, colour }] for a session, max 8 teams, unique ids, colours validated. */
export function requireSessionTeams(value) {
  if (!Array.isArray(value)) util.error("teams must be a list", "BadRequest");
  if (value.length > 8) util.error("At most 8 teams per session", "BadRequest");
  const seen = {};
  const out = [];
  for (const t of value) {
    const teamId = requireId(t && t.teamId, "teamId");
    if (seen[teamId]) util.error(`Team ${teamId} listed twice`, "BadRequest");
    seen[teamId] = true;
    out.push({ teamId, colour: requireColour(t.colour) });
  }
  return out;
}

export function toTeam(item) {
  return { id: item.teamId, name: item.name, colour: item.colour || null, players: item.players || [] };
}

/** { playerNumber: colour } map for a session. Keys must be player codes, values colour names. Max 200. */
export function sanitizeColourMap(raw) {
  let map = raw;
  if (typeof map === "string") map = JSON.parse(map);
  if (!map || typeof map !== "object") util.error("colours must be a JSON object", "BadRequest");
  const keys = Object.keys(map);
  if (keys.length > 200) util.error("Too many players", "BadRequest");
  const clean = {};
  for (const k of keys) {
    requirePlayerNumber(k);
    const v = map[k];
    if (v !== null && v !== undefined && v !== "") clean[k] = requireColour(v); // blank = no override
  }
  return clean;
}

/** Optional short tag such as "AA". Empty clears it. Letters, digits, space, + and - only: never a name. */
export function optionalTag(value) {
  if (value === null || value === undefined) return null;
  const t = value.trim();
  if (t.length === 0) return null;
  if (!util.matches(TAG_RE, t)) util.error("tag must be 1-12 letters, digits, spaces, + or -", "BadRequest");
  return t.toUpperCase();
}

export function requirePosition(value) {
  if (!POSITIONS.includes(value)) util.error("position must be F, D or G", "BadRequest");
  return value;
}

export function requireColour(value) {
  if (typeof value !== "string" || !util.matches(COLOUR_RE, value)) util.error("colour must be letters only", "BadRequest");
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function requireNumber(value) {
  if (typeof value !== "number" || Math.floor(value) !== value || value < 0 || value > 999) {
    util.error("number must be an integer 0-999", "BadRequest");
  }
  return value;
}

/** "White", 7 -> "W-07" */
export function makePlayerNumber(colour, number) {
  const code = colour.charAt(0).toUpperCase();
  const n = number < 10 ? `0${number}` : `${number}`;
  return `${code}-${n}`;
}

/** Keep only known criteria for the position with integer values 1..5. */
export function sanitizeScores(position, raw) {
  let scores = raw;
  if (typeof scores === "string") scores = JSON.parse(scores);
  if (!scores || typeof scores !== "object") util.error("scores must be a JSON object", "BadRequest");
  const allowed = keysFor(position);
  const clean = {};
  for (const k of Object.keys(scores)) {
    const v = scores[k];
    if (allowed.includes(k) && isValidScore(v)) clean[k] = v;
  }
  return clean;
}

export function sanitizeTier(tier) {
  if (tier === null || tier === undefined || tier === "") return null;
  if (!TIERS.includes(tier)) util.error("tier must be A, B, C or X", "BadRequest");
  return tier;
}

export function sanitizeNotes(notes) {
  if (notes === null || notes === undefined) return null;
  if (typeof notes !== "string") util.error("notes must be a string", "BadRequest");
  const t = notes.trim();
  if (t.length === 0) return null;
  return t.length > NOTES_MAX ? t.slice(0, NOTES_MAX) : t;
}

export function toEvaluation(item) {
  return {
    playerNumber: item.playerNumber,
    sessionId: item.sessionId,
    evaluatorId: item.evaluatorId,
    scores: item.scores || {},
    tier: item.tier || null,
    notes: item.notes || null,
    updatedAt: item.updatedAt,
    clientId: item.clientId || null,
  };
}

export function toPlayer(item) {
  return {
    playerNumber: item.playerNumber,
    colour: item.colour,
    colour2: item.colour2 || null,
    number: item.number,
    position: item.position,
    active: item.active !== false,
    tag: item.tag || null,
  };
}

export function toSession(item) {
  return {
    id: item.sessionId, label: item.label, date: item.date, type: item.type, order: item.order,
    jersey: item.jersey || "primary", absent: item.absent || [], colours: item.colours || {}, teams: item.teams || [],
  };
}

export function toEvaluatorAccess(item) {
  return { evaluatorId: item.evaluatorId, enabled: item.enabled !== false, updatedAt: item.updatedAt || null };
}

/**
 * Build a Tryout from the items of Query PK = TRYOUT#<id> (META + SESSION# + PLAYER# + EVALUATOR#).
 * canEvaluate is computed for the caller (sub); evaluatorAccess is only returned to admins by the schema.
 */
export function assembleTryout(tryoutId, items, sub) {
  let meta = null;
  const sessions = [];
  const players = [];
  const teams = [];
  const evaluatorAccess = [];
  let canEvaluate = false;
  for (const it of items) {
    if (it.SK === "META") meta = it;
    else if (it.SK.startsWith("SESSION#")) sessions.push(toSession(it));
    else if (it.SK.startsWith("PLAYER#")) players.push(toPlayer(it));
    else if (it.SK.startsWith("TEAM#")) teams.push(toTeam(it));
    else if (it.SK.startsWith("EVALUATOR#")) {
      evaluatorAccess.push(toEvaluatorAccess(it));
      if (sub && it.evaluatorId === sub && it.enabled !== false) canEvaluate = true;
    }
  }
  if (!meta) return null;
  // No comparator sorts in APPSYNC_JS: clients sort sessions by date/order and players by colour/number.
  return {
    id: tryoutId,
    name: meta.name,
    season: meta.season,
    status: meta.status,
    createdAt: meta.createdAt || null,
    sessions,
    players,
    teams,
    canEvaluate,
    evaluatorAccess,
  };
}

export function failOnError(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
}

export function ddbGet(PK, SK) {
  return { operation: "GetItem", key: util.dynamodb.toMapValues({ PK, SK }) };
}
