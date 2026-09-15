# Running a Tryout with the Evaluator App

This is for the convenor. It covers the week before, the ice times, reading the results, and cleaning up after.
Companion reading for your evaluators: the *U13 Rep B Player Evaluation Guide* in this folder.

The whole system rests on one rule: **players are numbers, not names.** Nobody using the app ever types, sees
or exports a name. The registrar keeps the only list that connects a pinnie number to a child, on paper or in
their own spreadsheet, and shares it with nobody until rankings are final.

---

## A week before

### 1. Get your login

Whoever set up the app registers your email as the convenor. Open the app link on a laptop or tablet, type your
email and tap *Email me a code*. A six-digit code arrives by email within a minute; type it in and you are on the
convenor dashboard. There is no password to remember. (If you were given a password instead, tap *Use a
password instead*.)

### 2. Create the tryout

On the **Setup** tab, open *Start a new tryout*, enter a name like `2026-27 U13 Rep B` and the season, and
click *Create tryout*. Everyone who signs in from now on sees this tryout.

### 3. Add the ice times

Under *Sessions*, add one line per skate: a label (`Skate 1 – Skills`), the date, the type (skills, scrimmage or
game) and which **jerseys** are worn: primary or secondary (see the next step). Skills sessions normally use the
primary colours and scrimmages the secondary ones; the form suggests that, and you can switch a session later
with the button in the table. If an ice time moves, change the date (or the label or type) right in the table;
it saves as soon as you leave the field, and evaluators see the new date in their session picker. Evaluators pick the session they are scoring from a dropdown, and it defaults to
today's.

### 4. Plan jerseys and enter the players

Every player gets **two jerseys at registration, in two colours, with the same number on both**: for example
White 14 for skills and Green 14 for scrimmages. The number never changes, so a player is always recognisable.
Within each jersey set use colours whose **first letters are all different** (White, Blue, Red for the first
set; Green, Yellow, Orange for the second). Avoid Blue and Black in the same set.

Each player is known in the app by their primary colour letter plus number: White 14 is `W-14`. When a session
uses the secondary jerseys, evaluators see that player as `G-14` on their screen, with a reminder that it is the
same player as `W-14`; all the scores still land on `W-14`.

Together with the registrar, decide which player gets which number and colours. The registrar writes the
number-to-name list and keeps it. You never need it, and the app has nowhere to put it.

Then enter the players in the app, with **no names**. Under *Players*, either paste lines like

```
White,14,D,Green
White,7,F,Green
Blue,1,G,Yellow
```

(primary colour, number, F/D/G, secondary colour) or add them one at a time. The colour pickers default to White
for the primary jersey and Red for the secondary one; choose *Other…* to add a colour that is not in the list. The app refuses a combination that would make two players show the same
code in the same session, and the *Sessions* table flags it if it ever happens. **Changes after registration.** A player who switches position before the tryout starts (say from forward to
defence) is fixed in the Players table: change the position dropdown on their row and it saves immediately. The
same goes for their secondary colour. A player entered by mistake, or with the wrong number, can be **deleted**
with the button on their row, as long as nobody has scored them yet; after that the app refuses and you release
them instead. Number and primary colour cannot be edited because they are the player's identity for the whole
tryout: delete and re-add if one is wrong.

**Players still in the running for AA.** Some players are injured during the spring AA tryouts and come out to
only some of your sessions. Tick **AA** on their row in the Players table. Evaluators see a small AA badge on that
player's card and on the scoring sheet, the same as the note on the paper sheets today, and the Rankings tab has an
*AA only* filter so you can look at them as a group.

**Teams for scrimmages and games.** Under *Teams*, create a team ("Team 1", "Team 2"…), give it a colour, and
tick the players on it. Every player on the team wears the team colour, whatever their own default jersey: White
433 on a Red team shows up for evaluators as `R-433`, and the roster list shows exactly that code. The colour can
be changed on the team's row at any time. Make as many teams as you need; a player can be on more than one (the
day-2 teams and the Wednesday teams can overlap however you like). Then, in the *Sessions* table, each scrimmage
or game row has a *Teams on the ice* cell: pick a team (its colour is filled in for you; change it only if the
team is swapping jerseys for that one session), press *+ team*, and do it again for the other team. Every scrimmage and game is full ice with exactly two teams, so once two are on the row the add controls disappear; use the ✕ on a team to swap it out. That is the whole setup
for a game: "Team 1 in Red vs Team 2 in White". Players who are not on a playing team are **not dressed** for
that session: evaluators do not see them, cannot score them, and the session does not count in their Sessions
column. Use the ✕ on a team pill to take it off a session, and *Delete team* under *Teams* when a grouping is no
longer needed. Skills sessions ignore teams: everyone plays.

