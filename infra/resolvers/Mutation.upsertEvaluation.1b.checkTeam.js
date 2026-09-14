// Step 1b: when the session lists teams, the player must be on one of them (rosters are read live).
import { util, runtime } from "@aws-appsync/utils";
import { TABLE_NAME, tryoutPK, teamSK, failOnError } from "./shared.js";

export function request(ctx) {
  const teams = ctx.stash.sessionTeams || [];
  if (teams.length === 0) return runtime.earlyReturn(null); // no teams: everyone plays
  const pk = tryoutPK(ctx.args.tryoutId);
  return {
    operation: "BatchGetItem",
    tables: {
      [TABLE_NAME]: { keys: teams.map((t) => util.dynamodb.toMapValues({ PK: pk, SK: teamSK(t.teamId) })), consistentRead: true },
    },
  };
}

export function response(ctx) {
  failOnError(ctx);
  const rows = (ctx.result.data && ctx.result.data[TABLE_NAME]) || [];
  const playerNumber = ctx.args.playerNumber;
  let onIce = false;
  for (const r of rows) {
    if (r && r.players && r.players.includes(playerNumber)) onIce = true;
  }
  if (!onIce) util.error("Player is not on a team for this session", "NotPlaying");
  return true;
}
