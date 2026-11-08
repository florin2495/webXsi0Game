import { notifyRoom } from "@/lib/server/broadcast";
import { db } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { requireMember, roleOf, settleSeats } from "@/lib/server/room";

// POST /api/rooms/[code]/queue - a spectator toggles "Intră la runda următoare". At the next round the queued
// spectators take the free seats in queue order; the others keep watching.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/queue">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (roleOf(room, player.id) !== "spectator") fail(409, "Ești deja jucător în runda asta.");

    const queued = player.queued_at === null;
    const { error } = await db()
      .from("xand0_players")
      .update({ queued_at: queued ? new Date().toISOString() : null })
      .eq("id", player.id);
    if (error) throw error;

    if (room.status === "waiting") await settleSeats(room.id);
    await notifyRoom(room.id, "queue");
    return { ok: true, queued };
  });
}
