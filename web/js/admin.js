// Convenor dashboard: setup, rankings, per-evaluator view, CSV export, close.
// Everything here is by player number only. There is no name field anywhere and no place to type one.
import { requireAuth, signOut } from "./auth.js";
import { gql, fetchAllEvaluations, registerServiceWorker, Q_CURRENT_TRYOUT_ADMIN, normalizeTryout, swatchColour, wornCode, wornColour, isAbsent, isPlaying, teamNameOf, deriveTeams, AuthError } from "./api.js";
import { CRITERIA, TIERS, criteriaFor, weightedScore, NOTES_MAX } from "./criteria.js";

registerServiceWorker();
await requireAuth({ admin: true });

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== null && c !== undefined) n.append(c);
  return n;
};
const fmt = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? "" : n.toFixed(d));
const SPREAD_THRESHOLD = 0.75;
$("spreadThreshold").textContent = SPREAD_THRESHOLD.toFixed(2);

const state = {
  tryout: null,
  evals: [],
  evaluators: [],
  openTeam: null,
  rank: { sessionId: "all", position: "all", equalWeights: false, normalize: false, taggedOnly: false, sortKey: "overall", sortDir: "desc" },
  attendSessionId: null,
  view: { evaluatorId: null, sessionId: "all" },
  showInactive: false,
};

// ----------------------------------------------------------------------------- Messages
let msgTimer;
function msg(text, kind = "ok") {
  const m = $("msg");
  m.textContent = text; m.className = `notice ${kind}`; m.hidden = false;
  clearTimeout(msgTimer);
  if (kind === "ok") msgTimer = setTimeout(() => { m.hidden = true; }, 5000);
}
async function run(fn, okText) {
  try { const r = await fn(); if (okText) msg(okText); return r; }
  catch (err) {
    if (err instanceof AuthError) { location.replace("index.html"); return; }
    msg(err.message || String(err), "bad"); throw err;
  }
}

// ----------------------------------------------------------------------------- Data
async function loadAll() {
  const data = await gql(Q_CURRENT_TRYOUT_ADMIN);
  state.tryout = normalizeTryout(data.currentTryout);
  if (state.tryout) {
    const [evals, evaluators] = await Promise.all([
      fetchAllEvaluations(state.tryout.id),
      gql(`query { evaluators { id displayName role } }`).then((d) => d.evaluators),
    ]);
    state.evals = evals;
    state.evaluators = evaluators.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } else {
    state.evals = []; state.evaluators = [];
  }
  renderAll();
}

const playerMap = () => new Map((state.tryout?.players || []).map((p) => [p.playerNumber, p]));
const sessionMap = () => new Map((state.tryout?.sessions || []).map((s) => [s.id, s]));
const evaluatorName = (id) => state.evaluators.find((e) => e.id === id)?.displayName || `Evaluator ${id.slice(0, 6)}`;

// ----------------------------------------------------------------------------- Stats helpers
function mean(xs) { const v = xs.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function stddev(xs) {
  const v = xs.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / v.length);
}

/** Per-evaluator mean/sd of overall scores across the whole tryout (all sessions, all positions). */
function evaluatorStats(equalWeights) {
  const pm = playerMap();
  const by = new Map();
  const all = [];
  for (const e of state.evals) {
    const p = pm.get(e.playerNumber); if (!p) continue;
    const o = weightedScore(p.position, e.scores, { equalWeights });
    if (o === null) continue;
    if (!by.has(e.evaluatorId)) by.set(e.evaluatorId, []);
    by.get(e.evaluatorId).push(o);
    all.push(o);
  }
  const group = { mean: mean(all), sd: stddev(all), n: all.length };
  const per = new Map();
  for (const [id, xs] of by) per.set(id, { mean: mean(xs), sd: stddev(xs), n: xs.length });
  return { group, per };
}

/** Rankings rows for the current filters. */
function computeRankings() {
  const { sessionId, position, equalWeights, normalize, taggedOnly } = state.rank;
  const pm = playerMap();
  const stats = evaluatorStats(equalWeights);
  const sessions = state.tryout?.sessions || [];
  const players = (state.tryout?.players || []).filter((p) => p.active && (position === "all" || p.position === position) && (!taggedOnly || p.tag));
  const rows = [];
  for (const p of players) {
    const evs = state.evals.filter((e) => e.playerNumber === p.playerNumber && (sessionId === "all" || e.sessionId === sessionId));
    const critSums = {};
    const perEvaluator = new Map();
    const overalls = [];
    const tiers = { A: 0, B: 0, C: 0, X: 0 };
    let n = 0;
    for (const e of evs) {
      const raw = weightedScore(p.position, e.scores, { equalWeights });
      const hasAny = raw !== null || e.tier;
      if (!hasAny) continue;
      n += 1;
      if (e.tier && tiers[e.tier] !== undefined) tiers[e.tier] += 1;
      for (const [k, v] of Object.entries(e.scores || {})) {
        if (!critSums[k]) critSums[k] = { sum: 0, n: 0 };
        critSums[k].sum += v; critSums[k].n += 1;
      }
      if (raw === null) continue;
      let adj = raw;
      if (normalize) {
        const s = stats.per.get(e.evaluatorId);
        if (s && s.n >= 3 && s.sd && stats.group.sd) adj = stats.group.mean + ((raw - s.mean) / s.sd) * stats.group.sd;
      }
      overalls.push(adj);
      if (!perEvaluator.has(e.evaluatorId)) perEvaluator.set(e.evaluatorId, []);
      perEvaluator.get(e.evaluatorId).push(adj);
    }
    const crit = {};
    for (const c of criteriaFor(p.position)) crit[c.key] = critSums[c.key] ? critSums[c.key].sum / critSums[c.key].n : null;
    const perEvalMeans = [...perEvaluator.values()].map(mean);
    const attended = sessions.filter((s) => isPlaying(s, p)).length;
    rows.push({
      playerNumber: p.playerNumber, colour: p.colour, number: p.number, position: p.position, tag: p.tag || null,
      n, crit, overall: mean(overalls), tiers, spread: stddev(perEvalMeans), evaluators: perEvaluator.size,
      attended, sessionsTotal: sessions.length,
    });
  }
  return { rows, stats };
}

// ----------------------------------------------------------------------------- Render: header + setup
function renderAll() {
  const t = state.tryout;
  $("tryoutName").textContent = t ? t.name : "No tryout yet";
  const pill = $("tryoutStatus");
  pill.textContent = t ? t.status : ""; pill.className = `pill ${t?.status === "open" ? "ok" : "bad"}`; pill.hidden = !t;
  renderSetup(); renderRankings(); renderEvaluatorsTab(); renderCardCounts();
  $("closeBtn").disabled = !t || t.status !== "open";
}

