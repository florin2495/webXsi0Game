import { EMPTY_BOARD, fillSeats, swapSeats } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { clearPendingKicks, listPlayers, requireMember, requireStatus, roleOf } from "@/lib/server/room";

// POST /api/rooms/[code]/new-round - a seated player or the host, after a finished round.
// The players swap X and O (so the other one starts); an empty seat goes to the first spectator.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/new-round">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "finished");
    if (roleOf(room, player.id) === "spectator" && room.host_player_id !== player.id) {
      fail(403, "Doar jucătorii sau host-ul pot porni runda următoare.");
    }

    const players = await listPlayers(room.id);
    const seats = fillSeats(swapSeats({ x: room.x_player_id, o: room.o_player_id }), players.map((p) => p.id));
    const now = new Date().toISOString();

    const { data, error } = await db()
      .from("xand0_rooms")
      .update({
        status: seats.x && seats.o ? "playing" : "waiting",
        round: room.round + 1,
        board: EMPTY_BOARD,
        x_player_id: seats.x,
        o_player_id: seats.o,
        winner: null,
        win_line: null,
        forfeit: false,
        version: room.version + 1,
        updated_at: now,
        last_activity_at: now,
      })
      .eq("id", room.id)
      .eq("version", room.version)
      .eq("status", "finished")
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) fail(409, "Runda nouă a fost deja pornită.");

    await clearPendingKicks(room.id);
    await notifyRoom(room.id, "new_round");
    return { ok: true };
  });
}
