// Convenor dashboard: setup, rankings, per-evaluator view, CSV export, close.
// Everything here is by player number only. There is no name field anywhere and no place to type one.
import { requireAuth, signOut } from "./auth.js";
import { gql, fetchAllEvaluations, registerServiceWorker, Q_CURRENT_TRYOUT, normalizeTryout, swatchColour, AuthError } from "./api.js";
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
  rank: { sessionId: "all", position: "all", equalWeights: false, normalize: false, sortKey: "overall", sortDir: "desc" },
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
  const data = await gql(Q_CURRENT_TRYOUT);
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
  const { sessionId, position, equalWeights, normalize } = state.rank;
  const pm = playerMap();
  const stats = evaluatorStats(equalWeights);
  const players = (state.tryout?.players || []).filter((p) => p.active && (position === "all" || p.position === position));
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
    rows.push({
      playerNumber: p.playerNumber, colour: p.colour, number: p.number, position: p.position,
      n, crit, overall: mean(overalls), tiers, spread: stddev(perEvalMeans), evaluators: perEvaluator.size,
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
  renderSetup(); renderRankings(); renderEvaluatorsTab(); 
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
  t.sessions.forEach((s, i) => sb.append(el("tr", {}, el("td", {}, String(i + 1)), el("td", {}, s.label), el("td", {}, s.date), el("td", {}, s.type))));
  if (!t.sessions.length) sb.append(el("tr", {}, el("td", { colspan: 4, class: "muted" }, "No sessions yet.")));

  const pb = $("playersBody"); pb.innerHTML = "";
  const players = t.players.filter((p) => state.showInactive || p.active);
  $("playerCount").textContent = `${t.players.filter((p) => p.active).length} active · ${t.players.filter((p) => !p.active).length} released`;
  for (const p of players) {
    pb.append(el("tr", { class: p.active ? "" : "inactive" },
      el("td", {}, el("span", { class: "swatch", style: `background:${swatchColour(p.colour)}` }), el("b", {}, p.playerNumber)),
      el("td", {}, p.colour), el("td", { class: "num" }, String(p.number)), el("td", {}, p.position),
      el("td", {}, el("span", { class: `pill ${p.active ? "ok" : "bad"}` }, p.active ? "active" : "released")),
      el("td", {}, el("button", { class: "btn sm", type: "button", onclick: () => setActive(p, !p.active) }, p.active ? "Release" : "Reinstate")),
    ));
  }
  if (!players.length) pb.append(el("tr", {}, el("td", { colspan: 6, class: "muted" }, "No players yet.")));

  const eb = $("evaluatorsBody"); eb.innerHTML = "";
  for (const e of state.evaluators) {
    eb.append(el("tr", {}, el("td", {}, e.displayName), el("td", { class: "muted small" }, e.id),
      el("td", {}, el("button", { class: "btn sm danger", type: "button", onclick: () => deleteEvaluator(e) }, "Delete login"))));
  }
  if (!state.evaluators.length) eb.append(el("tr", {}, el("td", { colspan: 3, class: "muted" }, "No evaluator logins yet.")));

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
    await gql(`mutation($tryoutId: ID!, $label: String!, $date: AWSDate!, $type: String!) { addSession(tryoutId: $tryoutId, label: $label, date: $date, type: $type) { id } }`,
      { tryoutId: state.tryout.id, label: $("sLabel").value.trim(), date: $("sDate").value, type: $("sType").value });
    $("sLabel").value = "";
    await loadAll();
  }, "Session added.");
});

/** Parse `colour,number,position` lines. Refuses anything that could be a roster with names. */
export function parsePlayersCsv(text) {
  const players = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) return;
    const cols = raw.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && /^colou?r$/i.test(cols[0])) return; // header row
    if (cols.length !== 3) throw new Error(`Line ${i + 1}: expected exactly 3 columns (colour,number,position). Rosters with names are not accepted.`);
    const [colour, number, position] = cols;
    if (/name|dob|birth/i.test(raw)) throw new Error(`Line ${i + 1}: looks like it contains a name or birthdate.`);
    if (!/^[A-Za-z]{2,20}$/.test(colour)) throw new Error(`Line ${i + 1}: colour "${colour}" must be letters only.`);
    if (!/^\d{1,3}$/.test(number)) throw new Error(`Line ${i + 1}: number "${number}" must be 0-999.`);
    if (!/^[FDG]$/i.test(position)) throw new Error(`Line ${i + 1}: position must be F, D or G.`);
    players.push({ colour: colour.charAt(0).toUpperCase() + colour.slice(1).toLowerCase(), number: Number(number), position: position.toUpperCase() });
  });
  return players;
}

function checkColourInitials(newPlayers) {
  const colours = new Set([...(state.tryout?.players || []).map((p) => p.colour), ...newPlayers.map((p) => p.colour)]);
  const byInitial = new Map();
  for (const c of colours) { const k = c.charAt(0).toUpperCase(); if (!byInitial.has(k)) byInitial.set(k, new Set()); byInitial.get(k).add(c); }
  const clashes = [...byInitial.values()].filter((s) => s.size > 1).map((s) => [...s].join(" / "));
  if (clashes.length) throw new Error(`These colours share a first letter and would get the same player codes: ${clashes.join("; ")}. Rename one (e.g. "Black" → "Dark").`);
}

async function upsertPlayers(players) {
  checkColourInitials(players);
  for (let i = 0; i < players.length; i += 25) {
    await gql(`mutation($tryoutId: ID!, $players: [PlayerInput!]!) { upsertPlayers(tryoutId: $tryoutId, players: $players) { playerNumber } }`,
      { tryoutId: state.tryout.id, players: players.slice(i, i + 25) });
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
  const p = { colour: $("pColour").value.trim(), number: Number($("pNumber").value), position: $("pPosition").value };
  await run(async () => { await upsertPlayers([p]); $("pNumber").value = ""; await loadAll(); }, "Player added.");
});

