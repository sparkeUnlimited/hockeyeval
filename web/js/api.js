// GraphQL fetch wrapper + offline outbox.
//
// Every evaluation write goes into the outbox FIRST (IndexedDB, falling back to localStorage),
// then we try to send. The outbox is flushed in order on page load, on the `online` event,
// when the tab becomes visible and every 30 s. Entries are keyed by clientId so a re-tap on the
// same player replaces the queued entry and replays are idempotent server-side (upsert).
import { config } from "./config.js";
import { getIdToken, store as kv } from "./auth.js";

export class NetworkError extends Error { constructor(m) { super(m || "Network error"); this.name = "NetworkError"; } }
export class AuthError extends Error { constructor(m) { super(m || "Not signed in"); this.name = "AuthError"; } }
export class GqlError extends Error {
  constructor(errors) {
    super(errors.map((e) => e.message).join("; ") || "Request failed");
    this.name = "GqlError";
    this.errors = errors;
    this.type = errors[0]?.errorType || "";
  }
}

/** POST a GraphQL document. Throws NetworkError / AuthError / GqlError. */
export async function gql(query, variables = {}) {
  const token = await getIdToken();
  if (!token) throw new AuthError();
  let res;
  try {
    res = await fetch(config.graphqlUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new NetworkError(e.message);
  }
  if (res.status === 401 || res.status === 403) throw new AuthError("Session expired");
  let body;
  try { body = await res.json(); } catch { throw new NetworkError("Bad response"); }
  if (body.errors?.length) {
    if (body.errors.some((e) => /Unauthorized/i.test(e.errorType || e.message))) throw new AuthError(body.errors[0].message);
    throw new GqlError(body.errors);
  }
  return body.data;
}

// ----------------------------------------------------------------------------- Outbox storage
const DB_NAME = "tryout-evaluator";
const STORE = "outbox";
const LS_KEY = "outbox";

function idbStore() {
  let dbp = null;
  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return reject(e); }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientId" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
    });
    return dbp;
  };
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      let out;
      try { out = fn(s); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && "result" in out ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("aborted"));
    });
  };
  return {
    name: "indexeddb",
    all: () => tx("readonly", (s) => s.getAll()),
    put: (entry) => tx("readwrite", (s) => s.put(entry)),
    get: (id) => tx("readonly", (s) => s.get(id)),
    /** Delete only if the stored entry still has this version (a newer tap must not be lost). */
    deleteIfVersion: (id, version) => tx("readwrite", (s) => {
      const g = s.get(id);
      g.onsuccess = () => { if (g.result && g.result.version === version) s.delete(id); };
    }),
  };
}

function lsStore() {
  const read = () => kv.get(LS_KEY, {});
  const write = (m) => kv.set(LS_KEY, m);
  return {
    name: "localstorage",
    all: async () => Object.values(read()),
    put: async (entry) => { const m = read(); m[entry.clientId] = entry; write(m); },
    get: async (id) => read()[id],
    deleteIfVersion: async (id, version) => { const m = read(); if (m[id] && m[id].version === version) { delete m[id]; write(m); } },
  };
}

let storePromise = null;
async function outbox() {
  if (storePromise) return storePromise;
  storePromise = (async () => {
    try {
      const s = idbStore();
      await s.all(); // forces open; throws in some private modes
      return s;
    } catch {
      return lsStore();
    }
  })();
  return storePromise;
}

// ----------------------------------------------------------------------------- Status
const status = { online: navigator.onLine, queued: 0, failed: 0, flushing: false, needsSignIn: false, storage: "" };
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); fn({ ...status }); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn({ ...status }); } catch { /* listener error */ } } }

let currentSub = null;
/** Tell the outbox whose items to flush (entries carry the sub they were queued under). */
export function setCurrentUser(sub) { currentSub = sub; }

async function recount() {
  const s = await outbox();
  const all = (await s.all()).filter((e) => !currentSub || e.sub === currentSub);
  status.queued = all.filter((e) => !e.permanent).length;
  status.failed = all.filter((e) => e.permanent).length;
  status.storage = s.name;
  status.online = navigator.onLine;
  emit();
}

let seq = 0;
/**
 * Queue an evaluation write and try to send it. Resolves once persisted locally (never waits for the network).
 * variables: { tryoutId, sessionId, playerNumber, scores (object), tier, notes, clientId }
 */
