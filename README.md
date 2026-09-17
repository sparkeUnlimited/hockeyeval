# Tryout Evaluator

A mobile-first web app for scoring hockey players during association tryouts. Three to six volunteer
evaluators score from a phone or iPad at the glass; one convenor (admin) sees combined rankings and exports CSVs.

**Players are pinnie colour + number only** (`W-14`, `B-07`). The app has no field for a name, birthdate, photo
or parent contact anywhere: not in the schema, not in notes, not in filenames, not in logs. The registrar keeps
the number-to-name list offline. Evaluators only ever see their own scores.

Screens: [evaluator](docs/screenshot-evaluator.png) · [scoring sheet](docs/screenshot-evaluator-sheet.png) ·
[admin rankings](docs/screenshot-admin-rankings.png). Convenor guide: [docs/RUNNING-A-TRYOUT.md](docs/RUNNING-A-TRYOUT.md).

## How it works

| Layer | Choice |
|---|---|
| Front end | Vanilla HTML/CSS/JS ES modules, no build step (`web/`) |
| API | AWS AppSync GraphQL, APPSYNC_JS resolvers straight to DynamoDB (no Lambda in the hot path) |
| Database | DynamoDB single table `TryoutTable`, on-demand, PITR on |
| Auth | Cognito user pool (Essentials tier): email + one-time code by default, password as fallback; groups `admin` and `evaluator` |
| Hosting | S3 behind CloudFront (Origin Access Control, HTTPS only) |
| Exports | CSV built in the browser; optional copy PUT to a private S3 bucket via presigned URL |
| Infra | AWS CDK v2 in JavaScript (`infra/lib/tryout-stack.js`), or AWS SAM (`infra/template.yaml`) |
| Region | `ca-central-1` |

The one Lambda (`infra/lambda/admin-ops.mjs`) handles three admin-only fields that JS resolvers cannot:
creating/deleting evaluator logins in Cognito and presigning the export upload.

**Offline first.** Every score tap is written to an IndexedDB outbox (localStorage fallback) before any network
call, then flushed in order on page load, on the `online` event, when the tab becomes visible and every 30 s.
Entries are keyed by a stable `clientId` so retries are idempotent (the server upserts). The header dot is
green when everything is synced, amber with a count when items are queued, red when offline or when the
session has expired (the outbox survives sign-out and re-sign-in on the same device).

**Sign-in.** Evaluators enter their email and get a one-time code by email (Cognito `USER_AUTH` flow with
`EMAIL_OTP`), so there is no password to hand out or forget. A password form is one tap away for accounts that
have one (CLI-created admins, scripts, the dry run). `web/js/auth.js` talks to the Cognito JSON API with plain
`fetch`; no SDK is shipped to the browser. Sessions last 30 days and refresh silently.

**Per-tryout allowlist.** A login can only score a tryout it has been added to. The Evaluators tab lists every
evaluator with an *Add to tryout* / *Disable* / *Enable* toggle; logins created there are added automatically,
and a new tryout starts with nobody added. The write resolver fetches the caller's access row in the same
`BatchGetItem` as the tryout, session and player, and rejects with `Forbidden` when it is missing or disabled.
Queued offline scores from a disabled evaluator are rejected on sync and shown as such on their phone.

