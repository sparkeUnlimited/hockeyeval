#!/usr/bin/env node
// Load players into the current tryout from a CSV of `colour,number,position`.
//
//   TRYOUT_ADMIN_EMAIL=you@example.com TRYOUT_ADMIN_PASSWORD='...' node scripts/seed-players.js [players.csv]
//
// The CSV must have exactly three columns. A header row is optional. Lines starting with # are ignored.
// The script refuses any file with more than three columns so a roster with names can never be loaded by mistake.
import * as fs from "node:fs";
import { loadConfig, signIn, gql } from "./lib/cognito-node.js";

const file = process.argv[2] || "players.csv";
const email = process.env.TRYOUT_ADMIN_EMAIL;
const password = process.env.TRYOUT_ADMIN_PASSWORD;
if (!email || !password) {
  console.error("Set TRYOUT_ADMIN_EMAIL and TRYOUT_ADMIN_PASSWORD");
  process.exit(2);
}

export function parsePlayersCsv(text) {
  const players = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith("#")) continue;
    const cols = raw.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length !== 3) {
      throw new Error(`Line ${i + 1}: expected exactly 3 columns (colour,number,position), got ${cols.length}. ` +
        "Never load a file that contains names.");
    }
    const [colour, number, position] = cols;
    if (i === 0 && /^colou?r$/i.test(colour)) continue; // header
    if (/name|dob|birth/i.test(raw)) throw new Error(`Line ${i + 1}: looks like it contains a name or birthdate; refusing`);
    if (!/^[A-Za-z]{2,20}$/.test(colour)) throw new Error(`Line ${i + 1}: bad colour "${colour}"`);
    if (!/^\d{1,3}$/.test(number)) throw new Error(`Line ${i + 1}: bad number "${number}"`);
    if (!/^[FDG]$/i.test(position)) throw new Error(`Line ${i + 1}: position must be F, D or G`);
    players.push({ colour, number: Number(number), position: position.toUpperCase() });
  }
  return players;
}

const cfg = await loadConfig();
const players = parsePlayersCsv(fs.readFileSync(file, "utf8"));
console.log(`${players.length} players parsed from ${file}`);

const token = await signIn(cfg, email, password);
const { currentTryout } = await gql(cfg.graphqlUrl, token, `query { currentTryout { id name status } }`);
if (!currentTryout) { console.error("No tryout exists yet. Create one on the admin Setup tab first."); process.exit(1); }
console.log(`Loading into "${currentTryout.name}" (${currentTryout.id})`);

const MUT = `mutation($tryoutId: ID!, $players: [PlayerInput!]!) {
  upsertPlayers(tryoutId: $tryoutId, players: $players) { playerNumber position active }
}`;
let done = 0;
for (let i = 0; i < players.length; i += 25) {
  const chunk = players.slice(i, i + 25);
  const data = await gql(cfg.graphqlUrl, token, MUT, { tryoutId: currentTryout.id, players: chunk });
  done += data.upsertPlayers.length;
  console.log(`  ${done}/${players.length}: ${data.upsertPlayers.map((p) => p.playerNumber).join(" ")}`);
}
console.log("done");
