import "server-only";
import {
  EMPTY_BOARD,
  fillSeats,
  isRoomExpired,
  minutesLabel,
  PLAYING_IDLE_MINUTES,
  ROOM_IDLE_MINUTES,
  turnOf,
} from "@/lib/game";
import type { PublicPlayer, Role, RoomState } from "@/lib/types";
import { hashToken } from "./crypto";
import { db, PLAYER_COLUMNS, ROOM_COLUMNS, type PlayerRow, type RoomRow } from "./db";
import { fail } from "./http";

const GONE = `Camera nu există sau a fost închisă după ${minutesLabel(ROOM_IDLE_MINUTES)} de inactivitate.`;

export function normalizeCode(code: string): string {
  const c = decodeURIComponent(code).trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) fail(404, GONE);
  return c;
}

export async function getRoomByCode(code: string): Promise<RoomRow> {
  const { data, error } = await db().from("xo_rooms").select(ROOM_COLUMNS).eq("code", normalizeCode(code)).maybeSingle();
  if (error) throw error;
  if (!data) fail(404, GONE);
  const room = data as RoomRow;
  // Lazy expiry: Vercel Hobby has no frequent cron, so idle rooms are closed when touched.
  if (isRoomExpired(room.status, room.last_activity_at)) {
    await db().from("xo_rooms").delete().eq("id", room.id).eq("last_activity_at", room.last_activity_at);
    fail(404, GONE);
  }
  return room;
}

async function getRoomById(id: string): Promise<RoomRow | null> {
  const { data, error } = await db().from("xo_rooms").select(ROOM_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as RoomRow | null) ?? null;
}

/** Deletes idle rooms: waiting/finished after ROOM_IDLE_MINUTES, playing after PLAYING_IDLE_MINUTES. */
export async function cleanupExpiredRooms(): Promise<void> {
  const cutoff = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const [idle, stale] = await Promise.all([
    db().from("xo_rooms").delete().in("status", ["waiting", "finished"]).lt("last_activity_at", cutoff(ROOM_IDLE_MINUTES)),
    db().from("xo_rooms").delete().eq("status", "playing").lt("last_activity_at", cutoff(PLAYING_IDLE_MINUTES)),
  ]);
  if (idle.error) console.error("cleanup failed", idle.error);
  if (stale.error) console.error("cleanup failed", stale.error);
}

/** Records activity on a room, restarting its idle timer. */
export async function touchRoom(roomId: string): Promise<void> {
  const { error } = await db().from("xo_rooms").update({ last_activity_at: new Date().toISOString() }).eq("id", roomId);
  if (error) throw error;
}

/**
 * Resolves the caller from the x-player-token header and checks they belong to the room.
 * Every member-only route goes through here.
 */
export async function requireMember(req: Request, code: string): Promise<{ room: RoomRow; player: PlayerRow }> {
  const token = req.headers.get("x-player-token");
  if (!token || token.length > 200) fail(401, "Nu ești în această cameră.");
  const room = await getRoomByCode(code);
  const { data, error } = await db()
    .from("xo_players")
    .select(PLAYER_COLUMNS)
    .eq("token_hash", hashToken(token))
    .eq("room_id", room.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) fail(401, "Nu ești în această cameră.");
  return { room, player: data as PlayerRow };
}

export function requireHost(room: RoomRow, player: PlayerRow) {
  if (room.host_player_id !== player.id) fail(403, "Doar host-ul camerei poate face asta.");
}

export function requireStatus(room: RoomRow, ...allowed: RoomRow["status"][]) {
  if (!allowed.includes(room.status)) {
    const msg: Record<RoomRow["status"], string> = {
      waiting: "Jocul nu a început încă: se așteaptă al doilea jucător.",
      playing: "Runda e în desfășurare.",
      finished: "Runda s-a terminat.",
    };
    fail(409, msg[room.status]);
  }
}

export function roleOf(room: RoomRow, playerId: string): Role {
  if (room.x_player_id === playerId) return "X";
  if (room.o_player_id === playerId) return "O";
  return "spectator";
}

export async function listPlayers(roomId: string): Promise<PlayerRow[]> {
  const { data, error } = await db()
    .from("xo_players")
    .select(PLAYER_COLUMNS)
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlayerRow[];
}

/** Adds 1 to a player's win count (only one request can finish a round, see the move route). */
export async function addWin(playerId: string | null): Promise<void> {
  if (!playerId) return;
  const { data, error } = await db().from("xo_players").select("wins").eq("id", playerId).maybeSingle();
  if (error) throw error;
  if (!data) return;
  const { error: updateError } = await db()
    .from("xo_players")
    .update({ wins: (data.wins as number) + 1 })
    .eq("id", playerId);
  if (updateError) throw updateError;
}

/**
 * While a room is waiting for players, seats empty places from the room's members in join order
 * and starts the round as soon as both X and O are taken. Rooms that are playing or finished are
 * left alone (spectators move up only at the next round). Version-checked, retried on conflict.
 */
export async function settleSeats(roomId: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const room = await getRoomById(roomId);
    if (!room || room.status !== "waiting") return;
    const players = await listPlayers(roomId);
    const seats = fillSeats({ x: room.x_player_id, o: room.o_player_id }, players.map((p) => p.id));
    const start = Boolean(seats.x && seats.o);
    if (!start && seats.x === room.x_player_id && seats.o === room.o_player_id) return;

    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      x_player_id: seats.x,
      o_player_id: seats.o,
      version: room.version + 1,
      updated_at: now,
      last_activity_at: now,
    };
    if (start) Object.assign(update, { status: "playing", board: EMPTY_BOARD, winner: null, win_line: null, forfeit: false });

    const { data, error } = await db()
      .from("xo_rooms")
      .update(update)
      .eq("id", roomId)
      .eq("version", room.version)
      .select("id");
    if (error) throw error;
    if (data && data.length > 0) return;
  }
}

export async function buildState(room: RoomRow, me: PlayerRow): Promise<RoomState> {
  const players = await listPlayers(room.id);
  const toPublic = (p: PlayerRow): PublicPlayer => ({
    id: p.id,
    nickname: p.nickname,
    isHost: p.id === room.host_player_id,
    role: roleOf(room, p.id),
    wins: p.wins,
  });
  const rank = (p: PublicPlayer) => (p.role === "X" ? 0 : p.role === "O" ? 1 : 2);
  // Array.prototype.sort is stable, so spectators keep their join order.
  const ordered = players.map(toPublic).sort((a, b) => rank(a) - rank(b));

  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      status: room.status,
      round: room.round,
      hasPassword: room.password_hash !== null,
      hostPlayerId: room.host_player_id,
      board: room.board,
      xPlayerId: room.x_player_id,
      oPlayerId: room.o_player_id,
      turn: room.status === "playing" ? turnOf(room.board) : null,
      winner: room.winner,
      winLine: room.win_line,
      forfeit: room.forfeit,
      draws: room.draws,
      version: room.version,
    },
    players: ordered,
    me: toPublic(me),
  };
}
