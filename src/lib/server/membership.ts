import "server-only";
import { notifyRoom } from "./broadcast";
import { db, type RoomRow } from "./db";
import { addWin, listPlayers, roleOf, settleSeats } from "./room";

/**
 * Removes a member from a room (used by both "leave" and the host's "kick").
 *  - last member out: the room is deleted
 *  - host removed: host passes to the next member in join order
 *  - a seated player removed mid-round: the opponent wins by forfeit; the empty seat is filled
 *    from the spectators at the next round
 *  - a seated player removed while waiting: a spectator (if any) takes the seat right away
 */
export async function removePlayer(room: RoomRow, playerId: string, reason: string): Promise<{ roomClosed: boolean }> {
  const now = new Date().toISOString();
  const remaining = (await listPlayers(room.id)).filter((p) => p.id !== playerId);

  if (remaining.length === 0) {
    const { error } = await db().from("xand0_rooms").delete().eq("id", room.id);
    if (error) throw error;
    return { roomClosed: true };
  }

  const newHostId = room.host_player_id === playerId ? remaining[0].id : room.host_player_id;
  const update: Record<string, unknown> = {
    host_player_id: newHostId,
    version: room.version + 1,
    updated_at: now,
    last_activity_at: now,
  };

  const role = roleOf(room, playerId);
  let forfeitWinnerId: string | null = null;
  if (role !== "spectator") {
    update[role === "X" ? "x_player_id" : "o_player_id"] = null;
    if (room.status === "playing") {
      const opponentMark = role === "X" ? "O" : "X";
      forfeitWinnerId = role === "X" ? room.o_player_id : room.x_player_id;
      Object.assign(update, { status: "finished", winner: opponentMark, win_line: null, forfeit: true });
    }
  }

  // Update the room first so the host / seats never point at a deleted player.
  const { error: roomError } = await db().from("xand0_rooms").update(update).eq("id", room.id);
  if (roomError) throw roomError;
  await addWin(forfeitWinnerId);

  if (newHostId && newHostId !== room.host_player_id) {
    const { error } = await db().from("xand0_players").update({ is_host: true }).eq("id", newHostId);
    if (error) throw error;
  }

  const { error: deleteError } = await db().from("xand0_players").delete().eq("id", playerId);
  if (deleteError) throw deleteError;

  if (room.status === "waiting") await settleSeats(room.id);

  await notifyRoom(room.id, reason);
  return { roomClosed: false };
}