**Jerseys for skills nights.** Under *Attendance & jerseys*, pick the session and set what each player is
actually wearing. Use the bulk row: *all forwards → White*, Apply, then *all defence → Red*, Apply. Individual
rows can still be changed, and a colour set here for a player also overrides their team colour in a game if a
player has to borrow a jersey. Any player can be changed on their own row, and *Other…* adds a colour that
is not in the list. *Reset to default jerseys* removes every per-player setting for that session and goes back to
the session's primary/secondary default. Evaluators see exactly these colours for that session; the number never
changes, and the code under the number reminds them which player it is. The section warns you if two players would
show as the same code.

**Attendance.** In the same section, untick anyone who is not on the ice. In a team session the list is grouped
by team, with the not-dressed players shown greyed at the bottom. An absent player
disappears from every evaluator's screen for that session only, cannot be scored for it (the app refuses, even if
someone tries), and does not count in the "scored" total at the bottom of the evaluators' screens. Rankings show a
*Sessions* column (attended over total) so you can tell "was there twice and scored well" from "was there five
times". A player's overall is the average of the evaluations they actually received, so missing sessions never
lowers their number; it just gives you fewer data points, which is what the Sessions and Evals columns are for.

If a player withdraws or is released between skates, click
*Release* next to their number; they disappear from the evaluators' screens and from rankings but their scores
are kept. *Reinstate* brings them back.

If you have a spreadsheet, export just those three or four columns to a CSV and paste it. The app refuses any
other layout, so a roster with names cannot be loaded by accident.

### 5. Create evaluator logins and add them to the tryout

On the **Evaluators** tab, under *Evaluator logins*, enter each evaluator's email and a label. The label is what **you** see in the
rankings (`Evaluator 1`, `Evaluator 2` …). Neutral labels let you look at disagreement without bias; use real
names only if you want to.

No email goes out when you create a login. Send the evaluators the app link yourself: they type their email,
get a code by email, type it in, and they are signed in for a month. Ask them to do this **before the first
skate**, on the phone they will use at the rink. That first sign-in also stores the app on the phone so it opens
even with no signal.

A login only works for tryouts it has been added to. Logins you create here are added to the current tryout
automatically and show as **scoring**. Evaluators from a previous season show as **not added** until you click
*Add to tryout*. The line above the table tells you how many people can currently score.

### 6. Brief the evaluators

Fifteen minutes, ideally with the evaluation guide in hand:

- Players are numbers. No roster, no asking who anyone is, nothing identifying in notes.
- Score independently. Do not compare during a session. Nobody sees anyone else's scores.
- Watch three to five players at a time, not the whole ice. Assign colours or lines per drill if you can.
- Use the whole 1–5 scale; 3 is a solid Rep B player. Give a tier (A/B/C/X) at the end.
- Declare any conflict of interest (own child, relative). They still score; you exclude that pair later.

---

## At the rink

### What evaluators see

The evaluator screen shows the tryout name, a session picker, a sync dot, filter chips (All / each colour /
F / D / G) and a grid of big buttons, one per active player, showing the colour **worn in that session**, the
number and the position. Sessions played in the secondary jerseys are marked "2nd jerseys" in the picker, and
the scoring sheet reminds the evaluator of the player's usual code. Tapping a
player slides up a scoring sheet:

- one row per criterion for that position, with five big buttons `1 2 3 4 5` (tap the criterion name, or press and
  hold a number, to see what it means);
- tier buttons A / B / C / X;
- a short notes box (280 characters, "What did you see? (no names)");
- *Save & Next* jumps to the next unscored player in the current filter, *Save & Close* returns to the grid,
  *Clear* wipes that player for this session.

Every tap is saved on the phone immediately. Nothing is lost if the phone locks or the Wi-Fi drops. The bottom
line shows progress: "14 of 38 scored this session". Scored players get a green border, a check mark and their
tier letter.

Evaluators can only ever see their own scores. They cannot see other evaluators, combined rankings or the
convenor pages. If they re-score a player in the same session, the new scores replace the old ones.

### Stopping an evaluator

If an evaluator drops out, or you want to be sure nobody adds scores after the last skate, click **Disable**
next to their label on the Setup tab. From that moment the server refuses their scores, including anything
still queued on their phone, and their screen goes read-only with a note to ask the convenor. Their existing
scores are kept and still count. *Enable* reverses it. You do not need to delete anything.

### The sync dot

- **Green "Synced"**: everything is on the server.
- **Amber "3 queued"**: saved on the phone, waiting for a connection. Normal at rinks.
- **Red "Offline"**: no connection at all. Keep scoring; it will catch up.
- **Red "Sign in again"**: their login expired (after about a month). Scores are safe; sign in again and they sync.
- **Red "rejected"**: the server refused something, usually because the tryout was closed or the evaluator was disabled. Tapping the dot shows why.

