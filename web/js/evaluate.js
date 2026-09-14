// Evaluator screen. One player, one category, one tap. Everything persists locally before any network call.
import { requireAuth, signOut, store } from "./auth.js";
import {
  gql, enqueueEvaluation, subscribe, flush, startSyncLoop, setCurrentUser, onSynced, retryFailed, failedEntries,
  registerServiceWorker, NetworkError, AuthError, Q_CURRENT_TRYOUT, Q_MY_EVALS, normalizeTryout, parseScores, swatchColour,
  wornColour, wornCode, isAbsent,
} from "./api.js";
import { SCALE, TIERS, criteriaFor, NOTES_MAX } from "./criteria.js";

registerServiceWorker();
const me = await requireAuth();
setCurrentUser(me.sub);

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) n.append(c);
  return n;
};

// ----------------------------------------------------------------------------- State
const state = {
  tryout: null,
  sessionId: null,
  filter: { colour: null, position: null },
  evals: {},        // playerNumber -> { scores, tier, notes, updatedAt, clientId }
  current: null,    // playerNumber open in the sheet
  offline: false,
};

const KEY_TRYOUT = "cache:tryout";
const KEY_SESSION = "ui:session";
const evalKey = () => `evals:${state.tryout.id}:${state.sessionId}:${me.sub}`;
const clientIdsKey = () => `clientIds:${state.tryout.id}:${me.sub}`;

function clientIdFor(playerNumber) {
  const ids = store.get(clientIdsKey(), {});
  const k = `${state.sessionId}:${playerNumber}`;
  if (!ids[k]) {
    ids[k] = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    store.set(clientIdsKey(), ids);
  }
  return ids[k];
}

const isClosed = () => state.tryout?.status !== "open";
const currentSession = () => state.tryout?.sessions.find((s) => s.id === state.sessionId) || null;
const colourOf = (p) => wornColour(currentSession(), p);   // jersey colour worn in the selected session
const codeOf = (p) => wornCode(currentSession(), p);
const canEvaluate = () => state.tryout?.canEvaluate === true;
/** Scoring is blocked when the tryout is closed or the caller is not an enabled evaluator on it. */
const isReadOnly = () => isClosed() || !canEvaluate();
// Players who are active AND not marked absent for the selected session: a missed skate never counts.
const activePlayers = () => (state.tryout?.players || []).filter((p) => p.active && !isAbsent(currentSession(), p));
const hasContent = (e) => !!e && (Object.keys(e.scores || {}).length > 0 || !!e.tier || !!(e.notes && e.notes.trim()));

// ----------------------------------------------------------------------------- Loading
async function loadTryout() {
  try {
    const data = await gql(Q_CURRENT_TRYOUT);
    state.tryout = normalizeTryout(data.currentTryout);
    state.offline = false;
    if (state.tryout) store.set(KEY_TRYOUT, state.tryout);
  } catch (err) {
    if (err instanceof AuthError) { location.replace("index.html"); return; }
    if (!(err instanceof NetworkError)) throw err;
    state.offline = true;
    state.tryout = store.get(KEY_TRYOUT);
  }
}

function pickDefaultSession() {
  const sessions = state.tryout.sessions;
  if (!sessions.length) return null;
  const saved = store.get(KEY_SESSION);
  if (saved && sessions.some((s) => s.id === saved)) return saved;
  const today = localDate();
  return (sessions.find((s) => s.date === today) || sessions.find((s) => s.date > today) || sessions[sessions.length - 1]).id;
}
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function loadEvaluations() {
  state.evals = store.get(evalKey(), {});
  try {
    const data = await gql(Q_MY_EVALS, { tryoutId: state.tryout.id, sessionId: state.sessionId });
    for (const e of data.myEvaluations) {
      const local = state.evals[e.playerNumber];
      const server = { scores: parseScores(e.scores), tier: e.tier || null, notes: e.notes || "", updatedAt: e.updatedAt, clientId: e.clientId };
      // Local wins when it is newer (e.g. taps made offline that have not synced yet).
      if (!local || !local.updatedAt || local.updatedAt < server.updatedAt) state.evals[e.playerNumber] = server;
    }
    store.set(evalKey(), state.evals);
  } catch (err) {
    if (err instanceof AuthError) { location.replace("index.html"); return; }
    if (!(err instanceof NetworkError)) throw err;
    state.offline = true;
  }
}

// ----------------------------------------------------------------------------- Persist + queue
function saveLocal(playerNumber, patch) {
  const prev = state.evals[playerNumber] || { scores: {}, tier: null, notes: "" };
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString(), clientId: clientIdFor(playerNumber) };
  state.evals[playerNumber] = next;
  store.set(evalKey(), state.evals);
  enqueueEvaluation({
    tryoutId: state.tryout.id,
    sessionId: state.sessionId,
    playerNumber,
    scores: next.scores,
    tier: next.tier || null,
    notes: next.notes ? next.notes.slice(0, NOTES_MAX) : null,
    clientId: next.clientId,
  }, me.sub);
  renderGrid();
  renderProgress();
}