export async function enqueueEvaluation(variables, sub) {
  const s = await outbox();
  const entry = {
    clientId: variables.clientId,
    kind: "upsertEvaluation",
    variables,
    sub,
    queuedAt: Date.now(),
    version: `${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}`,
    attempts: 0,
    permanent: false,
    lastError: null,
  };
  await s.put(entry);
  await recount();
  flush(); // fire and forget
  return entry;
}

export async function failedEntries() {
  const s = await outbox();
  return (await s.all()).filter((e) => e.permanent && (!currentSub || e.sub === currentSub));
}

/** Clear the permanent-failure flag so entries are retried on the next flush. */
export async function retryFailed() {
  const s = await outbox();
  for (const e of await failedEntries()) { e.permanent = false; e.lastError = null; await s.put(e); }
  await recount();
  return flush();
}

const UPSERT = `mutation Upsert($tryoutId: ID!, $sessionId: ID!, $playerNumber: ID!, $scores: AWSJSON!, $tier: String, $notes: String, $clientId: ID!) {
  upsertEvaluation(tryoutId: $tryoutId, sessionId: $sessionId, playerNumber: $playerNumber, scores: $scores, tier: $tier, notes: $notes, clientId: $clientId) {
    playerNumber sessionId updatedAt
  }
}`;

let flushing = false;
let rerun = false; // set when enqueue happens mid-flush so nothing waits for the 30 s tick
const syncListeners = new Set();
/** Called with (entry, result) after each successful send. */
export function onSynced(fn) { syncListeners.add(fn); return () => syncListeners.delete(fn); }

/** Send queued entries in order. Stops at the first network/auth failure; marks GraphQL rejections as permanent. */
export async function flush() {
  if (flushing) { rerun = true; return; }
  flushing = true;
  rerun = false;
  status.flushing = true;
  status.online = navigator.onLine;
  emit();
  try {
    const s = await outbox();
    const entries = (await s.all())
      .filter((e) => !e.permanent && (!currentSub || e.sub === currentSub))
      .sort((a, b) => a.queuedAt - b.queuedAt);
    for (const e of entries) {
      try {
        const vars = { ...e.variables, scores: JSON.stringify(e.variables.scores || {}) };
        const data = await gql(UPSERT, vars);
        await s.deleteIfVersion(e.clientId, e.version);
        status.needsSignIn = false;
        for (const fn of syncListeners) { try { fn(e, data.upsertEvaluation); } catch { /* ignore */ } }
      } catch (err) {
        if (err instanceof NetworkError) break;
        if (err instanceof AuthError) { status.needsSignIn = true; break; }
        // A GraphQL rejection (closed tryout, bad input) will not succeed by retrying. Keep it, flag it.
        e.attempts += 1;
        e.permanent = true;
        e.lastError = err.message;
        await s.put(e);
      }
    }
  } finally {
    flushing = false;
    status.flushing = false;
    await recount();
  }
  if (rerun && navigator.onLine && !status.needsSignIn) return flush();
}

