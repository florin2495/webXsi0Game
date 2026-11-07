import { isKickExpired } from "@/lib/kick";
import { notifyRoom } from "@/lib/server/broadcast";
import { db } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/kick/ignore - the kicked player refuses a pending kick and stays in the game.
// requireMember already removed everyone whose grace ran out (so an expired caller gets 401 there).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/kick/ignore">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    const requestedAt = player.kick_requested_at;
    if (!requestedAt) return { ok: true }; // nothing pending (already ignored)
    if (isKickExpired(requestedAt)) fail(409, "Prea târziu, ai fost scos.");

    const { data, error } = await db()
      .from("xand0_players")
      .update({ kick_requested_at: null })
      .eq("id", player.id)
      .eq("kick_requested_at", requestedAt)
      .select("id");
    if (error) throw error;
    if (data && data.length > 0) await notifyRoom(room.id, "kick_ignored");
    return { ok: true };
  });
}