// ----------------------------------------------------------------------------- Rendering
function renderHeader() {
  $("tryoutName").textContent = state.tryout ? state.tryout.name : "No tryout yet";
  const sel = $("sessionSelect");
  sel.innerHTML = "";
  for (const s of state.tryout?.sessions || []) {
    sel.append(el("option", { value: s.id }, `${s.label} · ${s.date}${s.jersey === "secondary" ? " · 2nd jerseys" : ""}`));
  }
  sel.value = state.sessionId || "";
  sel.disabled = !state.tryout?.sessions?.length;
}

function renderBanner() {
  const b = $("banner");
  if (!state.tryout) {
    b.hidden = false; b.className = "notice warn";
    b.textContent = state.offline ? "You're offline and this phone has no saved tryout yet. Connect once to load it." : "No tryout has been set up yet. Ask the convenor.";
  } else if (isClosed()) {
    b.hidden = false; b.className = "notice";
    b.textContent = "This tryout is closed. Your scores are read-only.";
  } else if (!canEvaluate()) {
    b.hidden = false; b.className = "notice warn";
    b.textContent = "You are not on the evaluator list for this tryout. Ask the convenor to add you, then pull down to refresh.";
  } else if (!state.tryout.sessions.length) {
    b.hidden = false; b.className = "notice warn";
    b.textContent = "No sessions have been added to this tryout yet.";
  } else {
    b.hidden = true;
  }
}

function renderChips() {
  const chips = $("chips");
  chips.innerHTML = "";
  const colours = [...new Set(activePlayers().map(colourOf))].sort();
  const mk = (label, pressed, onclick, swatch) => {
    const c = el("button", { class: "chip", type: "button", "aria-pressed": String(pressed), onclick });
    if (swatch) c.append(el("span", { class: "sw", style: `background:${swatchColour(swatch)}` }));
    c.append(label);
    return c;
  };
  chips.append(mk("All", !state.filter.colour && !state.filter.position, () => { state.filter = { colour: null, position: null }; renderChips(); renderGrid(); }));
  for (const c of colours) chips.append(mk(c, state.filter.colour === c, () => { state.filter.colour = state.filter.colour === c ? null : c; renderChips(); renderGrid(); }, c));
  for (const p of ["F", "D", "G"]) chips.append(mk(p, state.filter.position === p, () => { state.filter.position = state.filter.position === p ? null : p; renderChips(); renderGrid(); }));
}

function filteredPlayers() {
  return activePlayers()
    .filter((p) => (!state.filter.colour || colourOf(p) === state.filter.colour) && (!state.filter.position || p.position === state.filter.position))
    .sort((a, b) => (colourOf(a) < colourOf(b) ? -1 : colourOf(a) > colourOf(b) ? 1 : a.number - b.number));
}

function renderGrid() {
  const grid = $("grid");
  grid.innerHTML = "";
  const players = filteredPlayers();
  if (!players.length) {
    grid.append(el("p", { class: "muted", style: "grid-column:1/-1;text-align:center;padding:2rem 0" }, state.tryout ? "No players match this filter." : ""));
    return;
  }
  for (const p of players) {
    const e = state.evals[p.playerNumber];
    const done = hasContent(e);
    const btn = el("button", {
      class: `player${done ? " done" : ""}`, type: "button",
      "aria-label": `${codeOf(p)} ${p.position}${done ? ", scored" : ""}`,
      onclick: () => openSheet(p.playerNumber),
    },
      el("span", { class: "sw", style: `background:${swatchColour(colourOf(p))}` }),
      el("span", { class: "num" }, String(p.number).padStart(2, "0")),
      el("span", { class: "pos" }, `${colourOf(p).charAt(0)} · ${p.position}`),
    );
    if (done) btn.append(el("span", { class: "check", "aria-hidden": "true" }, "✓"));
    if (e?.tier) btn.append(el("span", { class: "tier" }, e.tier));
    if (p.tag) btn.append(el("span", { class: "tag", title: p.tag === "AA" ? "Still being considered for the AA team" : p.tag }, p.tag));
    grid.append(btn);
  }
}

function renderProgress() {
  const all = activePlayers();
  const scored = all.filter((p) => hasContent(state.evals[p.playerNumber])).length;
  const absent = (state.tryout?.players || []).filter((p) => p.active && isAbsent(currentSession(), p)).length;
  $("progressText").textContent = `${scored} of ${all.length} scored this session${absent ? ` · ${absent} absent` : ""}`;
  $("progressBar").style.width = all.length ? `${(scored / all.length) * 100}%` : "0";
}

