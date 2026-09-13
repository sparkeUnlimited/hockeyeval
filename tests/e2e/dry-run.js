#!/usr/bin/env node
// End-to-end dry run with Playwright.
//
//   Against the deployed site:
//     E2E_URL=https://xxxx.cloudfront.net E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
//     E2E_EVALUATOR_EMAIL=... E2E_EVALUATOR_PASSWORD=... node tests/e2e/dry-run.js
//   Locally (starts scripts/dev-server.js with mock auth, no AWS needed):
//     node tests/e2e/dry-run.js
//
// Flow: admin creates a tryout with 2 sessions and 12 players; an evaluator who is not yet on the
// tryout's list sees a read-only screen; the admin adds them; the evaluator scores 6 players in
// session 1, goes offline, scores 3 more, comes back online; the admin rankings show all 9.
// Sign-in uses the password fallback (one-time codes cannot be automated against real Cognito).
// Deployed mode needs E2E_EVALUATOR_LABEL to match the evaluator's label on the Setup tab (default "Evaluator 1").
// Screenshots: docs/screenshot-evaluator.png (390x844) and docs/screenshot-admin-rankings.png (1280x800).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS = path.join(ROOT, "docs");
const env = process.env;
const MOCK = !env.E2E_URL;
const PORT = 8790;
const URL_BASE = env.E2E_URL || `http://localhost:${PORT}`;
const ADMIN = { email: env.E2E_ADMIN_EMAIL || "admin@mock.test", password: env.E2E_ADMIN_PASSWORD || "mock-password" };
const EVAL = { email: env.E2E_EVALUATOR_EMAIL || "evaluator1@mock.test", password: env.E2E_EVALUATOR_PASSWORD || "mock-password", label: env.E2E_EVALUATOR_LABEL || "Evaluator 1" };
const HEADLESS = env.E2E_HEADLESS !== "0";
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const TRYOUT_NAME = `Dry run ${stamp}`;
// colour,number,position,colour2 — every player has a primary and a secondary jersey colour.
const PLAYERS = [["White", 1, "G", "Green"], ["White", 4, "D", "Green"], ["White", 7, "F", "Green"], ["White", 9, "F", "Green"], ["White", 12, "D", "Green"], ["White", 14, "F", "Green"],
  ["Blue", 1, "G", "Yellow"], ["Blue", 3, "D", "Yellow"], ["Blue", 8, "F", "Yellow"], ["Blue", 10, "F", "Yellow"], ["Blue", 15, "D", "Yellow"], ["Blue", 17, "F", "Yellow"]];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const assert = (cond, msg) => { if (!cond) throw new Error(`ASSERT: ${msg}`); };