export function startSyncLoop() {
  window.addEventListener("online", () => { status.online = true; emit(); flush(); });
  window.addEventListener("offline", () => { status.online = false; emit(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") flush(); });
  setInterval(flush, 30_000);
  flush();
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// ----------------------------------------------------------------------------- Queries used by both screens
export const Q_CURRENT_TRYOUT = `query { currentTryout {
  id name season status createdAt canEvaluate
  sessions { id label date type order jersey absent colours teams { teamId colour } }
  players { playerNumber colour colour2 number position active tag }
  teams { id name colour players }
} }`;

/** Admin variant: also lists who may score this tryout (admin-only field). */
export const Q_CURRENT_TRYOUT_ADMIN = `query { currentTryout {
  id name season status createdAt canEvaluate
  sessions { id label date type order jersey absent colours teams { teamId colour } }
  players { playerNumber colour colour2 number position active tag }
  teams { id name colour players }
  evaluatorAccess { evaluatorId enabled updatedAt }
} }`;

export const Q_MY_EVALS = `query My($tryoutId: ID!, $sessionId: ID!) {
  myEvaluations(tryoutId: $tryoutId, sessionId: $sessionId) { playerNumber sessionId scores tier notes updatedAt clientId }
}`;

/** Sort sessions by date then order, players by colour then number (server returns them unsorted). */
export function normalizeTryout(t) {
  if (!t) return t;
  t.sessions = [...(t.sessions || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
  t.teams = [...(t.teams || [])].sort((a, b) => a.name.localeCompare(b.name));
  for (const s of t.sessions) {
    s.colours = parseScores(s.colours); // AWSJSON -> object
    deriveTeams(s, t.teams);
  }
  t.players = [...(t.players || [])].sort((a, b) => (a.colour < b.colour ? -1 : a.colour > b.colour ? 1 : a.number - b.number));
  return t;
}

/** AWSJSON comes back as a string. */
export function parseScores(v) {
  if (!v) return {};
  if (typeof v === "string") { try { return JSON.parse(v) || {}; } catch { return {}; } }
  return v;
}

/** Fetch every page of allEvaluations (admin). */
export async function fetchAllEvaluations(tryoutId, sessionId = null) {
  const Q = `query All($tryoutId: ID!, $sessionId: ID, $nextToken: String) {
    allEvaluations(tryoutId: $tryoutId, sessionId: $sessionId, nextToken: $nextToken) {
      items { playerNumber sessionId evaluatorId scores tier notes updatedAt }
      nextToken
    } }`;
  const out = [];
  let nextToken = null;
  do {
    const data = await gql(Q, { tryoutId, sessionId, nextToken });
    for (const e of data.allEvaluations.items) out.push({ ...e, scores: parseScores(e.scores) });
    nextToken = data.allEvaluations.nextToken;
  } while (nextToken);
  return out;
}

/** True when the player is marked absent for the session. */
export function isAbsent(session, player) {
  return !!session && Array.isArray(session.absent) && session.absent.includes(player.playerNumber);
}

/**
 * From a session's team list and the tryout's rosters, derive who is dressed and in what colour.
 * Attached to the session as `teamColours` ({ playerNumber: colour }) and `teamOf` ({ playerNumber: teamName }).
 * A session with no teams has both undefined: everyone plays.
 */
export function deriveTeams(session, teams) {
  session.teams = session.teams || [];
  if (!session.teams.length) { session.teamColours = undefined; session.teamOf = undefined; return session; }
  const byId = new Map((teams || []).map((t) => [t.id, t]));
  session.teamColours = {};
  session.teamOf = {};
  for (const st of session.teams) {
    const team = byId.get(st.teamId);
    if (!team) continue;
    const colour = st.colour || team.colour || null; // session colour wins, then the team's own colour
    for (const pn of team.players) {
      if (!(pn in session.teamColours)) { session.teamColours[pn] = colour; session.teamOf[pn] = team.name; }
    }
  }
  return session;
}

/** True when the player is dressed for the session: on one of its teams (or the session has no teams) and not absent. */
export function isPlaying(session, player) {
  if (!session) return true;
  if (isAbsent(session, player)) return false;
  if (session.teamColours && !(player.playerNumber in session.teamColours)) return false;
  return true;
}

/** Team name a player is on for this session, or null. */
export function teamNameOf(session, player) {
  return session?.teamOf?.[player.playerNumber] || null;
}

/**
 * Jersey colour a player wears in a session: the per-session assignment when the convenor set one
 * (skills: forwards one colour, defence another; scrimmage: team colours), otherwise the session's
 * default jersey set (primary or secondary).
 */
export function wornColour(session, player) {
  const override = session?.colours && session.colours[player.playerNumber];
  if (override) return override;
  const team = session?.teamColours && session.teamColours[player.playerNumber];
  if (team) return team;
  return session?.jersey === "secondary" && player.colour2 ? player.colour2 : player.colour;
}

/** Display code for what is on the ice in a session, e.g. "G-14" for W-14 wearing Green. */
export function wornCode(session, player) {
  return `${wornColour(session, player).charAt(0).toUpperCase()}-${String(player.number).padStart(2, "0")}`;
}

/** CSS colour for a pinnie colour name; unknown colours fall back to grey. */
export function swatchColour(name) {
  const m = {
    white: "#ffffff", black: "#111111", blue: "#1e63d6", red: "#d62828", green: "#2a9d3f", yellow: "#f2d600",
    orange: "#f77f00", purple: "#7b2cbf", pink: "#ff5da2", grey: "#8d99ae", gray: "#8d99ae", teal: "#12908e",
    navy: "#1b2a6b", maroon: "#7a1f2b", gold: "#d4a017", silver: "#c0c0c0", lime: "#9acd32", brown: "#7b4b2a",
  };
  return m[(name || "").toLowerCase()] || "#8d99ae";
}
