# Running a Tryout with the Evaluator App

This is for the convenor. It covers the week before, the ice times, reading the results, and cleaning up after.
Companion reading for your evaluators: the *U13 Rep B Player Evaluation Guide* in this folder.

The whole system rests on one rule: **players are numbers, not names.** Nobody using the app ever types, sees
or exports a name. The registrar keeps the only list that connects a jersey number to a child, on paper or in
their own spreadsheet, and shares it with nobody until rankings are final.

---

## A week before

### 1. Get your login

Whoever set up the app registers your email as the convenor. Open the app link on a laptop or tablet, type your
email and tap *Email me a code*. A six-digit code arrives by email within a minute; type it in and you are on the
convenor dashboard. There is no password to remember. (If you were given a password instead, tap *Use a
password instead*.)

The dashboard has five tabs: **Setup**, **Rankings**, **Evaluators**, **Export** and **Close tryout**. Every
section on the Setup tab folds up when you click its heading, and stays folded on that browser, so once the
player list is entered you can tuck it away. A folded section shows a short count ("Players · 42 active") so you
know what is inside.

### 2. Create the tryout

On the **Setup** tab, open *Start a new tryout*, enter a name like `2026-27 U13 Rep B` and the season, and
click *Create tryout*. Everyone who signs in from now on sees this tryout.

### 3. Plan jerseys and enter the players

Every player gets a **number that never changes** and, at registration, a primary jersey colour (and optionally a
secondary one). The number is what makes a player recognisable all tryout long. Within a jersey set use colours
whose **first letters are all different** (White, Blue, Red, Green, Yellow, Orange). Avoid Blue and Black
together.

Each player is known in the app by their primary colour letter plus number: White 433 is `W-433`. What they
actually wear on a given night can differ (see Teams and Sessions below); evaluators always see the colour worn
that session with the same number, and every score lands on `W-433` regardless.

Together with the registrar, decide who gets which number and colours. The registrar writes the number-to-name
list and keeps it. You never need it, and the app has nowhere to put it.

Then enter the players under *Players*, with **no names**. Either paste lines like

```
White,433,F,Red
White,151,F,Red
Red,167,D,White
Blue,1,G,Yellow
```

(primary colour, number, F/D/G, optional secondary colour) or add them one at a time. The colour pickers on the
add-one form are dropdowns that start at White for the primary jersey and Red for the secondary; choose *Other…*
to type a colour that is not in the list. If you have a spreadsheet, export just those three or four columns to a
CSV and paste it. The app refuses any other layout, so a roster with names cannot be loaded by accident.

**Changes after registration.** In the Players table:

- **Position** is a dropdown on each row. Change it and it saves immediately.
- **Secondary colour** is a dropdown on each row too.
- **AA**: tick it for a player who is injured during the spring AA tryouts and still being considered there.
  Evaluators see a small AA badge on that player's card and on the scoring sheet, the same as the note on the
  paper sheets today, and the Rankings tab has an *AA only* filter to look at them as a group.
- **Delete** removes a player entered by mistake or with the wrong number, as long as nobody has scored them yet.
  After that the app refuses and you *Release* them instead (they disappear from evaluators and rankings, scores
  kept; *Reinstate* brings them back).
- Number and primary colour cannot be edited because they are the player's identity for the whole tryout: delete
  and re-add if one is wrong.

### 4. Make the teams and groups

Under *Teams*, create a team: a name (`Team 1`, `Day 2 Red`, `Group A`) and, for a scrimmage team, its jersey
colour. Then open the team's row (the chevron, or the *players · pick* pill) and tick the players on it. The
picker shows numbers and positions only, sorted by number. A player can be on more than one team, so the day-2
teams and the Wednesday teams can overlap however you like. On the team's row you can rename it, change its
colour, or *Delete team*.

Teams are used two ways:

- **Scrimmages and games.** Every player on the team wears the team colour, whatever their own default jersey:
  White 433 on a Red team shows to evaluators as `R-433`.
- **Skills sessions.** If you split the players into two groups so each night is easier to evaluate, make each
  group a team (no colour needed). Players in a skills group wear their default jersey from the Players list.

### 5. Add the ice times

Under *Sessions*, add one line per skate: a label (`Skate 1 – Skills`), the date, the type (skills, scrimmage or
game) and the default jerseys (primary or secondary; the fallback when nothing else says what a player wears).
Label, date and type are edited right in the table and save as soon as you leave the field, so a moved ice time
is a one-field change; evaluators see the new date in their session picker.

Each row has a **Teams on the ice** cell:

