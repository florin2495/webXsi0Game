import { connection } from "next/server";
import { NICKNAME_MAX } from "@/lib/game";
import { hashDeviceId, hashPassword, hashToken, newPlayerToken, newRoomCode } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { cleanupAbandonedRooms, cleanupExpiredRooms } from "@/lib/server/room";
import type { RoomListItem, RoomStatus } from "@/lib/types";

// GET /api/rooms - public list of all open rooms (lobby and in-game), so newcomers can join or watch.
// Loading the list ("Intră în cameră") first sweeps abandoned rooms: no member seen and no activity for 120 s.
export async function GET() {
  await connection(); // always request-time, never prerendered at build
  return handle(async () => {
    await Promise.all([cleanupExpiredRooms(), cleanupAbandonedRooms()]);
    const { data, error } = await db()
      .from("xand0_rooms")
      .select("code, name, status, password_hash, x_player_id, o_player_id, last_activity_at, xand0_players!xand0_players_room_id_fkey(count)")
      .order("last_activity_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const rooms: RoomListItem[] = (data ?? [])
      .map((r) => {
        const members = (r.xand0_players as unknown as { count: number }[])[0]?.count ?? 0;
        const seated = (r.x_player_id ? 1 : 0) + (r.o_player_id ? 1 : 0);
        return {
          code: r.code as string,
          name: r.name as string,
          status: r.status as RoomStatus,
          hasPassword: r.password_hash !== null,
          members,
          players: seated,
          seatFree: r.status === "waiting" && (!r.x_player_id || !r.o_player_id),
        };
      });
    return { rooms };
  });
}

// POST /api/rooms - create a room; the creator is the host and takes the X seat.
export async function POST(req: Request) {
  return handle(async () => {
    await cleanupExpiredRooms();
    const body = await readJson(req);
    const name = cleanText(body.name, "Numele camerei", 1, 40);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);

    let passwordHash: string | null = null;
    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length > 100) fail(400, "Parola e prea lungă.");
      passwordHash = await hashPassword(body.password);
    }

    let room: { id: string; code: string } | null = null;
    for (let attempt = 0; attempt < 5 && !room; attempt++) {
      const { data, error } = await db()
        .from("xand0_rooms")
        .insert({ code: newRoomCode(), name, password_hash: passwordHash })
        .select("id, code")
        .single();
      if (error && !isUniqueViolation(error)) throw error;
      room = data;
    }
    if (!room) fail(503, "Nu am putut genera un cod de cameră. Încearcă din nou.");

    const token = newPlayerToken();
    const { data: player, error: playerError } = await db()
      .from("xand0_players")
      .insert({ room_id: room.id, nickname, token_hash: hashToken(token), device_hash: hashDeviceId(body.deviceId), is_host: true })
      .select("id")
      .single();
    if (playerError) throw playerError;

    const { error: hostError } = await db()
      .from("xand0_rooms")
      .update({ host_player_id: player.id, x_player_id: player.id })
      .eq("id", room.id);
    if (hostError) throw hostError;

    return { code: room.code, playerId: player.id, token };
  });
}