$("showInactive").addEventListener("change", (ev) => { state.showInactive = ev.target.checked; renderSetup(); });

async function setActive(p, active) {
  await run(async () => {
    await gql(`mutation($tryoutId: ID!, $playerNumber: ID!, $active: Boolean!) { setPlayerActive(tryoutId: $tryoutId, playerNumber: $playerNumber, active: $active) { playerNumber active } }`,
      { tryoutId: state.tryout.id, playerNumber: p.playerNumber, active });
    p.active = active; renderAll();
  }, `${p.playerNumber} ${active ? "reinstated" : "released"}.`);
}

$("evaluatorForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  await run(async () => {
    await gql(`mutation($email: AWSEmail!, $displayName: String!) { createEvaluator(email: $email, displayName: $displayName) { id } }`,
      { email: $("eEmail").value.trim(), displayName: $("eLabel").value.trim() });
    $("eEmail").value = ""; $("eLabel").value = "";
    await loadAll();
  }, "Evaluator created. They will receive an email with a temporary password.");
});

async function deleteEvaluator(e) {
  if (!confirm(`Delete the login for "${e.displayName}"? Their scores are kept.`)) return;
  await run(async () => { await gql(`mutation($id: ID!) { deleteEvaluator(id: $id) }`, { id: e.id }); await loadAll(); }, "Evaluator login deleted.");
}

// ----------------------------------------------------------------------------- Rankings
function rankColumns(position) {
  const crits = position === "all" ? CRITERIA : criteriaFor(position);
  // Overall, spread and tier votes first so they are visible without horizontal scrolling; criteria after.
  return [
    { key: "playerNumber", label: "Player", num: false },
    { key: "position", label: "Pos", num: false },
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
      if (c.key === "playerNumber") { row.append(el("td", {}, el("span", { class: "swatch", style: `background:${swatchColour(r.colour)}` }), el("b", {}, r.playerNumber))); continue; }
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
  const cols = ["Player", "Pos", "Session", ...CRITERIA.map((c) => c.label), "Overall", "Tier", "Notes"];
  head.append(el("tr", {}, ...cols.map((c, i) => el("th", { class: i >= 3 && i < cols.length - 2 ? "num" : "" }, c))));
  const mine = state.evals.filter((e) => e.evaluatorId === state.view.evaluatorId && (state.view.sessionId === "all" || e.sessionId === state.view.sessionId))
    .sort((a, b) => a.playerNumber.localeCompare(b.playerNumber) || a.sessionId.localeCompare(b.sessionId));
  for (const e of mine) {
    const p = pm.get(e.playerNumber);
    const overall = p ? weightedScore(p.position, e.scores, { equalWeights: state.rank.equalWeights }) : null;
    body.append(el("tr", {},
      el("td", {}, el("b", {}, e.playerNumber)), el("td", {}, p?.position || ""), el("td", {}, sm.get(e.sessionId)?.label || e.sessionId),
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
  const header = ["player_number", "colour", "number", "position", "evaluations", "evaluators",
    ...crits.map((c) => `avg_${c.key}`), "overall", "tier_A", "tier_B", "tier_C", "tier_X", "spread"];
  const sorted = sortRows(rows, state.rank.sortKey, state.rank.sortDir);
  const data = sorted.map((r) => [r.playerNumber, r.colour, r.number, r.position, r.n, r.evaluators,
    ...crits.map((c) => (r.crit[c.key] === null || r.crit[c.key] === undefined ? "" : fmt(r.crit[c.key], 3))),
    fmt(r.overall, 3), r.tiers.A, r.tiers.B, r.tiers.C, r.tiers.X, fmt(r.spread, 3)]);
  const meta = [`# ${state.tryout.name}`, `session=${state.rank.sessionId}`, `position=${state.rank.position}`,
    `weights=${state.rank.equalWeights ? "equal" : "rubric"}`, `normalised=${state.rank.normalize}`, `exported=${today()}`];
  return { name: `rankings-${slug(state.tryout.name)}-${today()}.csv`, text: csv([meta, header, ...data]) };
}

function rawCsv() {
  const pm = playerMap(), sm = sessionMap();
  const header = ["player_number", "position", "session", "session_date", "evaluator", ...CRITERIA.map((c) => c.key), "overall", "tier", "notes", "updated_at"];
  const data = [...state.evals].sort((a, b) => a.playerNumber.localeCompare(b.playerNumber) || a.sessionId.localeCompare(b.sessionId) || a.evaluatorId.localeCompare(b.evaluatorId))
    .map((e) => {
      const p = pm.get(e.playerNumber), s = sm.get(e.sessionId);
      return [e.playerNumber, p?.position || "", s?.label || e.sessionId, s?.date || "", evaluatorName(e.evaluatorId),
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

// ----------------------------------------------------------------------------- Tabs + boot
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t === tab));
    for (const p of document.querySelectorAll(".tabpanel")) p.hidden = p.id !== `tab-${tab.dataset.tab}`;
    if (tab.dataset.tab === "rankings") renderRankings();
    if (tab.dataset.tab === "evaluators") renderEvaluatorsTab();
  });
}
$("refreshBtn").addEventListener("click", () => run(loadAll, "Refreshed."));
$("signOutBtn").addEventListener("click", () => { signOut(); location.replace("index.html"); });
$("sDate").value = today();
await run(loadAll);