- **Scrimmage or game**: full ice, exactly two teams. Pick a team and press *+ team*; its colour is filled in from
  the team (change it only if that team is swapping jerseys for that one session). Then the second team. Once two
  are on, the add controls disappear; use the ✕ on a team to swap it out. That is the whole setup for a game:
  "Team 1 in Red vs Team 2 in White".
- **Skills**: put the group that is skating on the session with *+ group*, leaving the colour as *default
  jerseys*. With no group on a skills session, everyone is on the ice.

Players who are not on a team or group that is on the ice are **not dressed** for that session: evaluators do not
see them, cannot score them, and the session does not count in their Sessions column. You never have to mark
them absent.

### 6. Attendance & jerseys

Under *Attendance & jerseys*, pick a session. For that ice time only:

- **Attendance**: untick anyone who is not on the ice (injured, sick). They disappear from every evaluator's
  screen for that session, cannot be scored for it (the app refuses, even if someone tries), and it does not count
  in their Sessions column. Tick them again if they turn up. In a team session the list is grouped by team, with
  the not-dressed players greyed at the bottom.
- **Jerseys**: the dropdown on each player is the colour they are wearing today. For a skills night dressed by
  position, use the bulk row: *all forwards → White*, Apply, then *all defence → Red*, Apply. In a scrimmage the
  list already shows the team colours; change a player here only if they are wearing something else (a borrowed
  jersey). *Reset to default jerseys* clears every colour set here for this session.

Precedence, if you ever need it: a colour set here for a player wins over the team colour, which wins over the
session's default jerseys. The section warns you if two players would show as the same code.

### 7. Create evaluator logins and add them to the tryout

On the **Evaluators** tab, under *Evaluator logins*, enter each evaluator's email and a label. The label is what
**you** see in the rankings (`Evaluator 1`, `Evaluator 2` …). Neutral labels let you look at disagreement without
bias; use real names only if you want to.

No email goes out when you create a login. Send the evaluators the app link yourself: they type their email, get
a code by email, type it in, and they are signed in for a month. Ask them to do this **before the first skate**,
on the phone they will use at the rink. That first sign-in also stores the app on the phone so it opens even with
no signal.

A login only works for tryouts it has been added to. Logins you create here are added to the current tryout
automatically and show as **scoring**. Evaluators from a previous season show as **not added** until you click
*Add to tryout*. The line above the table tells you how many people can currently score.

### 8. Brief the evaluators

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
F / D / G) and a grid of big buttons, one per player on the ice, showing the colour **worn in that session**, the
number and the position. The grid is split into one group per colour, labelled with the team in a scrimmage
("Red · Team 1"); each group header shows how many of them the evaluator has scored, and tapping it folds the
group away, which is handy when an evaluator is assigned to one team. Players with the AA tag carry a small AA
badge. Absent and not-dressed players do not appear at all.

Tapping a player slides up a scoring sheet:

- the code as worn tonight, big, with the team and the player's usual code underneath when they differ;
- one row per criterion for that position, with five big buttons `1 2 3 4 5` (tap the criterion name, or press and
  hold a number, to see what it means);
- tier buttons A / B / C / X;
- a short notes box (280 characters, "What did you see? (no names)");
- *Save & Next* jumps to the next unscored player in the current filter, *Save & Close* returns to the grid,
  *Clear* wipes that player for this session.

Every tap is saved on the phone immediately. Nothing is lost if the phone locks or the Wi-Fi drops. The bottom
line shows progress: "14 of 38 scored this session · 2 absent · 6 not dressed". Scored players get a green border,
a check mark and their tier letter.

Evaluators can only ever see their own scores. They cannot see other evaluators, combined rankings or the
convenor pages. If they re-score a player in the same session, the new scores replace the old ones.

### Stopping an evaluator

If an evaluator drops out, or you want to be sure nobody adds scores after the last skate, click **Disable**
next to their label on the Evaluators tab. From that moment the server refuses their scores, including anything
still queued on their phone, and their screen goes read-only with a note to ask the convenor. Their existing
scores are kept and still count. *Enable* reverses it. You do not need to delete anything.

### The sync dot

- **Green "Synced"**: everything is on the server.
- **Amber "3 queued"**: saved on the phone, waiting for a connection. Normal at rinks.
- **Red "Offline"**: no connection at all. Keep scoring; it will catch up.
- **Red "Sign in again"**: their login expired (after about a month). Scores are safe; sign in again and they sync.
- **Red "rejected"**: the server refused something: the tryout was closed, the evaluator was disabled, or the
  player was marked absent or not dressed for that session. Tapping the dot shows why.

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
| Player / Pos | player code (with the AA badge if tagged) and position |
| Sessions | ice times the player was on the ice for, out of the total (absent and not-dressed sessions do not count) |
| Evals | how many evaluator-sessions scored this player |
| Overall | weighted average of the scored criteria (skating, hockey sense and compete count 1.5×, coachability 0.5×), averaged across evaluations |
| Spread | how much evaluators disagree on this player: the standard deviation of each evaluator's overall. Rows at 0.75 or more are highlighted |
| A B C X | how many evaluators gave each tier |
| Skating … Offensive Play | average score per criterion; `–` means not applicable to that position |