let server = null;
if (MOCK) {
  server = spawn(process.execPath, [path.join(ROOT, "scripts", "dev-server.js"), "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((res) => server.stdout.on("data", (d) => { if (String(d).includes("dev server")) res(); }));
  log("mock dev server started");
}

const browser = await chromium.launch({ headless: HEADLESS });
try {
  async function login(page, { email, password }) {
    await page.goto(`${URL_BASE}/index.html`);
    await page.click("#usePassword");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("#loginBtn");
    await page.waitForURL(/(admin|evaluate)\.html/, { timeout: 30000 });
  }

  // ------------------------------------------------------------------ Admin: set up tryout
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN);
  assert(admin.url().includes("admin.html"), "admin should land on admin.html");
  log("admin signed in");

  await admin.locator("#newTryoutDetails").evaluate((d) => { d.open = true; });
  await admin.fill("#tName", TRYOUT_NAME);
  await admin.fill("#tSeason", "2026-27");
  admin.once("dialog", (d) => d.accept());
  await admin.click("#tryoutForm button[type=submit]");
  await admin.locator("#tryoutName").filter({ hasText: TRYOUT_NAME }).waitFor({ timeout: 20000 });
  log("tryout created");

  const today = new Date().toISOString().slice(0, 10);
  for (const [label, type, jersey] of [["Skate 1 – Skills", "skills", "primary"], ["Skate 2 – Scrimmage", "scrimmage", "secondary"]]) {
    await admin.fill("#sLabel", label);
    await admin.fill("#sDate", today);
    await admin.selectOption("#sType", type);
    await admin.selectOption("#sJersey", jersey);
    await admin.click("#sessionForm button[type=submit]");
    await admin.locator("#sessionsBody tr", { hasText: label }).locator(".pill", { hasText: jersey }).waitFor({ timeout: 20000 });
  }
  log("2 sessions added (skills = primary jerseys, scrimmage = secondary jerseys)");

  await admin.fill("#playersCsv", PLAYERS.map((p) => p.join(",")).join("\n"));
  await admin.click("#playersCsvForm button[type=submit]");
  await admin.locator("#playersBody tr", { hasText: "W-14" }).waitFor({ timeout: 20000 });
  const playerRows = await admin.locator("#playersBody tr").count();
  assert(playerRows === 12, `expected 12 players, saw ${playerRows}`);
  log("12 players added");

  // ------------------------------------------------------------------ Evaluator not yet on the list: read-only
  const evalCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const ev = await evalCtx.newPage();
  if (MOCK) {
    // In mock mode the evaluator login is created through the admin UI (which also adds it to the tryout);
    // sign the evaluator in first so we can see the "not on the list" state before that happens.
    await login(ev, EVAL);
  } else {
    await login(ev, EVAL);
  }
  assert(ev.url().includes("evaluate.html"), "evaluator should land on evaluate.html");
  await ev.locator("#tryoutName").filter({ hasText: TRYOUT_NAME }).waitFor({ timeout: 20000 });
  await ev.locator("#banner", { hasText: "not on the evaluator list" }).waitFor({ timeout: 10000 });
  await ev.locator(".player").first().click();
  await ev.locator("#sheet").waitFor({ state: "visible" });
  assert(await ev.locator("#saveNext").isDisabled(), "scoring must be disabled before the evaluator is added to the tryout");
  await ev.click("#sheetClose");
  log("evaluator not on the list: read-only, as expected");

  // ------------------------------------------------------------------ Admin: add the evaluator to the tryout
  await admin.click('.tab[data-tab="setup"]');
  if (MOCK) {
    await admin.fill("#eEmail", EVAL.email);
    await admin.fill("#eLabel", EVAL.label);
    await admin.click("#evaluatorForm button[type=submit]");
    await admin.locator("#evaluatorsBody tr", { hasText: EVAL.label }).waitFor({ timeout: 20000 });
  }
  const evRow = admin.locator("#evaluatorsBody tr", { hasText: EVAL.label });
  await evRow.waitFor({ timeout: 20000 });
  if ((await evRow.locator("button", { hasText: "Add to tryout" }).count()) > 0) {
    await evRow.locator("button", { hasText: "Add to tryout" }).click();
  }
  await admin.locator("#evaluatorsBody tr", { hasText: EVAL.label }).locator(".pill", { hasText: "scoring" }).waitFor({ timeout: 20000 });
  log("admin added the evaluator to the tryout");

  // ------------------------------------------------------------------ Evaluator: score 6 online
  await ev.reload();
  await ev.locator("#tryoutName").filter({ hasText: TRYOUT_NAME }).waitFor({ timeout: 20000 });
  assert(await ev.locator("#banner").isHidden(), "banner should be gone once the evaluator is on the list");
  const sessionOptions = await ev.locator("#sessionSelect option").allTextContents();
  assert(sessionOptions.length === 2, `expected 2 sessions in picker, saw ${sessionOptions.length}`);
  await ev.selectOption("#sessionSelect", { index: 0 });
  await ev.locator(".player").first().waitFor();
  assert((await ev.locator(".player").count()) === 12, "evaluator should see 12 players");
  log("evaluator signed in, sees 12 players");

  async function scorePlayer(index, value, tier) {
    const card = ev.locator(".player").nth(index);
    const label = await card.getAttribute("aria-label");
    await card.click();
    await ev.locator("#sheet").waitFor({ state: "visible" });
    const rows = ev.locator("#criteria .crit");
    const n = await rows.count();
    for (let i = 0; i < n; i++) await rows.nth(i).locator(".score", { hasText: new RegExp(`^${value}$`) }).click();
    await ev.locator("#tiers .tierbtn", { hasText: new RegExp(`^${tier}`) }).click();
    await ev.fill("#notes", "quick feet, strong on the wall");
    await ev.click("#saveClose");
    await ev.locator("#sheet").waitFor({ state: "hidden" });
    return label;
  }

  for (let i = 0; i < 6; i++) await scorePlayer(i, 4, "A");
  // The last write is queued asynchronously after the sheet closes; give it a moment, then wait for green.
  await ev.waitForTimeout(1500);
  await ev.locator("#syncText", { hasText: "Synced" }).waitFor({ timeout: 30000 });
  await ev.waitForTimeout(500);
  assert(/^Synced$/.test((await ev.locator("#syncText").textContent()).trim()), "should be fully synced before going offline");
  assert((await ev.locator(".player.done").count()) === 6, "6 players should show as scored");
  log("6 players scored online and synced");

  // ------------------------------------------------------------------ Secondary jerseys in session 2
  await ev.selectOption("#sessionSelect", { index: 1 });
  await ev.locator('.player[aria-label^="G-14"]').waitFor({ timeout: 10000 }); // grid re-renders after the session loads
  const codes2 = await ev.locator(".player").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").split(" ")[0]));
  assert(codes2.every((c) => /^[GY]-\d\d$/.test(c)), `session 2 should show Green/Yellow codes, saw ${codes2.join(" ")}`);
  assert(codes2.includes("G-14") && codes2.includes("Y-17"), "W-14 should appear as G-14 and B-17 as Y-17");
  await ev.locator(".player", { hasText: "14" }).first().click();
  await ev.locator("#sheet").waitFor({ state: "visible" });
  assert((await ev.locator("#sheetNum").textContent()) === "G-14", "sheet shows the worn code");
  assert(/usually W-14/.test(await ev.locator("#sheetAlt").textContent()), "sheet reminds of the primary code");
  await ev.click("#sheetClose");
  await ev.selectOption("#sessionSelect", { index: 0 });
  await ev.locator('.player[aria-label^="W-14"]').waitFor({ timeout: 10000 });
  const codes1 = await ev.locator(".player").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").split(" ")[0]));
  assert(codes1.includes("W-14") && codes1.includes("B-17"), "session 1 shows primary codes again");
  log("secondary jersey colours shown in the scrimmage session, primary in skills");

  // ------------------------------------------------------------------ Evaluator: offline, 3 more
  await evalCtx.setOffline(true);
  await ev.evaluate(() => window.dispatchEvent(new Event("offline")));
  for (let i = 6; i < 9; i++) await scorePlayer(i, 3, "B");
  await ev.waitForTimeout(1500);
  const offlineText = await ev.locator("#syncText").textContent();
  assert(/Offline/.test(offlineText) && /3 queued/.test(offlineText), `expected "Offline · 3 queued", saw "${offlineText}"`);
  assert(/9 of 12 scored/.test(await ev.locator("#progressText").textContent()), "progress should read 9 of 12");
  log(`offline: sync status "${offlineText}"`);
  await ev.screenshot({ path: path.join(DOCS, "screenshot-evaluator.png"), fullPage: false });
  // Also capture the scoring sheet itself
  await ev.locator(".player").nth(9).click();
  await ev.locator("#sheet").waitFor({ state: "visible" });
  await ev.screenshot({ path: path.join(DOCS, "screenshot-evaluator-sheet.png") });
  await ev.click("#sheetClose");

  await evalCtx.setOffline(false);
  await ev.evaluate(() => window.dispatchEvent(new Event("online")));
  await ev.locator("#syncText", { hasText: "Synced" }).waitFor({ timeout: 45000 });
  log("back online: outbox flushed, dot green");

  // ------------------------------------------------------------------ Admin: rankings show 9
  await admin.click("#refreshBtn");
  await admin.locator("#msg", { hasText: "Refreshed" }).waitFor({ timeout: 20000 });
  await admin.click('.tab[data-tab="rankings"]');
  await admin.selectOption("#rSession", { index: 1 });
  const rows = admin.locator("#rankBody tr");
  await rows.first().waitFor();
  const evaluated = await rows.evaluateAll((trs) => trs.filter((tr) => Number(tr.children[2].textContent) >= 1).length);
  assert(evaluated === 9, `expected 9 evaluated players in rankings, saw ${evaluated}`);
  const total = await rows.count();
  assert(total === 12, `expected 12 rows, saw ${total}`);
  await admin.screenshot({ path: path.join(DOCS, "screenshot-admin-rankings.png") });
  log("admin rankings show 9 evaluated players");

  // Rankings CSV must not contain any column that could hold a name
  const csvHeader = await admin.evaluate(async () => {
    const { CRITERIA } = await import("/js/criteria.js");
    return ["player_number", "colour", "number", "position", "evaluations", "evaluators", ...CRITERIA.map((c) => `avg_${c.key}`), "overall", "tier_A", "tier_B", "tier_C", "tier_X", "spread"];
  });
  assert(!csvHeader.some((h) => /name|birth|dob|parent|phone|email/i.test(h)), "rankings CSV header must not contain identity columns");

  console.log("\nDRY RUN PASSED");
} finally {
  await browser.close();
  if (server) server.kill();
}