function renderSetup() {
  const t = state.tryout;
  const info = $("tryoutInfo");
  info.innerHTML = "";
  if (t) {
    info.append(el("p", {}, el("b", {}, t.name), ` · season ${t.season} · `, el("span", { class: `pill ${t.status === "open" ? "ok" : "bad"}` }, t.status)));
    $("newTryoutDetails").open = false;
  } else {
    info.append(el("p", { class: "notice warn" }, "No tryout exists. Create one to get started."));
    $("newTryoutDetails").open = true;
  }
  for (const id of ["sessionsCard", "playersCard", "evaluatorsCard"]) $(id).hidden = !t;
  if (!t) return;

  const sb = $("sessionsBody"); sb.innerHTML = "";
  t.sessions.forEach((s, i) => {
    const clash = jerseyClashes(s);
    // Label, date and type are edited in place and saved on change (dates move, rinks cancel).
    const labelIn = el("input", { type: "text", class: "sm", maxlength: "60", value: s.label, "aria-label": `Label for session ${i + 1}`, style: "min-width:200px" });
    const commitLabel = () => { const v = labelIn.value.trim(); if (v && v !== s.label) updateSession(s, { label: v }); };
    labelIn.addEventListener("change", commitLabel);
    labelIn.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); labelIn.blur(); } });
    const dateIn = el("input", { type: "date", class: "sm", value: s.date, "aria-label": `Date for ${s.label}` });
    dateIn.addEventListener("change", () => { if (dateIn.value && dateIn.value !== s.date) updateSession(s, { date: dateIn.value }); });
    const typeSel = el("select", { class: "sm", "aria-label": `Type for ${s.label}` },
      ...["skills", "scrimmage", "game"].map((x) => el("option", { value: x, selected: x === s.type }, x)));
    typeSel.addEventListener("change", () => updateSession(s, { type: typeSel.value }));
    sb.append(el("tr", { "data-session": s.id }, el("td", {}, String(i + 1)), el("td", {}, labelIn), el("td", {}, dateIn), el("td", {}, typeSel),
      el("td", {}, sessionTeamsCell(s)),
      el("td", {}, el("span", { class: `pill ${clash.length ? "bad" : ""}` }, s.jersey === "secondary" ? "secondary" : "primary"),
        Object.keys(s.colours || {}).length ? el("span", { class: "small muted", style: "margin-left:.4rem" }, `+${Object.keys(s.colours).length} set per player`) : null,
        clash.length ? el("span", { class: "small error", style: "margin-left:.4rem" }, `duplicate codes: ${clash.join(", ")}`) : null),
      el("td", {}, el("button", { class: "btn sm", type: "button", onclick: () => setJersey(s, s.jersey === "secondary" ? "primary" : "secondary") },
        s.jersey === "secondary" ? "Switch to primary" : "Switch to secondary"))));
  });
  if (!t.sessions.length) sb.append(el("tr", {}, el("td", { colspan: 7, class: "muted" }, "No sessions yet.")));
  renderTeams();

  // Colour dropdowns on the add-one form: default White / Red, "Other…" to add a colour.
  fillColourSelect($("pColour"), { otherInput: $("pColourOther") });
  fillColourSelect($("pColour2"), { allowNone: true, otherInput: $("pColour2Other") });

  const pb = $("playersBody"); pb.innerHTML = "";
  const players = t.players.filter((p) => state.showInactive || p.active);
  $("playerCount").textContent = `${t.players.filter((p) => p.active).length} active · ${t.players.filter((p) => !p.active).length} released`;
  for (const p of players) {
    // Secondary colour: dropdown that saves on change; "Other…" reveals a text box.
    const c2Sel = el("select", { class: "colour-select sm", "aria-label": `Secondary colour for ${p.playerNumber}` });
    const c2Other = el("input", { type: "text", maxlength: "20", placeholder: "New colour", hidden: true, style: "margin-top:.3rem", "aria-label": `New secondary colour for ${p.playerNumber}` });
    fillColourSelect(c2Sel, { value: p.colour2 || "", allowNone: true });
    c2Sel.addEventListener("change", () => {
      if (c2Sel.value === OTHER) { c2Other.hidden = false; c2Other.focus(); return; }
      updatePlayer(p, { colour2: c2Sel.value });
    });
    const commitOther = () => { const v = c2Other.value.trim(); if (v) updatePlayer(p, { colour2: v }); };
    c2Other.addEventListener("change", commitOther);
    c2Other.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); commitOther(); } });

    const posSel = el("select", { class: "sm", "aria-label": `Position for ${p.playerNumber}` },
      ...["F", "D", "G"].map((x) => el("option", { value: x, selected: x === p.position }, x)));
    posSel.addEventListener("change", () => updatePlayer(p, { position: posSel.value }));

    const tagBox = el("input", { type: "checkbox", "aria-label": `AA candidate ${p.playerNumber}` });
    tagBox.checked = p.tag === "AA";
    tagBox.addEventListener("change", () => updatePlayer(p, { tag: tagBox.checked ? "AA" : "" }));

    // Primary colour: changing it changes the player's code. Only possible before they have scores.
    const c1Sel = el("select", { class: "colour-select sm", "aria-label": `Primary colour for ${p.playerNumber}` });
    const c1Other = el("input", { type: "text", maxlength: "20", placeholder: "New colour", hidden: true, style: "margin-top:.3rem", "aria-label": `New primary colour for ${p.playerNumber}` });
    fillColourSelect(c1Sel, { value: p.colour });
    c1Sel.addEventListener("change", () => {
      if (c1Sel.value === OTHER) { c1Other.hidden = false; c1Other.focus(); return; }
      changePlayerColour(p, c1Sel.value);
    });
    const commitC1Other = () => { const v = c1Other.value.trim(); if (v) changePlayerColour(p, v); };
    c1Other.addEventListener("change", commitC1Other);
    c1Other.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); commitC1Other(); } });

    pb.append(el("tr", { class: p.active ? "" : "inactive", "data-player": p.playerNumber },
      el("td", {}, el("span", { class: "swatch", style: `background:${swatchColour(p.colour)}` }), el("b", {}, p.playerNumber), p.tag ? el("span", { class: "tagpill", style: "margin-left:.4rem" }, p.tag) : null),
      el("td", {}, el("span", { class: "swatch", style: `background:${swatchColour(p.colour)}` }), c1Sel, c1Other),
      el("td", {}, el("span", { class: "swatch", style: `background:${swatchColour(p.colour2 || "")}` }), c2Sel, c2Other),
      el("td", { class: "num" }, String(p.number)), el("td", {}, posSel),
      el("td", {}, tagBox),
      el("td", {}, el("span", { class: `pill ${p.active ? "ok" : "bad"}` }, p.active ? "active" : "released")),
      el("td", {}, el("div", { class: "row", style: "flex-wrap:nowrap" },
        el("button", { class: "btn sm", type: "button", onclick: () => setActive(p, !p.active) }, p.active ? "Release" : "Reinstate"),
        el("button", { class: "btn sm danger", type: "button", onclick: () => deletePlayer(p) }, "Delete"))),
    ));
  }
  if (!players.length) pb.append(el("tr", {}, el("td", { colspan: 8, class: "muted" }, "No players yet.")));
  renderAttendance();

  const eb = $("evaluatorsBody"); eb.innerHTML = "";
  const access = new Map((t.evaluatorAccess || []).map((a) => [a.evaluatorId, a]));
  // Logins first, then any access rows whose login has since been deleted.
  const rows = [...state.evaluators.map((e) => ({ ...e, access: access.get(e.id) || null }))];
  for (const [id, a] of access) if (!state.evaluators.some((e) => e.id === id)) rows.push({ id, displayName: "(deleted login)", access: a, orphan: true });
  const enabledCount = rows.filter((r) => r.access?.enabled).length;
  $("evaluatorHint").textContent = `${enabledCount} evaluator${enabledCount === 1 ? "" : "s"} can score this tryout. New logins are added automatically; a new tryout starts with nobody added.`;
  for (const r of rows) {
    const a = r.access;
    const statusCell = !a ? el("span", { class: "pill" }, "not added") : a.enabled ? el("span", { class: "pill ok" }, "scoring") : el("span", { class: "pill bad" }, "disabled");
    const toggle = !a
      ? el("button", { class: "btn sm primary", type: "button", onclick: () => setAccess(r.id, true) }, "Add to tryout")
      : a.enabled
        ? el("button", { class: "btn sm", type: "button", onclick: () => setAccess(r.id, false) }, "Disable")
        : el("button", { class: "btn sm", type: "button", onclick: () => setAccess(r.id, true) }, "Enable");
    eb.append(el("tr", { "data-evaluator": r.id }, el("td", {}, r.displayName), el("td", { class: "muted small" }, r.id), el("td", {}, statusCell), el("td", {}, toggle),
      el("td", {}, r.orphan ? "" : el("button", { class: "btn sm danger", type: "button", onclick: () => deleteEvaluator(r) }, "Delete login"))));
  }
  if (!rows.length) eb.append(el("tr", {}, el("td", { colspan: 5, class: "muted" }, "No evaluator logins yet.")));

  // session selects
  for (const id of ["rSession", "vSession"]) {
    const sel = $(id); const cur = sel.value;
    sel.innerHTML = ""; sel.append(el("option", { value: "all" }, "All sessions"));
    for (const s of t.sessions) sel.append(el("option", { value: s.id }, s.label));
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "all";
  }
}