A player's overall is the **average** of the evaluations they actually received, so missing sessions never lowers
their number. It just gives you fewer data points: read Sessions and Evals together. Two players with the same
overall at 2/5 and 5/5 sessions are not equally well known.

Filter by **Session** (one skate or all combined) and **Position**, or tick **AA only**. Click any column heading
to sort. Two more toggles:

- **Equal weights** scores every criterion the same instead of using the rubric weights. Handy as a sanity check.
- **Normalise evaluators** adjusts for a consistently harsh or generous evaluator by re-centring each evaluator's
  scores on the group average before combining them. It only kicks in for evaluators with at least three scores.

### Highlighted rows

A highlighted spread means the evaluators saw different players or different things. That is information, not a
fault: those are the players to assign to specific evaluators for a second look, or to discuss with the numbers
in front of you.

### Evaluators

Below the logins, the **Evaluators** tab shows every evaluator's average and spread next to the group's, with a
tendency note (harsh, generous, in line, narrow range) and a full list of their scores and notes, including what
each player was wearing when scored. Use it to:

- spot an evaluator who scored everyone 3 or 4 (narrow range: their scores separate nobody);
- check nobody wrote identifying notes; if someone did, ask them to fix it and edit it out of your export;
- remove a conflict-of-interest pair from your thinking (their score for that one player) before finalising.

---

## Exporting

**Export** tab:

- *Download rankings CSV*: one row per player with whatever session, position and toggles are set on the
  Rankings tab, including the AA tag and sessions attended. The first line records those settings.
- *Download raw CSV*: every score, tier and note, one row per evaluator × session × player, with the code the
  player was wearing in that session (`worn_as`).
- *Upload … to S3*: also stores a copy in the association's private storage bucket, in case you want a record that
  does not live on a laptop.

Both files contain player codes only. Match them to names with the registrar's list **after** the ranking is
agreed, and keep that combined file off shared drives.

---

## After the tryout

1. Export both CSVs and keep them somewhere safe.
2. **Close tryout** tab → *Close tryout*. Scoring stops for everyone; evaluators can still open the app and see
   their own scores, read-only. This cannot be undone from the app.
3. Once the team is announced, go to **Evaluators** and click *Disable* (keeps the login for next season) or
   *Delete login* for each evaluator. Their scores stay in the records, identified only by an internal id.
4. Tell the registrar to file or shred the number-to-name list according to your association's policy.

Next season, create a new tryout on the Setup tab. Nobody can score it until you add evaluators to it, so old
logins cannot create stray evaluations. Old tryouts stay in storage but are no longer shown.

---

## If something goes wrong

- **An evaluator cannot sign in**: check they are using exactly the email you entered, and that the code email
  did not land in spam. Codes expire after a few minutes; *Send a new code* gets a fresh one. If nothing arrives,
  delete and recreate their login on the Evaluators tab (their old scores are kept).
- **An evaluator sees "not on the evaluator list"**: on the Evaluators tab, click *Add to tryout* or *Enable*
  next to their label, then have them reload.
- **An evaluator cannot see a player**: the player is absent or not dressed for that session. Check *Attendance
  & jerseys* for the session, and the team or group on the session row. Reloading the evaluator screen picks up
  the change.
- **The grid shows the wrong colours for a session**: for a scrimmage, check the team colours on the session row;
  for a skills night, the bulk row or the per-player dropdowns in *Attendance & jerseys*. Nothing about the scores
  changes when colours do.
- **An ice time moved**: change the date on the session row. Evaluators see it in their picker on reload.
- **A player has the wrong position**: change it on their row in the Players table. Wrong number: *Delete* the
  player if nobody has scored them yet, otherwise *Release* them, and add the correct one.
- **Two colours start with the same letter**: the app blocks it. Rename one colour (e.g. `Dark` for black).
- **An evaluator's phone died mid-skate**: their scores up to that moment are on the phone and will sync when it
  is back on and connected, even days later. They can also switch phones and keep scoring; the two devices'
  scores combine per player (the most recent save wins).
- **The dot stays red after the Wi-Fi is back**: tap it. "Sign in again" means the login expired; "rejected" shows
  the reason (a closed tryout, a disabled evaluator, or a player marked absent or not dressed).
