import { db } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { notifyRoom } from "@/lib/server/broadcast";
import { removePlayer } from "@/lib/server/membership";
import { requireHost, requireMember, roleOf } from "@/lib/server/room";

// POST /api/rooms/[code]/kick  { playerId } - host removes another player (any status).
// Not a ban: identity is a browser token, so a kicked player could rejoin a lobby under a
// new nickname. A room password is the real access control.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/kick">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);

    const body = await readJson(req);
    const targetId = typeof body.playerId === "string" ? body.playerId : "";
    if (targetId === player.id) fail(400, "Nu te poți scoate singur. Folosește „Părăsește camera”.");

    const { data: target, error } = await db()
      .from("xand0_players")
      .select("id")
      .eq("id", targetId)
      .eq("room_id", room.id)
      .maybeSingle();
    if (error && error.code !== "22P02") throw error; // 22P02 = malformed uuid
    if (!target) fail(404, "Jucătorul nu mai e în cameră.");

    // A seated player in a running round gets 10 s to press "Ignoră"; spectators (and any other
    // status) are removed at once, as before. A second kick on a pending player is a no-op.
    if (room.status === "playing" && roleOf(room, targetId) !== "spectator") {
      const { error: pendingError } = await db()
        .from("xand0_players")
        .update({ kick_requested_at: new Date().toISOString() })
        .eq("id", targetId)
        .is("kick_requested_at", null);
      if (pendingError) throw pendingError;
      await notifyRoom(room.id, "kick_pending");
      return { ok: true, pending: true };
    }

    await removePlayer(room, targetId, "player_kicked");
    return { ok: true };
  });
}