// ----------------------------------------------------------------------------- Setup actions
$("tryoutForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const name = $("tName").value.trim(), season = $("tSeason").value.trim();
  if (state.tryout && !confirm(`Start a new tryout "${name}"? Evaluators will see the new one immediately.`)) return;
  await run(async () => {
    await gql(`mutation($name: String!, $season: String!) { createTryout(name: $name, season: $season) { id } }`, { name, season });
    $("tName").value = ""; $("tSeason").value = "";
    await loadAll();
  }, "Tryout created.");
});

$("sessionForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  await run(async () => {
    await gql(`mutation($tryoutId: ID!, $label: String!, $date: AWSDate!, $type: String!, $jersey: String) { addSession(tryoutId: $tryoutId, label: $label, date: $date, type: $type, jersey: $jersey) { id } }`,
      { tryoutId: state.tryout.id, label: $("sLabel").value.trim(), date: $("sDate").value, type: $("sType").value, jersey: $("sJersey").value });
    $("sLabel").value = "";
    await loadAll();
  }, "Session added.");
});
// Scrimmages default to the secondary jersey in the form; the convenor can still change it.
$("sType").addEventListener("change", () => { $("sJersey").value = $("sType").value === "skills" ? "primary" : "secondary"; });

/** Partial update of a session (label, date, type, jersey). Sessions re-sort by date after a date change. */
async function updateSession(session, patch, okText) {
  await run(async () => {
    const data = await gql(`mutation($tryoutId: ID!, $sessionId: ID!, $label: String, $date: AWSDate, $type: String, $jersey: String) {
      updateSession(tryoutId: $tryoutId, sessionId: $sessionId, label: $label, date: $date, type: $type, jersey: $jersey) { id label date type order jersey absent colours teams { teamId colour } } }`,
      { tryoutId: state.tryout.id, sessionId: session.id, label: patch.label ?? null, date: patch.date ?? null, type: patch.type ?? null, jersey: patch.jersey ?? null });
    Object.assign(session, data.updateSession);
    normalizeTryout(state.tryout); // also parses the colours map
    renderAll();
  }, okText || `${session.label} updated${patch.date ? ` · now on ${patch.date}` : ""}.`);
}

async function setJersey(session, jersey) {
  await updateSession(session, { jersey }, `${session.label} now uses ${jersey} jersey colours.`);
}

const COMMON_COLOURS = ["White", "Red", "Blue", "Green", "Yellow", "Orange", "Black", "Purple", "Grey", "Pink", "Teal", "Gold"];
const OTHER = "__other__";

/** Common colours plus every colour already in use (both jersey sets). */
function knownColours() {
  const set = new Set(COMMON_COLOURS);
  for (const p of state.tryout?.players || []) { set.add(p.colour); if (p.colour2) set.add(p.colour2); }
  return [...set].sort((a, b) => COMMON_COLOURS.indexOf(a) - COMMON_COLOURS.indexOf(b) || a.localeCompare(b));
}

/**
 * Fill a <select> with the known colours plus "Other…" (and "None" when allowNone). Keeps the current value.
 * When "Other…" is chosen, the paired text input is revealed for a new colour name.
 */
function fillColourSelect(sel, { value, allowNone = false, otherInput = null, noneLabel = "None" } = {}) {
  const current = value ?? sel.value ?? "";
  sel.innerHTML = "";
  if (allowNone) sel.append(el("option", { value: "" }, noneLabel));
  for (const c of knownColours()) sel.append(el("option", { value: c }, c));
  sel.append(el("option", { value: OTHER }, "Other…"));
  const wanted = current || sel.dataset.default || "";
  sel.value = [...sel.options].some((o) => o.value === wanted) ? wanted : (allowNone ? "" : "White");
  if (otherInput && !sel.dataset.wired) {
    sel.dataset.wired = "1";
    sel.addEventListener("change", () => { otherInput.hidden = sel.value !== OTHER; if (sel.value === OTHER) otherInput.focus(); });
  }
}
/** The colour a select + optional "other" input currently represent ("" = none). */
function colourValue(sel, otherInput) {
  if (sel.value === OTHER) return (otherInput?.value || "").trim();
  return sel.value;
}

/** Display codes that would appear twice in a session (e.g. two players both showing "G-07"). */
function jerseyClashes(session, players = state.tryout?.players || []) {
  const seen = new Map();
  const dups = new Set();
  for (const p of players.filter((x) => x.active)) {
    const code = wornCode(session, p);
    if (seen.has(code) && seen.get(code) !== p.playerNumber) dups.add(code); else seen.set(code, p.playerNumber);
  }
  return [...dups].sort();
}

const cap = (c) => c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();

/** Parse `colour,number,position[,colour2]` lines. Refuses anything that could be a roster with names. */
export function parsePlayersCsv(text) {
  const players = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) return;
    const cols = raw.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && /^colou?r$/i.test(cols[0])) return; // header row
    if (cols.length !== 3 && cols.length !== 4) throw new Error(`Line ${i + 1}: expected 3 or 4 columns (colour,number,position,colour2). Rosters with names are not accepted.`);
    const [colour, number, position, colour2 = ""] = cols;
    if (/name|dob|birth/i.test(raw)) throw new Error(`Line ${i + 1}: looks like it contains a name or birthdate.`);
    if (!/^[A-Za-z]{2,20}$/.test(colour)) throw new Error(`Line ${i + 1}: colour "${colour}" must be letters only.`);
    if (colour2 && !/^[A-Za-z]{2,20}$/.test(colour2)) throw new Error(`Line ${i + 1}: secondary colour "${colour2}" must be letters only.`);
    if (!/^\d{1,3}$/.test(number)) throw new Error(`Line ${i + 1}: number "${number}" must be 0-999.`);
    if (!/^[FDG]$/i.test(position)) throw new Error(`Line ${i + 1}: position must be F, D or G.`);
    players.push({ colour: cap(colour), colour2: colour2 ? cap(colour2) : null, number: Number(number), position: position.toUpperCase() });
  });
  return players;
}

function checkColourInitials(newPlayers) {
  const existing = state.tryout?.players || [];
  const check = (pick, what) => {
    const colours = new Set([...existing.map(pick), ...newPlayers.map(pick)].filter(Boolean));
    const byInitial = new Map();
    for (const c of colours) { const k = c.charAt(0).toUpperCase(); if (!byInitial.has(k)) byInitial.set(k, new Set()); byInitial.get(k).add(c); }
    const clashes = [...byInitial.values()].filter((s) => s.size > 1).map((s) => [...s].join(" / "));
    if (clashes.length) throw new Error(`These ${what} colours share a first letter and would give players the same code: ${clashes.join("; ")}. Rename one (e.g. "Black" → "Dark").`);
  };
  check((p) => p.colour, "primary");
  check((p) => p.colour2, "secondary");
  // Same number + same secondary colour on two players would collide in a secondary-jersey session.
  const merged = [...existing.filter((e) => !newPlayers.some((n) => n.colour === e.colour && n.number === e.number)), ...newPlayers.map((n) => ({ ...n, active: true }))];
  const dups = jerseyClashes({ jersey: "secondary" }, merged);
  if (dups.length) throw new Error(`These codes would appear twice in a secondary-jersey session: ${dups.join(", ")}. Give one of the players a different secondary colour.`);
}

async function upsertPlayers(players) {
  checkColourInitials(players);
  for (let i = 0; i < players.length; i += 25) {
    await gql(`mutation($tryoutId: ID!, $players: [PlayerInput!]!) { upsertPlayers(tryoutId: $tryoutId, players: $players) { playerNumber } }`,
      { tryoutId: state.tryout.id, players: players.slice(i, i + 25).map((p) => ({ colour: p.colour, colour2: p.colour2 || null, number: p.number, position: p.position })) });
  }
}

$("playersCsvForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("playersCsvError"); err.hidden = true;
  let players;
  try { players = parsePlayersCsv($("playersCsv").value); if (!players.length) throw new Error("Nothing to add."); }
  catch (e) { err.textContent = e.message; err.hidden = false; return; }
  await run(async () => { await upsertPlayers(players); $("playersCsv").value = ""; await loadAll(); }, `${players.length} player(s) added.`);
});