// ----------------------------------------------------------------------------- Sheet
let notesTimer = null;

function openSheet(playerNumber) {
  const p = state.tryout.players.find((x) => x.playerNumber === playerNumber);
  if (!p) return;
  state.current = playerNumber;
  const e = state.evals[playerNumber] || { scores: {}, tier: null, notes: "" };
  $("sheetSw").style.background = swatchColour(colourOf(p));
  $("sheetNum").textContent = codeOf(p);
  $("sheetPos").textContent = `· ${p.position}`;
  const tagEl = $("sheetTag");
  tagEl.hidden = !p.tag; tagEl.textContent = p.tag || "";
  // When this session uses the secondary jersey, remind the evaluator of the player's usual code.
  const alt = $("sheetAlt");
  alt.hidden = codeOf(p) === p.playerNumber;
  alt.textContent = `${colourOf(p)} ${p.number} this session · usually ${p.playerNumber} (${p.colour})`;
  $("sheet").classList.toggle("readonly", isReadOnly());

  const crit = $("criteria");
  crit.innerHTML = "";
  for (const c of criteriaFor(p.position)) {
    const row = el("div", { class: "crit" });
    const label = el("button", { class: "label", type: "button", "aria-label": `${c.label}. Tap for what to look for.` }, c.label);
    const help = el("div", { class: "help", hidden: "" }, c.help);
    label.addEventListener("click", () => { help.hidden = !help.hidden; });
    attachLongPress(label, () => c.help);
    const scores = el("div", { class: "scores", role: "group", "aria-label": c.label });
    for (let v = 1; v <= 5; v++) {
      const b = el("button", {
        class: "score", type: "button", "aria-pressed": String(e.scores[c.key] === v), "aria-label": `${c.label} ${v}: ${SCALE[v]}`,
        onclick: () => setScore(c.key, v),
      }, String(v));
      attachLongPress(b, () => `${v} — ${SCALE[v]}`);
      scores.append(b);
    }
    row.append(label, scores, help);
    crit.append(row);
  }

  const tiers = $("tiers");
  tiers.innerHTML = "";
  for (const [t, desc] of Object.entries(TIERS)) {
    const b = el("button", { class: "tierbtn", type: "button", "aria-pressed": String(e.tier === t), onclick: () => setTier(t) }, t, el("small", {}, desc.split(" — ")[0]));
    attachLongPress(b, () => desc);
    tiers.append(b);
  }

  const notes = $("notes");
  notes.value = e.notes || "";
  notes.disabled = isReadOnly();
  $("notesCount").textContent = String(notes.value.length);
  for (const id of ["saveNext", "saveClose", "clearBtn"]) $(id).disabled = isReadOnly();

  $("sheetBackdrop").hidden = false;
  $("sheet").hidden = false;
  $("sheet").scrollTop = 0;
  document.body.style.overflow = "hidden";
}

function closeSheet() {
  flushNotes();
  state.current = null;
  $("sheetBackdrop").hidden = true;
  $("sheet").hidden = true;
  document.body.style.overflow = "";
  hideTip();
}

function setScore(key, value) {
  if (isReadOnly() || !state.current) return;
  const e = state.evals[state.current] || { scores: {} };
  const scores = { ...(e.scores || {}) };
  if (scores[key] === value) delete scores[key]; else scores[key] = value; // tap again to clear
  saveLocal(state.current, { scores });
  for (const b of $("criteria").querySelectorAll(".score")) {
    const [lab, val] = [b.getAttribute("aria-label"), Number(b.textContent)];
    if (lab.startsWith(labelOf(key) + " ")) b.setAttribute("aria-pressed", String(scores[key] === val));
  }
}
function labelOf(key) { return criteriaFor("F").concat(criteriaFor("D"), criteriaFor("G")).find((c) => c.key === key)?.label || key; }

function setTier(t) {
  if (isReadOnly() || !state.current) return;
  const e = state.evals[state.current] || {};
  const tier = e.tier === t ? null : t;
  saveLocal(state.current, { tier });
  for (const b of $("tiers").children) b.setAttribute("aria-pressed", String(b.firstChild.textContent === tier));
}

function flushNotes() {
  clearTimeout(notesTimer);
  if (!state.current || isReadOnly()) return;
  const v = $("notes").value.slice(0, NOTES_MAX);
  const e = state.evals[state.current];
  if ((e?.notes || "") !== v) saveLocal(state.current, { notes: v });
}

$("notes").addEventListener("input", () => {
  $("notesCount").textContent = String($("notes").value.length);
  clearTimeout(notesTimer);
  notesTimer = setTimeout(flushNotes, 600);
});
$("notes").addEventListener("blur", flushNotes);

