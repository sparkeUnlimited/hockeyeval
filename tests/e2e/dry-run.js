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
/** Wait for the admin status line to contain `text`; on timeout, report what it actually says. */
async function expectMsg(page, text, timeout = 20000) {
  try { await page.locator("#msg", { hasText: text }).waitFor({ timeout }); }
  catch (e) { throw new Error(`expected message containing "${text}" but #msg says: "${(await page.locator("#msg").textContent()).trim()}" (visible: ${await page.locator("#msg").isVisible()})`); }
}

let server = null;
if (MOCK) {
  server = spawn(process.execPath, [path.join(ROOT, "scripts", "dev-server.js"), "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((res, rej) => {
    server.stdout.on("data", (d) => { if (String(d).includes("dev server")) res(); });
    server.on("exit", (code) => rej(new Error(`dev server exited with code ${code} (is port ${PORT} free?)`)));
  });
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
  admin.on("dialog", (d) => d.accept()); // accept every confirm() the admin page raises
  await login(admin, ADMIN);
  assert(admin.url().includes("admin.html"), "admin should land on admin.html");
  log("admin signed in");

  await admin.locator("#newTryoutDetails").evaluate((d) => { d.open = true; });
  await admin.fill("#tName", TRYOUT_NAME);
  await admin.fill("#tSeason", "2026-27");
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
    await admin.locator("#sessionsBody tr").filter({ has: admin.locator(`input[value="${label}"]`) }).locator(".pill", { hasText: jersey }).waitFor({ timeout: 20000 });
  }
  log("2 sessions added (skills = primary jerseys, scrimmage = secondary jerseys)");

  // Move the scrimmage to a later date, in place
  const later = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const scrimRow = admin.locator("#sessionsBody tr").filter({ has: admin.locator('input[value="Skate 2 – Scrimmage"]') });
  await scrimRow.locator('input[type=date]').fill(later);
  await scrimRow.locator('input[type=date]').dispatchEvent("change");
  await admin.locator("#msg", { hasText: `now on ${later}` }).waitFor({ timeout: 20000 });
  assert((await admin.locator("#sessionsBody tr").nth(1).locator("input[type=date]").inputValue()) === later, "date change persisted and row still second (later date)");
  log(`scrimmage moved to ${later}`);

  await admin.fill("#playersCsv", PLAYERS.map((p) => p.join(",")).join("\n"));
  await admin.click("#playersCsvForm button[type=submit]");
  await admin.locator("#playersBody tr", { hasText: "W-14" }).waitFor({ timeout: 20000 });
  const playerRows = await admin.locator("#playersBody tr").count();
  assert(playerRows === 12, `expected 12 players, saw ${playerRows}`);
  log("12 players added");

  // Setup cards fold from their heading and remember it
  await admin.click("#playersCard > h2");
  assert(await admin.locator("#playersBody").isHidden(), "players table hidden when the card is collapsed");
  assert(/12 active/.test(await admin.locator("#playersCard > h2 .count").textContent()), "collapsed card shows a count");
  await admin.reload();
  await admin.locator("#playersCard.collapsed").waitFor({ timeout: 20000 });
  await admin.click("#playersCard > h2");
  await admin.locator("#playersBody tr").first().waitFor();
  log("players card collapses, survives reload, expands again");

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

  // ------------------------------------------------------------------ Admin: add the evaluator to the tryout (Evaluators tab)
  await admin.click('.tab[data-tab="evaluators"]');
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
  await admin.click('.tab[data-tab="setup"]');
  log("admin added the evaluator to the tryout");

  // ------------------------------------------------------------------ Admin: edit position, add one via dropdowns, delete
  const rowB03 = admin.locator('#playersBody tr[data-player="B-03"]');
  await rowB03.locator("select").last().selectOption("F"); // position select is the last select in the row
  await expectMsg(admin, "B-03 updated");
  assert((await admin.locator('#playersBody tr[data-player="B-03"] select').last().inputValue()) === "F", "position change persisted");
  await rowB03.locator('select[aria-label^="Secondary colour"]').selectOption("Orange");
  await expectMsg(admin, "B-03 updated");
  assert((await rowB03.locator('select[aria-label^="Secondary colour"]').inputValue()) === "Orange", "secondary colour persisted (primary untouched)");
  // add-one form defaults: White / Red, then delete that player again (no scores yet)
  assert((await admin.locator("#teamColour").inputValue()) === "", "new team defaults to no colour (default jerseys)");
  assert((await admin.locator("#pColour").inputValue()) === "White", "primary defaults to White");
  assert((await admin.locator("#pColour2").inputValue()) === "Red", "secondary defaults to Red");
  await admin.fill("#pNumber", "99");
  await admin.selectOption("#pPosition", "D");
  await admin.click("#playerForm button[type=submit]");
  await admin.locator('#playersBody tr[data-player="W-99"]').waitFor({ timeout: 20000 });
  await admin.locator('#playersBody tr[data-player="W-99"] button', { hasText: "Delete" }).click();
  await expectMsg(admin, "W-99 deleted");
  assert((await admin.locator("#playersBody tr").count()) === 12, "back to 12 players after delete");
  log("position edited, secondary colour edited, player added with default colours and deleted");

  // Tag W-09 as AA and mark W-12 absent for session 1
  await admin.locator('#playersBody tr[data-player="W-09"] input[type=checkbox]').check();
  await expectMsg(admin, "W-09 updated");
  await admin.selectOption("#aSession", { index: 0 });
  await admin.locator('#attendGrid label[data-attend="W-12"] input[type=checkbox]').uncheck();
  await expectMsg(admin, "W-12 marked absent");
  assert(/1 absent/.test(await admin.locator("#aSummary").textContent()), "attendance summary shows 1 absent");
  log("W-09 tagged AA; W-12 marked absent for session 1");

  // Skills night: all defence in Red, forwards stay White; one goalie set individually to Green
  await admin.selectOption("#bulkWho", "D");
  await admin.selectOption("#bulkColour", "Red");
  await admin.click("#bulkApply");
  await expectMsg(admin, "Defence set to Red");
  await admin.locator('#attendGrid label[data-attend="W-01"] select').selectOption("Green");
  await expectMsg(admin, "Jersey colours updated");
  assert(/4 colours set/.test(await admin.locator("#aSummary").textContent()), "summary counts per-player colours (3 D + 1 G; B-03 is a forward now)");
  assert(await admin.locator("#aClash").isHidden(), "no code clashes");
  log("session 1 jerseys: defence Red, W-01 Green, forwards default White");

  // Teams: Team 1 (6 players) and Team 2 (5 players); B-17 on neither. Scrimmage: Team 1 in Red vs Team 2 in White.
  for (const [name, colour, members] of [["Team 1", "Red", ["W-01", "W-04", "W-07", "B-08", "B-10", "B-03"]], ["Team 2", "White", ["B-01", "W-09", "W-12", "W-14", "B-15"]]]) {
    await admin.fill("#teamName", name);
    await admin.selectOption("#teamColour", colour);
    await admin.click("#teamForm button[type=submit]");
    const det = admin.locator(`#teamsList details.team`).filter({ has: admin.locator(`input[value="${name}"]`) });
    await det.waitFor({ timeout: 20000 });
    await det.evaluate((d) => { d.open = true; });
    for (let i = 0; i < members.length; i++) {
      await det.locator(`label[data-roster="${members[i]}"] input[type=checkbox]`).check();
      await expectMsg(admin, `${name}: ${i + 1} players.`); // exact count: each tick re-renders the tables when it lands
    }
  }
  // Rename Team 2 -> Team B and back (inline name field), then check delete works on a throwaway team
  const t2 = admin.locator("#teamsList details.team").filter({ has: admin.locator('input[value="Team 2"]') });
  await t2.locator('input[aria-label^="Name of"]').fill("Team B");
  await t2.locator('input[aria-label^="Name of"]').dispatchEvent("change");
  await expectMsg(admin, "Team renamed to Team B");
  const tB = admin.locator("#teamsList details.team").filter({ has: admin.locator('input[value="Team B"]') });
  await tB.locator('input[aria-label^="Name of"]').fill("Team 2");
  await tB.locator('input[aria-label^="Name of"]').dispatchEvent("change");
  await expectMsg(admin, "Team renamed to Team 2");
  await admin.fill("#teamName", "Scratch");
  await admin.click("#teamForm button[type=submit]");
  const scratch = admin.locator("#teamsList details.team").filter({ has: admin.locator('input[value="Scratch"]') });
  await scratch.waitFor({ timeout: 20000 });
  await scratch.locator("button", { hasText: "Delete team" }).click();
  await expectMsg(admin, "Scratch deleted");
  assert((await admin.locator("#teamsList details.team").count()) === 2, "back to 2 teams after delete");
  log("team renamed and renamed back; throwaway team deleted");

  // Roster picker shows number + position only (no colours); members are outlined
  const t1 = admin.locator("#teamsList details.team").filter({ has: admin.locator('input[value="Team 1"]') });
  assert((await t1.locator('label[data-roster="B-08"]').textContent()).trim() === "8F", "roster shows number and position only");
  assert(await t1.locator('label[data-roster="B-08"].on').count() === 1, "member label is marked");
  // A stale per-player colour on the scrimmage (W-14 -> Yellow) must not survive a team assignment
  await admin.selectOption("#aSession", { index: 1 });
  await admin.locator('#attendGrid label[data-attend="W-14"] select').selectOption("Yellow");
  await expectMsg(admin, "Jersey colours updated");
  const scrim = admin.locator("#sessionsBody tr").filter({ has: admin.locator('input[value="Skate 2 – Scrimmage"]') });
  await scrim.locator('select[aria-label^="Add team"]').selectOption({ label: "Team 1" });
  assert((await scrim.locator('select[aria-label^="Colour for the team"]').inputValue()) === "Red", "session colour pre-filled from the team");
  await scrim.locator("button", { hasText: "+ team" }).click();
  await expectMsg(admin, "Team 1 in Red");
  await scrim.locator('select[aria-label^="Add team"]').selectOption({ label: "Team 2" });
  assert((await scrim.locator('select[aria-label^="Colour for the team"]').inputValue()) === "White", "Team 2 pre-fills White");
  await scrim.locator("button", { hasText: "+ team" }).click();
  await expectMsg(admin, "Team 1 in Red vs Team 2 in White");
  assert((await scrim.locator("button", { hasText: "+ team" }).count()) === 0, "no third team can be added: full ice, two teams");
  // Skills session: put Team 1 on as a group with own colours (F/D bulk colours stay); others not dressed
  const skillsRow = admin.locator("#sessionsBody tr").filter({ has: admin.locator('input[value="Skate 1 – Skills"]') });
  await skillsRow.locator('select[aria-label^="Add team"]').selectOption({ label: "Team 1" });
  assert((await skillsRow.locator('select[aria-label^="Colour for the team"]').inputValue()) === "", "skills group defaults to the players' default jerseys");
  await skillsRow.locator("button", { hasText: "+ group" }).click();
  await expectMsg(admin, "Skate 1 – Skills: Team 1.");
  assert((await skillsRow.locator("button", { hasText: "+ group" }).count()) === 0, "skills session takes one group: picker gone");
  await admin.selectOption("#aSession", { index: 0 });
  assert(/6 not dressed/.test(await admin.locator("#aSummary").textContent()), `6 of 12 not in the skills group: ${await admin.locator("#aSummary").textContent()}`);
  assert(/W-07/.test(await admin.locator('#attendGrid label[data-attend="W-07"]').textContent()), "skills group in default jerseys: W-07 stays White even though Team 1 is Red");
  // and take the group off again so the rest of the run sees everyone
  await skillsRow.locator('button[aria-label^="Remove Team 1"]').click();
  await expectMsg(admin, "no teams, everyone plays");
  assert((await skillsRow.locator("button", { hasText: "+ group" }).count()) === 1, "picker is back after removing the group");
  log("skills session can carry a group in default jerseys; removed again");
  await admin.selectOption("#aSession", { index: 1 });
  assert(/1 not dressed/.test(await admin.locator("#aSummary").textContent()), "B-17 is not dressed for the scrimmage");
  assert(/team colours/.test(await admin.locator("#aSummary").textContent()), `stale per-player colour cleared by the team assignment: ${await admin.locator("#aSummary").textContent()}`);
  log("teams created; scrimmage = Team 1 (Red) vs Team 2 (White); B-17 not dressed");

  // Primary colour change before any scores: B-10 (on Team 1) -> Green -> G-10, roster follows
  const rowB10 = admin.locator('#playersBody tr[data-player="B-10"]');
  await rowB10.locator('select[aria-label^="Primary colour"]').selectOption("Green");
  await expectMsg(admin, "B-10 is now G-10.");
  await admin.locator('#playersBody tr[data-player="G-10"]').waitFor({ timeout: 20000 });
  assert((await admin.locator('#playersBody tr[data-player="B-10"]').count()) === 0, "old code gone");
  const t1b = admin.locator("#teamsList details.team").filter({ has: admin.locator('input[value="Team 1"]') });
  assert(await t1b.locator('label[data-roster="G-10"] input').isChecked(), "Team 1 roster now lists G-10");
  log("B-10 primary colour changed to Green -> G-10; team roster carried over");

  // ------------------------------------------------------------------ Evaluator: score 6 online
  await ev.reload();
  await ev.locator("#tryoutName").filter({ hasText: TRYOUT_NAME }).waitFor({ timeout: 20000 });
  assert(await ev.locator("#banner").isHidden(), "banner should be gone once the evaluator is on the list");
  const sessionOptions = await ev.locator("#sessionSelect option").allTextContents();
  assert(sessionOptions.length === 2, `expected 2 sessions in picker, saw ${sessionOptions.length}`);
  assert(sessionOptions[1].includes(later), "evaluator's picker shows the moved date");
  await ev.selectOption("#sessionSelect", { index: 0 });
  await ev.locator(".player").first().waitFor();
  assert((await ev.locator(".player").count()) === 11, "evaluator should see 11 players (W-12 absent)");
  assert((await ev.locator('.player[aria-label^="W-12"]').count()) === 0, "absent player hidden in session 1");
  assert((await ev.locator('.player[aria-label^="W-09"] .tag').textContent()) === "AA", "AA badge on the evaluator card");
  const codes1a = await ev.locator(".player").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").split(" ")[0]));
  // W-04 and B-15 are defence -> Red; B-03 became a forward earlier so stays Blue; W-01 set to Green; forwards default White
  assert(codes1a.includes("R-04") && codes1a.includes("R-15") && codes1a.includes("B-03") && codes1a.includes("G-01") && codes1a.includes("W-07"), `per-session colours reach the evaluator: ${codes1a.join(" ")}`);
  const chips = await ev.locator("#chips .chip").allTextContents();
  assert(chips.includes("Red") && chips.includes("Green") && chips.includes("White"), `filter chips follow the session colours: ${chips.join(",")}`);
  assert(/of 11 scored/.test(await ev.locator("#progressText").textContent()) && /1 absent/.test(await ev.locator("#progressText").textContent()), "progress excludes the absent player");
  log("evaluator signed in, sees 11 players, AA badge visible, absent player hidden");

  // Colour groups fold from their header and stay folded across a reload
  const groupsBefore = await ev.locator(".group").allTextContents();
  assert(groupsBefore.length >= 3, `grid grouped by colour: ${groupsBefore.join(" | ")}`);
  await ev.locator('.group[data-group="White"]').click();
  assert((await ev.locator('.player[aria-label^="W-"]').count()) === 0, "White cards hidden when the group is folded");
  assert((await ev.locator('.player[aria-label^="R-"]').count()) > 0, "other groups still visible");
  await ev.reload();
  await ev.locator('.group[data-group="White"][aria-expanded="false"]').waitFor({ timeout: 20000 });
  await ev.locator('.group[data-group="White"]').click();
  await ev.locator('.player[aria-label^="W-07"]').waitFor({ timeout: 10000 });
  log("evaluator colour groups fold, survive reload, expand again");

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
  await ev.locator('.player[aria-label^="W-14"]').waitFor({ timeout: 10000 }); // grid re-renders after the session loads
  const codes2 = await ev.locator(".player").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").split(" ")[0]));
  assert(codes2.length === 11, `11 players dressed for the scrimmage, saw ${codes2.length}: ${codes2.join(" ")}`);
  assert(!codes2.some((c) => c.endsWith("-17")), "B-17 (on no team) is hidden in the scrimmage");
  assert(codes2.includes("R-04") && codes2.includes("R-03") && codes2.includes("R-08"), `Team 1 wears Red: ${codes2.join(" ")}`);
  assert(codes2.includes("W-14") && codes2.includes("W-01") && codes2.includes("W-15") && codes2.includes("W-12"), `Team 2 wears White: ${codes2.join(" ")}`);
  const chips2 = await ev.locator("#chips .chip").allTextContents();
  assert(chips2.some((c) => /Red · Team 1/.test(c)) && chips2.some((c) => /White · Team 2/.test(c)), `chips name the teams: ${chips2.join(",")}`);
  assert(/not dressed/.test(await ev.locator("#progressText").textContent()), "progress mentions not-dressed players");
  await ev.locator('.player[aria-label^="W-14"]').click();
  await ev.locator("#sheet").waitFor({ state: "visible" });
  assert((await ev.locator("#sheetNum").textContent()) === "W-14", "sheet shows the worn code");
  assert(/Team 2/.test(await ev.locator("#sheetAlt").textContent()), "sheet names the team");
  await ev.click("#sheetClose");
  await ev.selectOption("#sessionSelect", { index: 0 });
  await ev.locator('.player[aria-label^="W-14"]').waitFor({ timeout: 10000 });
  const codes1 = await ev.locator(".player").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label").split(" ")[0]));
  assert(codes1.includes("W-14") && codes1.includes("R-04"), "session 1 shows its own colours again");
  log("secondary jersey colours shown in the scrimmage session, primary in skills");

  // ------------------------------------------------------------------ Evaluator: offline, 3 more
  await evalCtx.setOffline(true);
  await ev.evaluate(() => window.dispatchEvent(new Event("offline")));
  for (let i = 6; i < 9; i++) await scorePlayer(i, 3, "B");
  await ev.waitForTimeout(1500);
  const offlineText = await ev.locator("#syncText").textContent();
  assert(/Offline/.test(offlineText) && /3 queued/.test(offlineText), `expected "Offline · 3 queued", saw "${offlineText}"`);
  assert(/9 of 11 scored/.test(await ev.locator("#progressText").textContent()), "progress should read 9 of 11");
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

  // My rankings: the evaluator's own 9 scored players, best first, own scores only
  await ev.click("#myRankBtn");
  await ev.locator("#myRank").waitFor({ state: "visible" });
  await ev.locator("#myRankRows tr").first().waitFor({ timeout: 20000 });
  const myCount = await ev.locator("#myRankRows tr").count();
  assert(myCount === 9, `my rankings list the 9 players I scored, saw ${myCount}`);
  const firstAvg = Number(await ev.locator("#myRankRows tr").first().locator("td").nth(4).textContent());
  const lastAvg = Number(await ev.locator("#myRankRows tr").last().locator("td").nth(4).textContent());
  assert(firstAvg >= lastAvg, "sorted best first");
  assert(/9 players scored · 9 evaluations/.test(await ev.locator("#myRankSummary").textContent()), `summary: ${await ev.locator("#myRankSummary").textContent()}`);
  await ev.click('[data-mypos="D"]');
  assert((await ev.locator("#myRankRows tr").count()) < 9, "position filter narrows the list");
  await ev.click("#myRankDone");
  await ev.locator("#myRank").waitFor({ state: "hidden" });
  log("evaluator's own rankings shown and filtered");

  // ------------------------------------------------------------------ Admin scores as an evaluator too
  await admin.click('.tab[data-tab="evaluators"]');
  await admin.fill("#meLabel", "Convenor");
  await admin.click("#meForm button[type=submit]");
  await expectMsg(admin, "You can now score this tryout");
  await admin.locator("#meSet:not([hidden])").waitFor({ timeout: 20000 });
  assert((await admin.locator('#evaluatorsBody tr[data-evaluator]').filter({ hasText: "Convenor" }).locator("button", { hasText: "Delete login" }).count()) === 0, "convenor's own row has no Delete login");
  const adminScore = await adminCtx.newPage();
  await adminScore.goto(`${URL_BASE}/evaluate.html`);
  await adminScore.locator("#tryoutName").filter({ hasText: TRYOUT_NAME }).waitFor({ timeout: 20000 });
  assert(await adminScore.locator("#dashboardLink").isVisible(), "convenor sees the Dashboard link on the scoring screen");
  await adminScore.selectOption("#sessionSelect", { index: 0 });
  await adminScore.locator(".player").first().waitFor();
  await adminScore.locator(".player").first().click();
  await adminScore.locator("#sheet").waitFor({ state: "visible" });
  await adminScore.locator("#criteria .crit").first().locator(".score", { hasText: /^5$/ }).click();
  await adminScore.click("#saveClose");
  await adminScore.locator("#syncText", { hasText: "Synced" }).waitFor({ timeout: 30000 });
  await adminScore.close();
  await admin.click('.tab[data-tab="setup"]');
  log("convenor added as an evaluator and scored a player");

  // ------------------------------------------------------------------ Admin: delete is refused once a player has scores
  await admin.click("#refreshBtn");
  await expectMsg(admin, "Refreshed");
  await admin.locator('#playersBody tr[data-player="B-01"] button', { hasText: "Delete" }).click();
  await expectMsg(admin, "already has scores");
  await admin.locator('#playersBody tr[data-player="B-01"] select[aria-label^="Primary colour"]').selectOption("Green");
  await expectMsg(admin, "code cannot change");
  log("delete and primary-colour change refused for a player with scores");

  // ------------------------------------------------------------------ Admin: rankings show 9
  await admin.click("#refreshBtn");
  await expectMsg(admin, "Refreshed");
  await admin.click('.tab[data-tab="rankings"]');
  await admin.selectOption("#rSession", { index: 1 });
  const rows = admin.locator("#rankBody tr");
  await rows.first().waitFor();
  const evaluated = await rows.evaluateAll((trs) => trs.filter((tr) => !tr.classList.contains("group-row") && Number(tr.children[4].textContent) >= 1).length);
  assert(evaluated === 9, `expected 9 evaluated players in rankings, saw ${evaluated}`);
  const total = await admin.locator("#rankBody tr:not(.group-row)").count();
  assert(total === 12, `expected 12 rows, saw ${total}`);
  const w12 = admin.locator('#rankBody tr', { hasText: "W-12" });
  assert((await w12.locator("td").nth(3).textContent()) === "1/2", "W-12 attended 1 of 2 sessions (absent in 1, on Team 2 in 2)");
  const b17 = admin.locator('#rankBody tr', { hasText: "B-17" });
  assert((await b17.locator("td").nth(3).textContent()) === "1/2", "B-17 played 1 of 2 (not dressed for the scrimmage)");

  // Cut line: with the defaults (2 evals, 3 sessions) nobody qualifies in this short run; loosen to 1/1 and release 2 F
  assert(/12 not enough information/.test(await admin.locator("#cutSummary").textContent()), `defaults exclude everyone in a 2-session run: ${await admin.locator("#cutSummary").textContent()}`);
  await admin.fill("#cutMinEvals", "1"); await admin.fill("#cutMinSessions", "1"); await admin.fill("#cutF", "2"); await admin.fill("#cutD", "0");
  await admin.selectOption("#rPosition", "F");
  // Four forwards tie at 4.00 and one sits at 3.00: releasing 2 would split the tie, so only the 3.00 is released and the tie is bubble
  const releaseRows = admin.locator("#rankBody tr.release");
  assert((await releaseRows.count()) === 1, `1 forward in the release zone (tie not split), saw ${await releaseRows.count()}`);
  assert(/W-07/.test(await releaseRows.first().textContent()), "the 3.00 forward is the one released");
  assert((await admin.locator("#rankBody tr.cut-line").count()) === 1, "a line is drawn above the release zone when sorted by Overall for one position");
  assert(/1 in the release zone/.test(await admin.locator("#cutSummary").textContent()) && /4 tied at the line/.test(await admin.locator("#cutSummary").textContent()), `summary explains the tie: ${await admin.locator("#cutSummary").textContent()}`);
  assert((await admin.locator("#rankBody tr .pill.bubble").count()) === 4, "the four tied forwards are bubble");
  assert((await admin.locator("#rankBody tr.group-row").count()) === 1, "unscored forwards are grouped as not enough information");
  await admin.screenshot({ path: path.join(DOCS, "screenshot-admin-cut-line.png") });
  await admin.selectOption("#rPosition", "all");
  await admin.fill("#cutMinEvals", "2"); await admin.fill("#cutMinSessions", "3"); await admin.fill("#cutF", "8"); await admin.fill("#cutD", "3");
  await admin.check("#rTagged");
  const aaRows = admin.locator("#rankBody tr:not(.group-row)");
  assert((await aaRows.count()) === 1 && /W-09/.test(await aaRows.first().textContent()), "AA-only filter shows just W-09");
  await admin.uncheck("#rTagged");
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