$("playerForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const colour = colourValue($("pColour"), $("pColourOther"));
  const colour2 = colourValue($("pColour2"), $("pColour2Other"));
  if (!colour) { msg("Choose a primary colour or type a new one.", "bad"); return; }
  const p = { colour, colour2: colour2 || null, number: Number($("pNumber").value), position: $("pPosition").value };
  await run(async () => {
    await upsertPlayers([p]);
    $("pNumber").value = ""; $("pColourOther").value = ""; $("pColour2Other").value = "";
    await loadAll();
    // Keep the colours the convenor just used selected for the next entry.
    fillColourSelect($("pColour"), { value: colour }); fillColourSelect($("pColour2"), { value: colour2, allowNone: true });
    $("pColourOther").hidden = true; $("pColour2Other").hidden = true;
    $("pNumber").focus();
  }, "Player added.");
});

$("showInactive").addEventListener("change", (ev) => { state.showInactive = ev.target.checked; renderSetup(); });

async function updatePlayer(p, patch) {
  if (patch.colour2 !== undefined) {
    // Guard against two players sharing a code in a secondary-jersey session.
    const merged = (state.tryout.players || []).map((x) => (x.playerNumber === p.playerNumber ? { ...x, colour2: patch.colour2 || null } : x));
    const dups = jerseyClashes({ jersey: "secondary" }, merged);
    if (dups.length) { msg(`That would make two players show as ${dups.join(", ")} in secondary-jersey sessions.`, "bad"); renderSetup(); return; }
  }
  await run(async () => {
    const data = await gql(`mutation($tryoutId: ID!, $playerNumber: ID!, $position: String, $colour2: String, $tag: String) {
      updatePlayer(tryoutId: $tryoutId, playerNumber: $playerNumber, position: $position, colour2: $colour2, tag: $tag) { playerNumber position colour2 tag } }`,
      { tryoutId: state.tryout.id, playerNumber: p.playerNumber, position: patch.position ?? null, colour2: patch.colour2 ?? null, tag: patch.tag ?? null });
    Object.assign(p, data.updatePlayer);
    renderAll();
  }, `${p.playerNumber} updated.`);
}

/** Change the primary colour = the player's code. Server moves the row; we then carry references over. */
async function changePlayerColour(p, colour) {
  const code = `${colour.charAt(0).toUpperCase()}-${String(p.number).padStart(2, "0")}`;
  if (code === p.playerNumber) { renderSetup(); return; }
  if (!confirm(`Change ${p.playerNumber}'s primary colour to ${colour}? Their code becomes ${code} everywhere. Only possible while they have no scores.`)) { renderSetup(); return; }
  const oldPn = p.playerNumber;
  await run(async () => {
    const data = await gql(`mutation($tryoutId: ID!, $playerNumber: ID!, $colour: String!) {
      changePlayerColour(tryoutId: $tryoutId, playerNumber: $playerNumber, colour: $colour) { playerNumber colour colour2 number position active tag } }`,
      { tryoutId: state.tryout.id, playerNumber: oldPn, colour });
    const moved = data.changePlayerColour;
    // Carry the old code over in team rosters, attendance lists and per-session colours.
    for (const team of state.tryout.teams) {
      if (team.players.includes(oldPn)) {
        const players = team.players.map((x) => (x === oldPn ? moved.playerNumber : x));
        const r = await gql(`mutation($tryoutId: ID!, $teamId: ID!, $players: [ID!]!) { setTeamPlayers(tryoutId: $tryoutId, teamId: $teamId, players: $players) { id players } }`, { tryoutId: state.tryout.id, teamId: team.id, players });
        team.players = r.setTeamPlayers.players;
      }
    }
    for (const sess of state.tryout.sessions) {
      if ((sess.absent || []).includes(oldPn)) {
        await gql(`mutation($tryoutId: ID!, $sessionId: ID!, $playerNumber: ID!, $present: Boolean!) { setAttendance(tryoutId: $tryoutId, sessionId: $sessionId, playerNumber: $playerNumber, present: $present) { id } }`, { tryoutId: state.tryout.id, sessionId: sess.id, playerNumber: oldPn, present: true });
        await gql(`mutation($tryoutId: ID!, $sessionId: ID!, $playerNumber: ID!, $present: Boolean!) { setAttendance(tryoutId: $tryoutId, sessionId: $sessionId, playerNumber: $playerNumber, present: $present) { id } }`, { tryoutId: state.tryout.id, sessionId: sess.id, playerNumber: moved.playerNumber, present: false });
      }
      if (sess.colours && oldPn in sess.colours) {
        const next = { ...sess.colours }; next[moved.playerNumber] = next[oldPn]; delete next[oldPn];
        await gql(`mutation($tryoutId: ID!, $sessionId: ID!, $colours: AWSJSON!) { setSessionColours(tryoutId: $tryoutId, sessionId: $sessionId, colours: $colours) { id } }`, { tryoutId: state.tryout.id, sessionId: sess.id, colours: JSON.stringify(next) });
      }
    }
    await loadAll();
  }, `${oldPn} is now ${code}.`);
}

async function deletePlayer(p) {
  if (!confirm(`Delete ${p.playerNumber} from this tryout? Only possible while they have no scores.`)) return;
  await run(async () => {
    await gql(`mutation($tryoutId: ID!, $playerNumber: ID!) { deletePlayer(tryoutId: $tryoutId, playerNumber: $playerNumber) }`,
      { tryoutId: state.tryout.id, playerNumber: p.playerNumber });
    state.tryout.players = state.tryout.players.filter((x) => x.playerNumber !== p.playerNumber);
    renderAll();
  }, `${p.playerNumber} deleted.`);
}

function renderAttendance() {
  const t = state.tryout;
  const card = $("attendanceCard");
  card.hidden = !t;
  if (!t) return;
  const sel = $("aSession");
  const wanted = state.attendSessionId || sel.value;
  sel.innerHTML = "";
  for (const s of t.sessions) sel.append(el("option", { value: s.id }, `${s.label} · ${s.date}`));
  sel.value = t.sessions.some((s) => s.id === wanted) ? wanted : (t.sessions[0]?.id || "");
  state.attendSessionId = sel.value || null;
  const session = t.sessions.find((s) => s.id === state.attendSessionId) || null;
  const grid = $("attendGrid"); grid.innerHTML = "";
  $("bulkBar").hidden = !session;
  if (!session) { $("aSummary").textContent = "Add a session first."; $("aClash").hidden = true; return; }
  fillColourSelect($("bulkColour"), { otherInput: $("bulkColourOther") });
  const players = t.players.filter((p) => p.active);
  let absent = 0;
  const overrides = Object.keys(session.colours || {}).length;
  // Team sessions: group the grid by team, then list who is not dressed.
  const hasTeams = !!session.teamColours;
  const groups = hasTeams
    ? [...session.teams.map((st) => ({ title: `${t.teams.find((x) => x.id === st.teamId)?.name || "Team"}${st.colour ? ` · ${st.colour}` : ""}`, colour: st.colour, players: players.filter((p) => teamNameOf(session, p) === (t.teams.find((x) => x.id === st.teamId)?.name)) })),
       { title: "Not dressed for this session", players: players.filter((p) => !(p.playerNumber in session.teamColours)), notDressed: true }]
    : [{ title: null, players }];
  $("aTeams").hidden = !hasTeams;
  $("aTeams").textContent = hasTeams ? `On the ice: ${session.teams.map((st) => `${t.teams.find((x) => x.id === st.teamId)?.name || "?"}${st.colour ? ` in ${st.colour}` : ""}`).join(session.type === "skills" ? " and " : " vs ")}. Change that in the Sessions table above.` : "";
  for (const g of groups) {
  if (g.title) grid.append(el("h4", {}, g.title, g.notDressed ? el("span", { class: "muted small", style: "font-weight:400;margin-left:.5rem" }, "(hidden from evaluators)") : null));
  for (const p of g.players) {
    const away = isAbsent(session, p);
    if (away && !g.notDressed) absent += 1;
    const box = el("input", { type: "checkbox", "aria-label": `${p.playerNumber} present` });
    box.checked = !away;
    box.addEventListener("change", () => setAttendance(session, p, box.checked));
    // Per-player jersey colour for THIS session. Saves the whole map on change.
    const cSel = el("select", { class: "colour-select", "aria-label": `Jersey colour for ${p.playerNumber} in ${session.label}` });
    const cOther = el("input", { type: "text", maxlength: "20", placeholder: "New colour", hidden: true, "aria-label": `New jersey colour for ${p.playerNumber}` });
    fillColourSelect(cSel, { value: wornColour(session, p) });
    cSel.addEventListener("change", () => {
      if (cSel.value === OTHER) { cOther.hidden = false; cOther.focus(); return; }
      setSessionColours(session, { ...(session.colours || {}), [p.playerNumber]: cSel.value });
    });
    const commitOther = () => { const v = cOther.value.trim(); if (v) setSessionColours(session, { ...(session.colours || {}), [p.playerNumber]: v }); };
    cOther.addEventListener("change", commitOther);
    cOther.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); commitOther(); } });
    if (g.notDressed) {
      grid.append(el("label", { class: "dressed-no", "data-attend": p.playerNumber },
        el("span", { class: "swatch", style: `background:${swatchColour(p.colour)}` }), el("span", { class: "code" }, p.playerNumber),
        el("span", { class: "muted small" }, p.position), p.tag ? el("span", { class: "tagpill" }, p.tag) : null));
      continue;
    }
    grid.append(el("label", { class: away ? "absent" : "", "data-attend": p.playerNumber }, box,
      el("span", { class: "swatch", style: `background:${swatchColour(wornColour(session, p))}` }),
      el("span", { class: "code" }, wornCode(session, p)),
      el("span", { class: "muted small" }, `${p.position}${p.playerNumber !== wornCode(session, p) ? ` · ${p.playerNumber}` : ""}`),
      p.tag ? el("span", { class: "tagpill" }, p.tag) : null, cSel, cOther));
  }
  }
  const dressed = players.filter((p) => !hasTeams || (p.playerNumber in session.teamColours)).length;
  $("aSummary").textContent = `${dressed - absent} present · ${absent} absent${hasTeams ? ` · ${players.length - dressed} not dressed` : ""} · ${overrides ? `${overrides} colour${overrides === 1 ? "" : "s"} set per player` : hasTeams ? "team colours" : `default ${session.jersey} jerseys`}`;
  const clash = jerseyClashes(session);
  $("aClash").hidden = !clash.length;
  $("aClash").textContent = clash.length ? `Two players would show as the same code: ${clash.join(", ")}. Give one of them a different colour.` : "";
}
$("aSession").addEventListener("change", (ev) => { state.attendSessionId = ev.target.value; renderAttendance(); });