Ask evaluators not to sign out while the dot is amber. If they try, the app warns them; the scores stay on the
phone until they sign in there again, but it is simpler to wait for green.

### Recommended session shape

Skate 1 skills and skating (score skating, puck control, passing, shooting cleanly); skates 2 and 3 small-area
games and scrimmage (hockey sense, compete, position-specific criteria); the last skate scrimmage only, focused
on bubble players. Before the last skate, use the rankings to give evaluators the numbers that need a second look.

---

## Reading the results

Sign in on a laptop or tablet. The **Rankings** tab shows one row per active player. Use *Refresh* at the top to
pull the latest scores.

| Column | Meaning |
|---|---|
| Player / Pos | pinnie code and position |
| Evals | how many evaluator-sessions scored this player |
| Overall | weighted average of the scored criteria (skating, hockey sense and compete count 1.5×, coachability 0.5×), averaged across evaluations |
| Spread | how much evaluators disagree on this player: the standard deviation of each evaluator's overall. Rows at 0.75 or more are highlighted |
| A B C X | how many evaluators gave each tier |
| Skating … Offensive Play | average score per criterion; `–` means not applicable to that position |

Filter by **Session** (one skate or all combined) and **Position**. Click any column heading to sort. Two toggles:

- **Equal weights** scores every criterion the same instead of using the rubric weights. Handy as a sanity check.
- **Normalise evaluators** adjusts for a consistently harsh or generous evaluator by re-centring each evaluator's
  scores on the group average before combining them. It only kicks in for evaluators with at least three scores.

### Highlighted rows

A highlighted spread means the evaluators saw different players or different things. That is information, not a
fault: those are the players to assign to specific evaluators for a second look, or to discuss with the numbers
in front of you.

### Evaluators

The **Evaluators** tab shows every evaluator's average and spread next to the group's, with a tendency note
(harsh, generous, in line, narrow range) and a full list of their scores and notes. Use it to:

- spot an evaluator who scored everyone 3 or 4 (narrow range: their scores separate nobody);
- check nobody wrote identifying notes; if someone did, ask them to fix it and edit it out of your export;
- remove a conflict-of-interest pair from your thinking (their score for that one player) before finalising.

---

## Exporting

**Export** tab:

- *Download rankings CSV*: one row per player with whatever session, position and toggles are set on the
  Rankings tab. The first line records those settings.
- *Download raw CSV*: every score, tier and note, one row per evaluator × session × player.
- *Upload … to S3*: also stores a copy in the association's private storage bucket, in case you want a record that
  does not live on a laptop.

Both files contain player codes only. Match them to names with the registrar's list **after** the ranking is
agreed, and keep that combined file off shared drives.

---

## After the tryout

1. Export both CSVs and keep them somewhere safe.
2. **Close tryout** tab → *Close tryout*. Scoring stops for everyone; evaluators can still open the app and see
   their own scores, read-only. This cannot be undone from the app.
3. Once the team is announced, go to **Setup** → *Evaluators* and click *Disable* (keeps the login for next
   season) or *Delete login* for each evaluator. Their scores stay in the records, identified only by an internal id.
4. Tell the registrar to file or shred the number-to-name list according to your association's policy.

Next season, create a new tryout on the Setup tab. Nobody can score it until you add evaluators to it, so old
logins cannot create stray evaluations. Old tryouts stay in storage but are no longer shown.

---

## If something goes wrong

- **An evaluator cannot sign in**: check they are using exactly the email you entered, and that the code email
  did not land in spam. Codes expire after a few minutes; *Send a new code* gets a fresh one. If nothing arrives,
  delete and recreate their login on the Setup tab (their old scores are kept).
- **An evaluator sees "not on the evaluator list"**: on the Setup tab, click *Add to tryout* or *Enable* next to
  their label, then have them reload.
- **The grid shows the wrong colours for a session**: on the Setup tab, use *Switch to primary* / *Switch to
  secondary* next to that session. Evaluators reload and see the right jerseys; nothing about the scores changes.
- **A player has the wrong position or number**: add the correct one, then *Release* the wrong one. Scores under
  the wrong code stay with the wrong code, so fix this before the first skate if you can.
- **Two colours start with the same letter**: the app blocks it. Rename one colour (e.g. `Dark` for black).
- **An evaluator's phone died mid-skate**: their scores up to that moment are on the phone and will sync when it
  is back on and connected, even days later. They can also switch phones and keep scoring; the two devices'
  scores combine per player (the most recent save wins).
- **The dot stays red after the Wi-Fi is back**: tap it. "Sign in again" means the login expired; "rejected" shows
  the reason (usually a closed tryout).