**Players, teams and what they wear.** A player's identity for the whole tryout is their primary colour letter
plus number (`W-433`); the number never changes. What they wear on a given night is resolved per session, in
one place (`wornColour` in `web/js/api.js`), with this precedence: a per-player colour set for that session
(*Attendance & jerseys*, or an evaluator's Players panel), then the colour of the team they are on for that
session, then the session's default jersey set (primary or secondary). **Teams** are named rosters with an
optional colour; a scrimmage or game takes exactly two, a skills session takes one *group* (usually with no
colour, so players stay in their default jerseys). Players not on a team or group that is on the ice are *not
dressed*: hidden from evaluators, unscoreable (the write pipeline reads rosters live), and not counted as a
session attended. Evaluators see the worn colour with the same number (`W-433` on a Red team shows as `R-433`);
scores always attach to the primary code and the raw CSV records `worn_as`. The admin flags any session where
two players would show the same code, and putting a coloured team on a session clears leftover per-player
colours for its players so the team colour actually wins.

**Convenor dashboard.** Setup (folding cards: Tryout, Players, Teams, Sessions, Attendance & jerseys), Rankings
(sortable, per-session or combined, equal-weights and z-score toggles, AA-only filter, a **cut line** with release
counts per position and minimum evaluations/sessions, tie-safe, with a *Not enough information* group),
Evaluators (logins, allowlist toggles, *Score players yourself* so the convenor can evaluate with their own login,
and every evaluator's scores and tendencies), Export and Close tryout. The Players table edits position, primary
colour (only before scores; the row is moved atomically and references carried over), secondary colour and the
tag (AA, or *Made team* for players already known to be making the team) in place, and deletes players that have
no scores. Attendance per session is Present / Absent / Sitting, with a one-tap button that sits every *Made team*
player out of a scrimmage; made-team players stay in the rankings but are never in the release zone.

**Evaluator screen.** Grid grouped by worn colour (labelled with the team in a scrimmage), each group foldable;
full-screen scoring sheet with the header and Save buttons pinned and a "scroll down, there is more" marker; *My
rankings* (their own scores only, across sessions); *Players* (the full list with what each is wearing, editable
behind a confirm since it shows for everyone). Absent, sitting and not-dressed players do not appear.

**After the first cuts.** Players already known to be making the team get the *Made team* tag; the Attendance &
jerseys card then offers *Sit the N who made the team* for the intra-squad scrimmage, which marks them *Sitting*
for that session only (hidden from evaluators, unscoreable, not counted as attended). The rankings keep them
visible with a *made team* pill but they never occupy a release spot. The convenor guide has the four-step
walkthrough.

**Rubric.** `web/js/criteria.js` is the single source of truth for criteria, weights, anchors and tiers. Skaters:
Skating Speed and Skating Mobility (1.0 each, replacing Skating 1.5 and Coachability 0.5 as of 2026-09-16), Puck
Control, Passing, Shooting, Hockey Sense (1.5), Compete Level (1.5), plus Defensive or Offensive Play; goalies:
Crease Movement, Save Technique, Rebound Control, Game Awareness, Compete Level. Renaming a criterion key means
scores stored under the old key are ignored by rankings, CSVs and the write resolver (unknown keys are stripped). The
evaluator form, the admin rankings, the CSV headers, the resolvers (which strip unknown keys) and the tests all
import it.

## Repo layout

```
CLAUDE.md                   spec this was built from
infra/
  bin/app.js                CDK app (ESM)
  lib/tryout-stack.js       Cognito, DynamoDB, AppSync, Lambda, S3, CloudFront
  lib/bundle.js             esbuild bundling of resolvers at synth time
  schema.graphql            GraphQL schema (no name field anywhere, on purpose)
  resolvers/                one .js file per AppSync function; shared.js has validation helpers
  lambda/admin-ops.mjs      the only Lambda
  template.yaml             SAM equivalent of the CDK stack
  samconfig.toml            sam build / sam deploy settings
web/
  index.html                sign in (+ first-login new password)
  evaluate.html, js/evaluate.js   evaluator screen
  admin.html, js/admin.js         convenor dashboard
  js/criteria.js            the rubric
  js/api.js                 GraphQL fetch + offline outbox
  js/auth.js                Cognito one-time-code + password sign-in over fetch (no SDK)
  js/config.js              GENERATED by scripts/deploy.sh (gitignored)
  sw.js                     network-first service worker so the shell loads with no signal
scripts/
  deploy.sh                 cdk (or sam) deploy -> config.js -> S3 sync -> CloudFront invalidation
  create-user.sh            create an admin or evaluator login with the AWS CLI
  seed-players.js           load players from a colour,number,position CSV
  dev-server.js             local mock backend running the real resolver code (no AWS)
tests/
  criteria.test.js          rubric + weightedScore
  resolvers.test.js         resolver request/response unit tests (identity, closed tryout, key stripping, notes cap)
  e2e/dry-run.js            Playwright end-to-end (local mock or deployed URL), writes docs/screenshots
docs/                       convenor guide, evaluation guide, screenshots, players.example.csv
```

## Prerequisites

- Node.js 20+ (tested on 24), npm
- AWS CLI v2 with credentials for the target account (`aws sts get-caller-identity` works)
- For the SAM path only: AWS SAM CLI (`brew install aws-sam-cli`)

## First-time setup

```bash
npm install                     # test + script dependencies
npm --prefix infra install      # CDK, esbuild
npm test                        # 40 unit tests, no AWS needed
```

### 1. Deploy (CDK, default)

```bash
scripts/deploy.sh
```

This bootstraps CDK in `ca-central-1` if needed, runs `cdk deploy`, writes `web/js/config.js` from the stack
outputs, uploads `web/` to the web bucket and invalidates CloudFront. It prints the CloudFront URL at the end.
Re-run it after any change. `scripts/deploy.sh --web-only` re-uploads just the front end.

### 1b. Deploy with SAM instead

```bash
scripts/deploy.sh --sam
# or by hand, from infra/:  npm run bundle && sam build && sam deploy
```

`infra/samconfig.toml` holds the stack name (`tryout-evaluator`), region and deploy flags. Use CDK **or** SAM in a
given account, never both: they create the same fixed table and pool names and the second one will fail.

### 2. Create the first admin

```bash
scripts/create-user.sh convenor@example.com admin
```

That is a passwordless account: open the app, enter the email, and sign in with the code Cognito emails you.
Add `--password '...'` if you also want a password (scripts and the automated dry run need one), or `--invite`
to get the old-style email with a temporary password.

**Verify on first deploy:** sign in once with a code before handing the link to anyone. Email one-time-code
sign-in is configured (`UserPoolTier: ESSENTIALS`, `AllowedFirstAuthFactors: PASSWORD, EMAIL_OTP`,
`ALLOW_USER_AUTH`) but could not be exercised locally, only the password fallback and the mock were. If the code
step fails for accounts created without a password, the fallback is `create-user.sh --invite`.

Cognito's default email sender is limited to 50 messages a day, which is plenty for a tryout. For a larger
association, point the pool at Amazon SES.

### 3. Set up the tryout

Sign in at the CloudFront URL with the admin account. On **Setup**: create the tryout, add players (paste
`colour,number,position,colour2` lines, the fourth column being the secondary jersey colour, or add one at a
time), make teams and groups, add sessions and put teams on them, and set attendance and jerseys per session. On
**Evaluators**: create evaluator logins (added to the current tryout automatically; logins created from the CLI
show as *not added* until you click *Add to tryout*) and, if you want to score too, *Add me as an evaluator*.
Or load players from the command line (needs an admin with a password):

```bash
TRYOUT_ADMIN_EMAIL=convenor@example.com TRYOUT_ADMIN_PASSWORD='...' node scripts/seed-players.js docs/players.example.csv
```

The seed script accepts three or four columns (`colour,number,position[,colour2]`) and refuses anything else, so a
roster with names cannot be loaded by mistake.

Evaluators can also be created from the CLI: `scripts/create-user.sh eval3@example.com evaluator --label 'Evaluator 3'`.

## Local development (no AWS)

```bash
node scripts/dev-server.js --seed     # http://localhost:8787
```

Serves `web/` with a mock config and a mock GraphQL endpoint that runs the **real** resolver code against an
in-memory DynamoDB. Sign in with any email: addresses starting with `admin` are admins, anything else is an
evaluator. The one-time code is always `123456`; on the password form, `temp` exercises the new-password step.
`--seed` creates a tryout with two sessions, 15 players and two evaluators already added to it
(`evaluator1@mock.test`, `evaluator2@mock.test`).

## Tests

```bash
npm test                    # node --test: rubric + resolver unit tests
node tests/e2e/dry-run.js   # Playwright dry run against the local mock (starts it for you)
```

Dry run against the deployed site. Both accounts need a password (`create-user.sh ... --password`), because a
one-time code cannot be read by a script; the evaluator's Setup-tab label must match `E2E_EVALUATOR_LABEL`:

```bash
E2E_URL=https://xxxx.cloudfront.net E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
E2E_EVALUATOR_EMAIL=... E2E_EVALUATOR_PASSWORD=... E2E_EVALUATOR_LABEL='Evaluator 1' node tests/e2e/dry-run.js
```

The dry run (66 unit tests run separately) walks the whole flow: admin creates a tryout with 2 sessions and 12
players, edits positions and colours, tags a player AA, marks one absent, tags another *Made team* and sits them
out of the scrimmage with one tap, sets skills-night jerseys by position,
builds two teams and puts them on the scrimmage (plus a group on the skills session), moves a session date,
changes a player's primary colour before any scores; an evaluator not yet on the list sees a read-only screen,
is added, scores 6 players, goes offline, scores 3 more, comes back online, folds a colour group, checks *My
rankings*, changes a player's jersey from the *Players* panel; the convenor adds themselves as an evaluator and
scores; the rankings show all 9 with the Sessions column, AA-only filter and the cut line (including the tie
rule); deleting or recolouring a scored player is refused. It saves screenshots into `docs/`.

Layout is checked in a mobile emulation at 393 px (iPhone 14 Pro): every screen and panel measures exactly the
viewport width, so the page never scrolls sideways; only tables, colour chips and tabs scroll inside their own
box. Dropdowns and inputs are capped at the available width for that reason. On laptops the scoring sheet is two
columns; the Players and My rankings panels are single-column.

Resolvers were also checked against the real APPSYNC_JS runtime with `aws appsync evaluate-code` (no regex
literals, no classic `for`, no `++`, no comparator sorts, no `continue`). If you edit a resolver, run
`cd infra && npx cdk synth` and re-check with `evaluate-code` before deploying.

## Security and privacy notes

- No `name` field exists in the GraphQL schema, DynamoDB items, Cognito attributes (email only), CSV headers or
  Lambda logs. Tests assert that client-supplied `name`/`firstName` on player input is dropped.
- `upsertEvaluation` takes the evaluator id from the Cognito token, never from arguments, and requires an enabled
  access row for that id on the tryout. `myEvaluations` queries only the caller's partition. Admin fields are gated by `@aws_auth(cognito_groups: ["admin"])` **and**
  re-checked in every admin resolver and in the Lambda.
- AppSync logging is `ERROR` level with `excludeVerboseContent: true` (no request/response bodies, so notes never
  reach CloudWatch). The Lambda logs only the field name and error type. Introspection is disabled.
- Notes are capped at 280 characters server-side. The UI reminds evaluators not to write anything identifying.
  A name typed into notes is the one leak the software cannot prevent; the convenor guide covers it.
- Buckets block public access and enforce TLS. The web bucket is only readable through CloudFront (OAC).
- Cognito: no self sign-up; refresh tokens 30 days; token revocation on; sign-out revokes the refresh token.
  Disabling an evaluator takes effect on their next write (their existing ID token is valid for up to an hour, but
  the write resolver checks the access row on every call, so it does not matter).

## Cost

For one association's tryouts (about 6 evaluators, 60 players, 8 sessions), everything is inside the always-free or
pennies range: a few thousand AppSync requests, a few MB in DynamoDB on-demand, a handful of Lambda invocations,
CloudFront and S3 for a static site with a dozen users. Expect well under $1/month; CloudWatch log storage is the
only thing that grows, and log groups expire after 30 days.

## Operations

- **Reset an evaluator's password**: `aws cognito-idp admin-set-user-password --user-pool-id <pool> --username <email> --password '<temp>' --no-permanent` (they will be asked for a new one), or delete and recreate the login on the Evaluators tab.
- **Stop an evaluator scoring**: Evaluators tab → Disable (reversible; scores kept). Delete login removes the account (never for a convenor login).
- **Delete evaluator logins after the tryout**: Evaluators tab → Delete login (scores are kept, keyed by id only).
- **Fix a session that lists the wrong players**: the wrong team/group is on the session row; swap it. Leftover per-player colours: *Reset to default jerseys* in Attendance & jerseys, or re-add the team.
- **Exports** land in `s3://<ExportsBucketName>/exports/<tryoutId>/<date>/`. Lifecycle expires them after 400 days.
- **Tear down**: `cd infra && npx cdk destroy` (or `sam delete`). The table, user pool and exports bucket are
  retained on purpose; delete them by hand when you are sure.

## Design deviations from the spec

- `allEvaluations` is paginated (`EvaluationPage { items, nextToken }`) and served by a second GSI (`GSI2`) so the
  admin dashboard can load every evaluation for a tryout in one or two queries rather than one per player.
- `deleteEvaluator` was added so the convenor can remove logins without the AWS console.
- Sign-in is email + one-time code (Cognito passwordless, Essentials tier) with password as a fallback, over plain
  `fetch` instead of `amazon-cognito-identity-js`, at the owner's request.
- A per-tryout evaluator allowlist (`TRYOUT#/EVALUATOR#` rows, `setEvaluatorAccess`, `Tryout.canEvaluate`,
  `Tryout.evaluatorAccess`) gates every write, also at the owner's request.
- Players carry an optional `colour2` and sessions a `jersey` (`primary`/`secondary`) plus an `updateSession`
  mutation, so scrimmages can be played in the second jersey set without changing player identities.
- Teams: `TRYOUT#/TEAM#<id>` rows (`name`, optional `colour`, `players` list) with `createTeam`, `updateTeam`,
  `deleteTeam`, `setTeamPlayers`; `Session.teams` (`[{ teamId, colour? }]`) via `setSessionTeams`, a two-step
  pipeline that reads the session type and caps the list (one group for skills, two teams otherwise). A session
  entry with no colour means default jerseys even if the team has a colour. The write pipeline gained a step that
  reads the session's team rosters live and rejects a score for a player not dressed. The front end derives
  `teamColours`/`teamOf` per session in `normalizeTryout` and resolves precedence in `wornColour`: per-player
  override, then the session's colour for the team (pre-filled from the team's own colour), then the session's
  primary/secondary default. Assigning a coloured team drops per-player overrides for its players.
- Per-session jersey colours: `Session.colours` (`{ playerNumber: colour }`, replaced whole by
  `setSessionColours`). Overrides win over the session's `jersey` default; the front end resolves the worn colour
  in one place (`wornColour` in `web/js/api.js`) for the evaluator grid, chips, sheet, admin tables and CSVs.
- Per-session attendance: `Session.absent` and `Session.sitting` (DynamoDB string sets; `setAttendance` takes
  `status: present | absent | sitting` and moves the player between them). Absent and sitting players are hidden
  from the evaluator grid for that session, `upsertEvaluation` rejects scores for them, and rankings show sessions
  attended. Overall is an average over the evaluations received, so a missed skate never counts against a player.
- `Player.tag`: a short admin label (12 chars, letters/digits only, never free text) shown as a badge to
  evaluators and in rankings. The UI offers `AA` (still in AA contention) and `MADE` (has made the team; shown as
  *Made team*, never in the release zone, and the target of the admin's "sit the players who made the team"
  button, which loops `setAttendance` with `sitting`). `TAGS` in `web/js/api.js` defines the labels.
- `setPlayerSessionColour`: any enabled evaluator (or admin) can change one player's worn colour for one
  session; a two-step pipeline checks the caller's allowlist row, then rewrites the session's colour map. The
  evaluator screen's Players panel uses it behind a confirm.
- `addSelfAsEvaluator`: the convenor writes their own `USER#` profile (role admin) and is added to the tryout
  allowlist like any evaluator; the admin page links to the scoring screen and back. The Lambda refuses to delete
  any login in the admin group.
- `updatePlayer` (position, secondary colour and/or tag) and `deletePlayer` (refused once the player has scores; a
  two-step pipeline checks GSI1 first) support registration changes before the tryout starts.
- `changePlayerColour` changes the primary colour, i.e. the player's code: a three-step pipeline (refuse if the
  player has scores, read the row, `TransactWriteItems` put-new + delete-old with a conflict check). The admin
  page then carries the new code into team rosters, attendance sets and per-session colour maps.
- `criteria.js` gained a `short` heading per criterion for the dense admin tables (full label on hover); CSV
  headers still use the keys. The rankings cut line and the evaluator's *My rankings* are computed entirely in
  the browser from data the caller is already allowed to see.
- The Lambda runs Node 22 (Node 20 is deprecated for new functions).
- Comparator sorts are done on the client because the APPSYNC_JS runtime does not allow them.