$("bulkApply").addEventListener("click", () => {
  const session = state.tryout?.sessions.find((s) => s.id === state.attendSessionId);
  if (!session) return;
  const colour = colourValue($("bulkColour"), $("bulkColourOther"));
  if (!colour) { msg("Choose a colour first.", "bad"); return; }
  const who = $("bulkWho").value;
  const next = { ...(session.colours || {}) };
  // Applies to everyone dressed for the session (absent players included, so a late arrival is right), not to players on no team.
  const dressed = (x) => !session.teamColours || (x.playerNumber in session.teamColours);
  for (const p of state.tryout.players.filter((x) => x.active && dressed(x) && (who === "all" || x.position === who))) next[p.playerNumber] = colour;
  setSessionColours(session, next, `${who === "all" ? "Everyone" : who === "F" ? "Forwards" : who === "D" ? "Defence" : "Goalies"} set to ${colour} for ${session.label}.`);
});
$("bulkReset").addEventListener("click", () => {
  const session = state.tryout?.sessions.find((s) => s.id === state.attendSessionId);
  if (session) setSessionColours(session, {}, `${session.label} back to default ${session.jersey} jerseys.`);
});

// ----------------------------------------------------------------------------- Teams
function renderTeams() {
  const t = state.tryout;
  $("teamsCard").hidden = !t;
  if (!t) return;
  const list = $("teamsList"); list.innerHTML = "";
  const players = t.players.filter((p) => p.active);
  fillColourSelect($("teamColour"), { otherInput: $("teamColourOther"), allowNone: true, noneLabel: "None (default jerseys)" });
  for (const team of t.teams) {
    const roster = el("div", { class: "roster" });
    // Number and position only, sorted by number: the team's colour is what they will wear, so no default colours here.
    for (const p of [...players].sort((a, b) => a.number - b.number || a.playerNumber.localeCompare(b.playerNumber))) {
      const box = el("input", { type: "checkbox", "aria-label": `${p.playerNumber} on ${team.name}` });
      const on = team.players.includes(p.playerNumber);
      box.checked = on;
      box.addEventListener("change", () => {
        const next = box.checked ? [...team.players, p.playerNumber] : team.players.filter((x) => x !== p.playerNumber);
        setTeamPlayers(team, next);
      });
      roster.append(el("label", { class: on ? "on" : "", "data-roster": p.playerNumber, title: p.playerNumber }, box,
        el("b", {}, String(p.number)), el("span", { class: "muted small" }, p.position)));
    }
    // Team colour: dropdown in the summary row, saves on change.
    const cSel = el("select", { class: "colour-select sm", "aria-label": `Colour for ${team.name}`, onclick: (ev) => ev.stopPropagation() });
    const cOther = el("input", { type: "text", maxlength: "20", placeholder: "New colour", hidden: true, "aria-label": `New colour for ${team.name}`, style: "max-width:140px", onclick: (ev) => ev.stopPropagation() });
    fillColourSelect(cSel, { value: team.colour || "", allowNone: true, noneLabel: "None (default jerseys)" });
    cSel.addEventListener("change", () => {
      if (cSel.value === OTHER) { cOther.hidden = false; cOther.focus(); return; }
      updateTeam(team, { colour: cSel.value });
    });
    const commitOther = () => { const v = cOther.value.trim(); if (v) updateTeam(team, { colour: v }); };
    cOther.addEventListener("change", commitOther);
    cOther.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); commitOther(); } });
    // Rename in place: the name is an input in the summary row, saved when you leave it or press Enter.
    const nameIn = el("input", { type: "text", class: "sm", maxlength: "30", value: team.name, "aria-label": `Name of ${team.name}`,
      onclick: (ev) => ev.stopPropagation() });
    nameIn.addEventListener("change", () => { const v = nameIn.value.trim(); if (v && v !== team.name) updateTeam(team, { name: v }); });
    nameIn.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); nameIn.blur(); } });
    const det = el("details", { class: "team", "data-team": team.id, open: state.openTeam === team.id ? "" : null },
      el("summary", { title: "Open to pick the players on this team" },
        el("span", { class: "chev", "aria-hidden": "true" }, "▾"),
        el("span", { class: "swatch", style: `background:${swatchColour(team.colour || "")}` }), nameIn,
        el("span", { class: "pill pick" }, `${team.players.length} players · pick ▾`),
        el("span", { class: "muted small", style: "font-weight:400" }, team.players.filter((pn) => t.players.find((p) => p.playerNumber === pn)?.position === "G").length + " G"),
        cSel, cOther,
        el("button", { class: "btn sm danger", type: "button", onclick: (ev) => { ev.preventDefault(); deleteTeam(team); } }, "Delete team")),
      roster);
    det.addEventListener("toggle", () => { if (det.open) state.openTeam = team.id; else if (state.openTeam === team.id) state.openTeam = null; });
    list.append(det);
  }
  if (!t.teams.length) list.append(el("p", { class: "muted" }, "No teams yet. Create one, then tick the players on it."));
}

$("teamForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  await run(async () => {
    const colour = colourValue($("teamColour"), $("teamColourOther"));
    const data = await gql(`mutation($tryoutId: ID!, $name: String!, $colour: String) { createTeam(tryoutId: $tryoutId, name: $name, colour: $colour) { id name colour players } }`,
      { tryoutId: state.tryout.id, name: $("teamName").value.trim(), colour: colour || null });
    $("teamName").value = ""; $("teamColourOther").value = ""; $("teamColourOther").hidden = true;
    state.openTeam = data.createTeam.id;
    await loadAll();
  }, "Team created. Tick the players on it.");
});

