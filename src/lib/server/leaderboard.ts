import "server-only";
import { db } from "./db";
import { isUniqueViolation } from "./http";

const GAME = "tictactoe";

export interface RoundResult {
  nickname: string;
  won: boolean;
}

/** player_key of the shared hub leaderboard: nickname, trimmed and lowercase (no accounts exist). */
export function playerKey(nickname: string): string {
  return nickname.trim().toLowerCase();
}

/**
 * Reports a finished round to the hub's shared leaderboard (hub_leaderboard / hub_leaderboard_rounds,
 * written with the service key like hub_feedback). Idempotent: the round row is claimed first, so a
 * round (room code + round number) is counted once even if two requests race. Best effort: a failure
 * is logged and never breaks the game.
 */
export async function reportRound(roomCode: string, round: number, results: RoundResult[]): Promise<void> {
  try {
    const claim = await db().from("hub_leaderboard_rounds").insert({ game: GAME, room_code: roomCode, round_no: round });
    if (isUniqueViolation(claim.error)) return; // already counted
    if (claim.error) throw claim.error;

    for (const r of results) {
      const key = playerKey(r.nickname);
      if (!key) continue;
      const { data, error } = await db().from("hub_leaderboard").select("wins, games").eq("game", GAME).eq("player_key", key).maybeSingle();
      if (error) throw error;
      const { error: upsertError } = await db()
        .from("hub_leaderboard")
        .upsert(
          {
            game: GAME,
            player_key: key,
            display_name: r.nickname.trim().slice(0, 40),
            wins: ((data?.wins as number | undefined) ?? 0) + (r.won ? 1 : 0),
            games: ((data?.games as number | undefined) ?? 0) + 1,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "game,player_key" },
        );
      if (upsertError) throw upsertError;
    }
  } catch (err) {
    console.error("leaderboard report failed", err);
  }
}
