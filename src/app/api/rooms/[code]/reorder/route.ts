import { isPermutation, starterFromOrder } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { listPlayers, requireHost, requireMember, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/reorder  { order: [playerId, ...] } - host only, in the lobby or between rounds (never mid-round).
// `order` must list every member exactly once. In a 2-player game the order only decides who starts: the seated
// player who comes first becomes X (moves first) in the next round. Spectator positions are not stored.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/reorder">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    if (room.status === "playing") fail(409, "Ordinea nu se poate schimba în timpul rundei.");

    const body = await readJson(req);
    const players = await listPlayers(room.id);
    if (!isPermutation(body.order, players.map((p) => p.id))) {
      fail(400, "Ordinea trebuie să conțină fiecare jucător exact o dată.");
    }
    const starter = starterFromOrder(body.order, { x: room.x_player_id, o: room.o_player_id });

    const { data, error } = await db()
      .from("xand0_rooms")
      .update({ starter_player_id: starter, version: room.version + 1 })
      .eq("id", room.id)
      .eq("version", room.version)
      .neq("status", "playing")
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) fail(409, "Camera s-a schimbat între timp. Mai încearcă.");

    await touchRoom(room.id);
    await notifyRoom(room.id, "reorder");
    return { ok: true };
  });
}