async function updateTeam(team, patch) {
  await run(async () => {
    const data = await gql(`mutation($tryoutId: ID!, $teamId: ID!, $name: String, $colour: String) { updateTeam(tryoutId: $tryoutId, teamId: $teamId, name: $name, colour: $colour) { id name colour players } }`,
      { tryoutId: state.tryout.id, teamId: team.id, name: patch.name ?? null, colour: patch.colour ?? null });
    Object.assign(team, data.updateTeam);
    for (const s of state.tryout.sessions) deriveTeams(s, state.tryout.teams);
    renderAll();
  }, patch.name !== undefined ? `Team renamed to ${patch.name}.` : `${team.name}${patch.colour !== undefined ? ` now wears ${patch.colour || "no set colour"}` : " updated"}.`);
}

async function setTeamPlayers(team, players) {
  await run(async () => {
    const data = await gql(`mutation($tryoutId: ID!, $teamId: ID!, $players: [ID!]!) { setTeamPlayers(tryoutId: $tryoutId, teamId: $teamId, players: $players) { id name colour players } }`,
      { tryoutId: state.tryout.id, teamId: team.id, players });
    team.players = data.setTeamPlayers.players;
    for (const s of state.tryout.sessions) deriveTeams(s, state.tryout.teams);
    renderAll();
  }, `${team.name}: ${players.length} players.`);
}

async function deleteTeam(team) {
  if (!confirm(`Delete ${team.name}? Sessions using it will lose it.`)) return;
  await run(async () => {
    await gql(`mutation($tryoutId: ID!, $teamId: ID!) { deleteTeam(tryoutId: $tryoutId, teamId: $teamId) }`, { tryoutId: state.tryout.id, teamId: team.id });
    await loadAll();
  }, `${team.name} deleted.`);
}

/** Cell in the Sessions table: teams on the ice with colours, plus an add row (scrimmage/game only). */
function sessionTeamsCell(s) {
  const t = state.tryout;
  const wrap = el("div", { class: "row", style: "flex-wrap:wrap;gap:.3rem;align-items:center;min-width:280px" });
  for (const st of s.teams || []) {
    const team = t.teams.find((x) => x.id === st.teamId);
    wrap.append(el("span", { class: "pill" }, st.colour ? el("span", { class: "swatch", style: `background:${swatchColour(st.colour)}` }) : null, `${team?.name || "?"}${st.colour ? ` · ${st.colour}` : ""} `,
      el("button", { class: "btn sm ghost", type: "button", style: "min-height:28px;padding:0 .3rem", "aria-label": `Remove ${team?.name || "team"} from ${s.label}`,
        onclick: () => setSessionTeams(s, s.teams.filter((x) => x.teamId !== st.teamId)) }, "✕")));
  }
  const skills = s.type === "skills";
  // Max two: full-ice scrimmages have two teams; a skills night has one or two groups on the ice.
  if ((s.teams || []).length >= 2) return wrap;
  const available = t.teams.filter((x) => !(s.teams || []).some((st) => st.teamId === x.id));
  if (!t.teams.length) { wrap.append(el("span", { class: "muted small" }, skills ? "everyone (make a team above to use it as a group)" : "create teams above")); return wrap; }
  if (!available.length) return wrap;
  if ((s.teams || []).length === 1) wrap.append(el("span", { class: "muted small" }, skills ? "and" : "vs"));
  else if (skills) wrap.append(el("span", { class: "muted small" }, "everyone, or a group:"));
  const teamSel = el("select", { class: "sm", "aria-label": `Add team to ${s.label}` }, ...available.map((x) => el("option", { value: x.id }, x.name)));
  const colSel = el("select", { class: "sm colour-select", "aria-label": `Colour for the team added to ${s.label}` });
  // Pre-filled from the team. Skills groups default to "own colours" so forwards/defence keep what the bulk row set.
  const teamColour = () => (skills ? "" : t.teams.find((x) => x.id === teamSel.value)?.colour || "White");
  fillColourSelect(colSel, { value: teamColour(), allowNone: true, noneLabel: "default jerseys" });
  teamSel.addEventListener("change", () => fillColourSelect(colSel, { value: teamColour(), allowNone: true, noneLabel: "default jerseys" }));
  const add = el("button", { class: "btn sm", type: "button", onclick: () => {
    if (colSel.value === OTHER) { msg("Pick a colour from the list (add new colours in the Attendance & jerseys section).", "bad"); return; }
    setSessionTeams(s, [...(s.teams || []), { teamId: teamSel.value, colour: colSel.value || null }]);
  } }, skills ? "+ group" : "+ team");
  wrap.append(teamSel, colSel, add);
  return wrap;
}

async function setSessionTeams(session, teams, okText) {
  await run(async () => {
    const data = await gql(`mutation($tryoutId: ID!, $sessionId: ID!, $teams: [SessionTeamInput!]!) {
      setSessionTeams(tryoutId: $tryoutId, sessionId: $sessionId, teams: $teams) { id teams { teamId colour } } }`,
      { tryoutId: state.tryout.id, sessionId: session.id, teams: teams.map((t) => ({ teamId: t.teamId, colour: t.colour })) });
    session.teams = data.setSessionTeams.teams;
    deriveTeams(session, state.tryout.teams);
    state.attendSessionId = session.id;
    renderAll();
  }, okText || (teams.length ? `${session.label}: ${teams.map((t) => `${state.tryout.teams.find((x) => x.id === t.teamId)?.name || "?"}${t.colour ? ` in ${t.colour}` : ""}`).join(session.type === "skills" ? " and " : " vs ")}.` : `${session.label}: no teams, everyone plays.`));
}

async function setSessionColours(session, colours, okText) {
  await run(async () => {
    const data = await gql(`mutation($tryoutId: ID!, $sessionId: ID!, $colours: AWSJSON!) {
      setSessionColours(tryoutId: $tryoutId, sessionId: $sessionId, colours: $colours) { id colours } }`,
      { tryoutId: state.tryout.id, sessionId: session.id, colours: JSON.stringify(colours) });
    session.colours = JSON.parse(data.setSessionColours.colours || "{}");
    renderAll();
  }, okText || `Jersey colours updated for ${session.label}.`);
}

async function setAttendance(session, p, present) {
  await run(async () => {
    const data = await gql(`mutation($tryoutId: ID!, $sessionId: ID!, $playerNumber: ID!, $present: Boolean!) {
      setAttendance(tryoutId: $tryoutId, sessionId: $sessionId, playerNumber: $playerNumber, present: $present) { id absent } }`,
      { tryoutId: state.tryout.id, sessionId: session.id, playerNumber: p.playerNumber, present });
    session.absent = data.setAttendance.absent;
    renderAttendance(); renderRankings();
  }, `${p.playerNumber} marked ${present ? "present" : "absent"} for ${session.label}.`);
}

async function setActive(p, active) {
  await run(async () => {
    await gql(`mutation($tryoutId: ID!, $playerNumber: ID!, $active: Boolean!) { setPlayerActive(tryoutId: $tryoutId, playerNumber: $playerNumber, active: $active) { playerNumber active } }`,
      { tryoutId: state.tryout.id, playerNumber: p.playerNumber, active });
    p.active = active; renderAll();
  }, `${p.playerNumber} ${active ? "reinstated" : "released"}.`);
}

async function setAccess(evaluatorId, enabled) {
  await run(async () => {
    await gql(`mutation($tryoutId: ID!, $evaluatorId: ID!, $enabled: Boolean!) { setEvaluatorAccess(tryoutId: $tryoutId, evaluatorId: $evaluatorId, enabled: $enabled) { evaluatorId enabled } }`,
      { tryoutId: state.tryout.id, evaluatorId, enabled });
    await loadAll();
  }, enabled ? "Evaluator can now score this tryout." : "Evaluator disabled. Any further scores from them will be rejected.");
}

$("evaluatorForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  await run(async () => {
    const data = await gql(`mutation($email: AWSEmail!, $displayName: String!) { createEvaluator(email: $email, displayName: $displayName) { id } }`,
      { email: $("eEmail").value.trim(), displayName: $("eLabel").value.trim() });
    // New logins are added to the current tryout straight away.
    await gql(`mutation($tryoutId: ID!, $evaluatorId: ID!, $enabled: Boolean!) { setEvaluatorAccess(tryoutId: $tryoutId, evaluatorId: $evaluatorId, enabled: $enabled) { evaluatorId } }`,
      { tryoutId: state.tryout.id, evaluatorId: data.createEvaluator.id, enabled: true });
    $("eEmail").value = ""; $("eLabel").value = "";
    await loadAll();
  }, "Login created and added to this tryout. Send them the app link: they sign in with their email and a one-time code.");
});