$("saveNext").addEventListener("click", () => {
  flushNotes();
  const list = filteredPlayers();
  const idx = list.findIndex((p) => p.playerNumber === state.current);
  const order = [...list.slice(idx + 1), ...list.slice(0, idx)];
  const next = order.find((p) => !hasContent(state.evals[p.playerNumber]));
  if (next) openSheet(next.playerNumber); else closeSheet();
});
$("saveClose").addEventListener("click", closeSheet);
$("sheetClose").addEventListener("click", closeSheet);
$("sheetBackdrop").addEventListener("click", closeSheet);
$("clearBtn").addEventListener("click", () => {
  if (!state.current || isReadOnly()) return;
  if (!confirm(`Clear all scores, tier and notes for ${state.current} in this session?`)) return;
  saveLocal(state.current, { scores: {}, tier: null, notes: "" });
  openSheet(state.current);
});

// Long-press help (500 ms). Also suppress the context menu on those buttons.
function attachLongPress(node, textFn) {
  let timer = null;
  const start = (ev) => { clearTimeout(timer); timer = setTimeout(() => showTip(node, textFn()), 500); };
  const stop = () => { clearTimeout(timer); hideTip(); };
  node.addEventListener("pointerdown", start);
  node.addEventListener("pointerup", stop);
  node.addEventListener("pointerleave", stop);
  node.addEventListener("pointercancel", stop);
  node.addEventListener("contextmenu", (ev) => ev.preventDefault());
}
function showTip(anchor, text) {
  const tip = $("tip");
  tip.textContent = text;
  tip.hidden = false;
  const r = anchor.getBoundingClientRect();
  const top = Math.max(8, r.top - tip.offsetHeight - 10);
  const left = Math.min(Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2), window.innerWidth - tip.offsetWidth - 8);
  tip.style.top = `${top}px`; tip.style.left = `${left}px`;
}
function hideTip() { $("tip").hidden = true; }

// ----------------------------------------------------------------------------- Sync status
let lastStatus = null;
subscribe((s) => {
  lastStatus = s;
  const btn = $("syncBtn"), txt = $("syncText");
  btn.classList.remove("green", "amber", "red");
  if (s.needsSignIn) { btn.classList.add("red"); txt.textContent = `Sign in again · ${s.queued} queued`; }
  else if (!s.online) { btn.classList.add("red"); txt.textContent = s.queued ? `Offline · ${s.queued} queued` : "Offline"; }
  else if (s.failed) { btn.classList.add("red"); txt.textContent = `${s.failed} rejected`; }
  else if (s.queued) { btn.classList.add("amber"); txt.textContent = s.flushing ? `Syncing ${s.queued}…` : `${s.queued} queued`; }
  else { btn.classList.add("green"); txt.textContent = "Synced"; }
});
$("syncBtn").addEventListener("click", async () => {
  if (lastStatus?.needsSignIn) { location.href = "index.html"; return; }
  if (lastStatus?.failed) {
    const failed = await failedEntries();
    const lines = failed.slice(0, 5).map((f) => `${f.variables.playerNumber}: ${f.lastError}`).join("\n");
    if (confirm(`${failed.length} score(s) were rejected by the server:\n\n${lines}\n\nRetry them now?`)) await retryFailed();
    return;
  }
  flush();
});
onSynced(() => { /* status listener already updates the dot */ });

// ----------------------------------------------------------------------------- Session + sign out
$("sessionSelect").addEventListener("change", async (ev) => {
  state.sessionId = ev.target.value;
  store.set(KEY_SESSION, state.sessionId);
  state.filter.colour = null; // colours differ between jersey sets
  await loadEvaluations();
  renderChips(); renderGrid(); renderProgress();
});

$("signOutBtn").addEventListener("click", () => {
  if (lastStatus && lastStatus.queued > 0) {
    $("soText").textContent = `${lastStatus.queued} score${lastStatus.queued === 1 ? "" : "s"} on this phone ${lastStatus.queued === 1 ? "has" : "have"} not reached the server yet.`;
    $("signOutModal").hidden = false;
    return;
  }
  doSignOut();
});
$("soCancel").addEventListener("click", () => { $("signOutModal").hidden = true; flush(); });
$("soConfirm").addEventListener("click", doSignOut);
function doSignOut() { signOut(); location.replace("index.html"); }

// ----------------------------------------------------------------------------- Boot
await loadTryout();
if (state.tryout) {
  state.sessionId = pickDefaultSession();
  if (state.sessionId) await loadEvaluations();
}
renderHeader(); renderBanner(); renderChips(); renderGrid(); renderProgress();
startSyncLoop();
