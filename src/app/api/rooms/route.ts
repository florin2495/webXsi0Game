import { connection } from "next/server";
import { MAX_MEMBERS, NICKNAME_MAX } from "@/lib/game";
import { hashPassword, hashToken, newPlayerToken, newRoomCode } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { cleanupExpiredRooms } from "@/lib/server/room";
import type { RoomListItem, RoomStatus } from "@/lib/types";

// GET /api/rooms - public list of rooms that still have room for someone (player or spectator).
export async function GET() {
  await connection(); // always request-time, never prerendered at build
  return handle(async () => {
    await cleanupExpiredRooms();
    const { data, error } = await db()
      .from("xo_rooms")
      .select("code, name, status, password_hash, x_player_id, o_player_id, last_activity_at, xo_players!xo_players_room_id_fkey(count)")
      .order("last_activity_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const rooms: RoomListItem[] = (data ?? [])
      .map((r) => {
        const members = (r.xo_players as unknown as { count: number }[])[0]?.count ?? 0;
        return {
          code: r.code as string,
          name: r.name as string,
          status: r.status as RoomStatus,
          hasPassword: r.password_hash !== null,
          members,
          seatFree: r.status === "waiting" && (!r.x_player_id || !r.o_player_id),
        };
      })
      .filter((r) => r.members < MAX_MEMBERS);
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
        .from("xo_rooms")
        .insert({ code: newRoomCode(), name, password_hash: passwordHash })
        .select("id, code")
        .single();
      if (error && !isUniqueViolation(error)) throw error;
      room = data;
    }
    if (!room) fail(503, "Nu am putut genera un cod de cameră. Încearcă din nou.");

    const token = newPlayerToken();
    const { data: player, error: playerError } = await db()
      .from("xo_players")
      .insert({ room_id: room.id, nickname, token_hash: hashToken(token), is_host: true })
      .select("id")
      .single();
    if (playerError) throw playerError;

    const { error: hostError } = await db()
      .from("xo_rooms")
      .update({ host_player_id: player.id, x_player_id: player.id })
      .eq("id", room.id);
    if (hostError) throw hostError;

    return { code: room.code, playerId: player.id, token };
  });
}