async function deleteEvaluator(e) {
  if (!confirm(`Delete the login for "${e.displayName}"? Their scores are kept. To just stop them scoring, use Disable instead.`)) return;
  await run(async () => { await gql(`mutation($id: ID!) { deleteEvaluator(id: $id) }`, { id: e.id }); await loadAll(); }, "Evaluator login deleted.");
}

// ----------------------------------------------------------------------------- Rankings
function rankColumns(position) {
  const crits = position === "all" ? CRITERIA : criteriaFor(position);
  // Overall, spread and tier votes first so they are visible without horizontal scrolling; criteria after.
  return [
    { key: "playerNumber", label: "Player", num: false },
    { key: "position", label: "Pos", num: false },
    { key: "attended", label: "Sessions", num: true },
    { key: "n", label: "Evals", num: true },
    { key: "overall", label: "Overall", num: true },
    { key: "spread", label: "Spread", num: true },
    { key: "tiers.A", label: "A", num: true }, { key: "tiers.B", label: "B", num: true },
    { key: "tiers.C", label: "C", num: true }, { key: "tiers.X", label: "X", num: true },
    ...crits.map((c) => ({ key: `crit.${c.key}`, label: c.label, num: true, crit: c.key })),
  ];
}
const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

function sortRows(rows, key, dir) {
  const s = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getPath(a, key), vb = getPath(b, key);
    if (va == null && vb == null) return a.playerNumber.localeCompare(b.playerNumber);
    if (va == null) return 1; if (vb == null) return -1;
    if (typeof va === "string") return s * va.localeCompare(vb);
    return s * (va - vb) || a.playerNumber.localeCompare(b.playerNumber);
  });
}

function renderRankings() {
  const head = $("rankHead"), body = $("rankBody");
  head.innerHTML = ""; body.innerHTML = "";
  if (!state.tryout) return;
  const { rows, stats } = computeRankings();
  const cols = rankColumns(state.rank.position);
  const tr = el("tr");
  for (const c of cols) {
    const th = el("th", { class: `sortable${c.num ? " num" : ""}${state.rank.sortKey === c.key ? ` sorted-${state.rank.sortDir}` : ""}`,
      onclick: () => { if (state.rank.sortKey === c.key) state.rank.sortDir = state.rank.sortDir === "asc" ? "desc" : "asc"; else { state.rank.sortKey = c.key; state.rank.sortDir = c.num ? "desc" : "asc"; } renderRankings(); } }, c.label);
    tr.append(th);
  }
  head.append(tr);
  const sorted = sortRows(rows, state.rank.sortKey, state.rank.sortDir);
  for (const r of sorted) {
    const row = el("tr", { class: r.spread !== null && r.spread >= SPREAD_THRESHOLD ? "disagree" : "" });
    for (const c of cols) {
      let v = getPath(r, c.key);
      let text;
      if (c.key === "playerNumber") { row.append(el("td", {}, el("span", { class: "swatch", style: `background:${swatchColour(r.colour)}` }), el("b", {}, r.playerNumber), r.tag ? el("span", { class: "tagpill", style: "margin-left:.4rem" }, r.tag) : null)); continue; }
      if (c.key === "attended") { row.append(el("td", { class: "num" }, `${r.attended}/${r.sessionsTotal}`)); continue; }
      if (c.crit) text = criteriaFor(r.position).some((x) => x.key === c.crit) ? fmt(v) : "–";
      else if (c.key === "overall" || c.key === "spread") text = fmt(v);
      else text = v == null ? "" : String(v);
      row.append(el("td", { class: c.num ? "num" : "" }, text));
    }
    body.append(row);
  }
  if (!sorted.length) body.append(el("tr", {}, el("td", { colspan: cols.length, class: "muted" }, "No active players.")));
  const evaluated = rows.filter((r) => r.n > 0).length;
  $("rSummary").textContent = `${rows.length} players · ${evaluated} with evaluations · ${state.evals.length} evaluations total · group mean ${fmt(stats.group.mean)}`;
}

for (const [id, key] of [["rSession", "sessionId"], ["rPosition", "position"]]) {
  $(id).addEventListener("change", (ev) => { state.rank[key] = ev.target.value; renderRankings(); });
}
$("rEqual").addEventListener("change", (ev) => { state.rank.equalWeights = ev.target.checked; renderRankings(); renderEvaluatorsTab(); });
$("rNormalize").addEventListener("change", (ev) => { state.rank.normalize = ev.target.checked; renderRankings(); });
$("rTagged").addEventListener("change", (ev) => { state.rank.taggedOnly = ev.target.checked; renderRankings(); });

// ----------------------------------------------------------------------------- By evaluator
function renderEvaluatorsTab() {
  const sel = $("vEvaluator");
  const cur = state.view.evaluatorId || sel.value;
  sel.innerHTML = "";
  const ids = [...new Set([...state.evaluators.map((e) => e.id), ...state.evals.map((e) => e.evaluatorId)])];
  for (const id of ids) sel.append(el("option", { value: id }, evaluatorName(id)));
  if (ids.length) { sel.value = ids.includes(cur) ? cur : ids[0]; state.view.evaluatorId = sel.value; }

  const { group, per } = evaluatorStats(state.rank.equalWeights);
  const all = $("vAllBody"); all.innerHTML = "";
  for (const id of ids) {
    const s = per.get(id);
    const diff = s && group.mean !== null ? s.mean - group.mean : null;
    let tendency = "";
    if (diff !== null && s.n >= 3) tendency = diff > 0.35 ? "generous" : diff < -0.35 ? "harsh" : "in line";
    if (s && s.sd !== null && s.n >= 3 && s.sd < 0.35) tendency += (tendency ? ", " : "") + "narrow range";
    all.append(el("tr", { class: id === state.view.evaluatorId ? "" : "" },
      el("td", {}, evaluatorName(id)), el("td", { class: "num" }, String(s?.n || 0)), el("td", { class: "num" }, fmt(s?.mean)),
      el("td", { class: "num" }, fmt(s?.sd)), el("td", { class: "num" }, diff === null ? "" : (diff >= 0 ? "+" : "") + fmt(diff)), el("td", {}, tendency)));
  }
  all.append(el("tr", {}, el("td", {}, el("b", {}, "Group")), el("td", { class: "num" }, String(group.n)), el("td", { class: "num" }, fmt(group.mean)), el("td", { class: "num" }, fmt(group.sd)), el("td"), el("td")));

  const stats = $("vStats"); stats.innerHTML = "";
  const s = per.get(state.view.evaluatorId);
  if (s) {
    stats.append(
      el("div", { class: "stat" }, el("span", { class: "small muted" }, "Their mean"), el("b", {}, fmt(s.mean))),
      el("div", { class: "stat" }, el("span", { class: "small muted" }, "Their std dev"), el("b", {}, fmt(s.sd))),
      el("div", { class: "stat" }, el("span", { class: "small muted" }, "Group mean"), el("b", {}, fmt(group.mean))),
      el("div", { class: "stat" }, el("span", { class: "small muted" }, "Group std dev"), el("b", {}, fmt(group.sd))),
    );
  }

  const head = $("vHead"), body = $("vBody"); head.innerHTML = ""; body.innerHTML = "";
  $("vTitle").textContent = state.view.evaluatorId ? `Scores by ${evaluatorName(state.view.evaluatorId)}` : "Scores";
  const pm = playerMap(), sm = sessionMap();
  const cols = ["Player", "Worn as", "Pos", "Session", ...CRITERIA.map((c) => c.label), "Overall", "Tier", "Notes"];
  head.append(el("tr", {}, ...cols.map((c, i) => el("th", { class: i >= 4 && i < cols.length - 2 ? "num" : "" }, c))));
  const mine = state.evals.filter((e) => e.evaluatorId === state.view.evaluatorId && (state.view.sessionId === "all" || e.sessionId === state.view.sessionId))
    .sort((a, b) => a.playerNumber.localeCompare(b.playerNumber) || a.sessionId.localeCompare(b.sessionId));
  for (const e of mine) {
    const p = pm.get(e.playerNumber);
    const overall = p ? weightedScore(p.position, e.scores, { equalWeights: state.rank.equalWeights }) : null;
    body.append(el("tr", {},
      el("td", {}, el("b", {}, e.playerNumber)), el("td", {}, p ? wornCode(sm.get(e.sessionId), p) : ""), el("td", {}, p?.position || ""), el("td", {}, sm.get(e.sessionId)?.label || e.sessionId),
      ...CRITERIA.map((c) => el("td", { class: "num" }, e.scores[c.key] ?? (p && criteriaFor(p.position).some((x) => x.key === c.key) ? "" : "–"))),
      el("td", { class: "num" }, fmt(overall)), el("td", {}, e.tier || ""), el("td", { style: "white-space:normal;min-width:200px" }, e.notes || "")));
  }
  if (!mine.length) body.append(el("tr", {}, el("td", { colspan: cols.length, class: "muted" }, "No scores yet.")));
}
$("vEvaluator").addEventListener("change", (ev) => { state.view.evaluatorId = ev.target.value; renderEvaluatorsTab(); });
$("vSession").addEventListener("change", (ev) => { state.view.sessionId = ev.target.value; renderEvaluatorsTab(); });

// ----------------------------------------------------------------------------- Export
function csv(rows) {
  const q = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const today = () => new Date().toISOString().slice(0, 10);

/** Rankings CSV: header uses the rubric labels from criteria.js so it matches the form exactly. */
function rankingsCsv() {
  const { rows } = computeRankings();
  const crits = state.rank.position === "all" ? CRITERIA : criteriaFor(state.rank.position);
  const header = ["player_number", "colour", "number", "position", "tag", "sessions_attended", "sessions_total", "evaluations", "evaluators",
    ...crits.map((c) => `avg_${c.key}`), "overall", "tier_A", "tier_B", "tier_C", "tier_X", "spread"];
  const sorted = sortRows(rows, state.rank.sortKey, state.rank.sortDir);
  const data = sorted.map((r) => [r.playerNumber, r.colour, r.number, r.position, r.tag || "", r.attended, r.sessionsTotal, r.n, r.evaluators,
    ...crits.map((c) => (r.crit[c.key] === null || r.crit[c.key] === undefined ? "" : fmt(r.crit[c.key], 3))),
    fmt(r.overall, 3), r.tiers.A, r.tiers.B, r.tiers.C, r.tiers.X, fmt(r.spread, 3)]);
  const meta = [`# ${state.tryout.name}`, `session=${state.rank.sessionId}`, `position=${state.rank.position}`,
    `weights=${state.rank.equalWeights ? "equal" : "rubric"}`, `normalised=${state.rank.normalize}`, `exported=${today()}`];
  return { name: `rankings-${slug(state.tryout.name)}-${today()}.csv`, text: csv([meta, header, ...data]) };
}

function rawCsv() {
  const pm = playerMap(), sm = sessionMap();
  const header = ["player_number", "worn_as", "position", "tag", "session", "session_date", "evaluator", ...CRITERIA.map((c) => c.key), "overall", "tier", "notes", "updated_at"];
  const data = [...state.evals].sort((a, b) => a.playerNumber.localeCompare(b.playerNumber) || a.sessionId.localeCompare(b.sessionId) || a.evaluatorId.localeCompare(b.evaluatorId))
    .map((e) => {
      const p = pm.get(e.playerNumber), s = sm.get(e.sessionId);
      return [e.playerNumber, p ? wornCode(s, p) : "", p?.position || "", p?.tag || "", s?.label || e.sessionId, s?.date || "", evaluatorName(e.evaluatorId),
        ...CRITERIA.map((c) => e.scores[c.key] ?? ""), fmt(p ? weightedScore(p.position, e.scores) : null, 3), e.tier || "", (e.notes || "").slice(0, NOTES_MAX), e.updatedAt];
    });
  return { name: `evaluations-${slug(state.tryout.name)}-${today()}.csv`, text: csv([header, ...data]) };
}

function download({ name, text }) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function upload({ name, text }) {
  const data = await gql(`mutation($tryoutId: ID!, $filename: String!) { exportUrl(tryoutId: $tryoutId, filename: $filename) }`, { tryoutId: state.tryout.id, filename: name });
  const res = await fetch(data.exportUrl, { method: "PUT", headers: { "content-type": "text/csv" }, body: text });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return name;
}

$("dlRankings").addEventListener("click", () => run(() => download(rankingsCsv())));
$("dlRaw").addEventListener("click", () => run(() => download(rawCsv())));
$("upRankings").addEventListener("click", () => run(async () => { const n = await upload(rankingsCsv()); $("exportMsg").textContent = `Uploaded ${n} to the private exports bucket.`; }));
$("upRaw").addEventListener("click", () => run(async () => { const n = await upload(rawCsv()); $("exportMsg").textContent = `Uploaded ${n} to the private exports bucket.`; }));

// ----------------------------------------------------------------------------- Close
$("closeBtn").addEventListener("click", async () => {
  if (!confirm(`Close "${state.tryout.name}"? Scoring stops for everyone. Export your CSVs first.`)) return;
  if (!confirm("Are you sure? This cannot be undone from the app.")) return;
  await run(async () => { await gql(`mutation($tryoutId: ID!) { closeTryout(tryoutId: $tryoutId) { id status } }`, { tryoutId: state.tryout.id }); await loadAll(); }, "Tryout closed.");
});

// ----------------------------------------------------------------------------- Collapsible setup cards
// Click a card's heading to fold it (remembered on this browser). A folded card shows a short count.
const COLLAPSE_KEY = "ui:setup:collapsed";
function initCollapsible() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}"); } catch { /* private mode */ }
  for (const card of document.querySelectorAll("#tab-setup .card, #tab-evaluators .card")) {
    const h2 = card.querySelector(":scope > h2");
    if (!h2 || !card.id) continue;
    card.classList.add("collapsible");
    const chev = el("span", { class: "chev", "aria-hidden": "true" }, "▾");
    const count = el("span", { class: "count", "data-count": "" });
    h2.prepend(chev); h2.append(count);
    h2.setAttribute("role", "button"); h2.setAttribute("tabindex", "0");
    const apply = (collapsed) => { card.classList.toggle("collapsed", collapsed); h2.setAttribute("aria-expanded", String(!collapsed)); };
    apply(!!saved[card.id]);
    const toggle = () => {
      apply(!card.classList.contains("collapsed"));
      saved[card.id] = card.classList.contains("collapsed");
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(saved)); } catch { /* ignore */ }
    };
    h2.addEventListener("click", (ev) => { if (ev.target.closest("summary, button, input, select, a")) return; toggle(); });
    h2.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); } });
  }
}
/** Update the short counts shown next to card headings. */
function renderCardCounts() {
  const t = state.tryout;
  const set = (id, text) => { const c = document.querySelector(`#${id} > h2 .count`); if (c) c.textContent = text; };
  set("sessionsCard", t ? `${t.sessions.length} session${t.sessions.length === 1 ? "" : "s"}` : "");
  set("playersCard", t ? `${t.players.filter((p) => p.active).length} active` : "");
  set("teamsCard", t ? `${t.teams.length} team${t.teams.length === 1 ? "" : "s"}` : "");
  set("evaluatorsCard", `${state.evaluators.length} login${state.evaluators.length === 1 ? "" : "s"}`);
  const a = t?.sessions.find((s) => s.id === state.attendSessionId);
  set("attendanceCard", a ? a.label : "");
}

// ----------------------------------------------------------------------------- Tabs + boot
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t === tab));
    for (const p of document.querySelectorAll(".tabpanel")) p.hidden = p.id !== `tab-${tab.dataset.tab}`;
    if (tab.dataset.tab === "rankings") renderRankings();
    if (tab.dataset.tab === "evaluators") renderEvaluatorsTab();
  });
}
initCollapsible();
$("refreshBtn").addEventListener("click", () => run(loadAll, "Refreshed."));
$("signOutBtn").addEventListener("click", () => { signOut(); location.replace("index.html"); });
$("sDate").value = today();
await run(loadAll);
