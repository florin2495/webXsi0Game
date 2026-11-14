import "server-only";
import {
  EMPTY_BOARD,
  isRoomAbandoned,
  isRoomExpired,
  minutesLabel,
  PLAYING_IDLE_MINUTES,
  ROOM_ABANDONED_MS,
  ROOM_IDLE_MINUTES,
  turnOf,
  waitingSeats,
} from "@/lib/game";
import { kickRemainingMs } from "@/lib/kick";
import { isConnected, LAST_SEEN_TOUCH_MS } from "@/lib/reconnect";
import type { PublicPlayer, Role, RoomState } from "@/lib/types";
import { hashToken } from "./crypto";
import { db, PLAYER_COLUMNS, ROOM_COLUMNS, type PlayerRow, type RoomRow } from "./db";
import { fail } from "./http";
import { enforceExpiredKicks } from "./membership";

const GONE = `Camera nu există sau a fost închisă după ${minutesLabel(ROOM_IDLE_MINUTES)} de inactivitate.`;

export function normalizeCode(code: string): string {
  const c = decodeURIComponent(code).trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) fail(404, GONE);
  return c;
}

export async function getRoomByCode(code: string): Promise<RoomRow> {
  const { data, error } = await db().from("xand0_rooms").select(ROOM_COLUMNS).eq("code", normalizeCode(code)).maybeSingle();
  if (error) throw error;
  if (!data) fail(404, GONE);
  const room = data as RoomRow;
  // Lazy expiry: Vercel Hobby has no frequent cron, so idle rooms are closed when touched.
  if (isRoomExpired(room.status, room.last_activity_at)) {
    await db().from("xand0_rooms").delete().eq("id", room.id).eq("last_activity_at", room.last_activity_at);
    fail(404, GONE);
  }
  return room;
}

async function getRoomById(id: string): Promise<RoomRow | null> {
  const { data, error } = await db().from("xand0_rooms").select(ROOM_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as RoomRow | null) ?? null;
}

/** Deletes idle rooms: waiting/finished after ROOM_IDLE_MINUTES, playing after PLAYING_IDLE_MINUTES. */
export async function cleanupExpiredRooms(): Promise<void> {
  const cutoff = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const [idle, stale] = await Promise.all([
    db().from("xand0_rooms").delete().in("status", ["waiting", "finished"]).lt("last_activity_at", cutoff(ROOM_IDLE_MINUTES)),
    db().from("xand0_rooms").delete().eq("status", "playing").lt("last_activity_at", cutoff(PLAYING_IDLE_MINUTES)),
  ]);
  if (idle.error) console.error("cleanup failed", idle.error);
  if (stale.error) console.error("cleanup failed", stale.error);
}

/**
 * Deletes rooms in ANY status (waiting, playing, finished) with no activity for ROOM_ABANDONED_MS and no
 * member (players and spectators are both xand0_players rows) seen within it, see isRoomAbandoned.
 * Players cascade with the room. Best effort: a failure is logged, never thrown.
 */
export async function cleanupAbandonedRooms(): Promise<void> {
  try {
    const now = Date.now();
    const cutoff = new Date(now - ROOM_ABANDONED_MS).toISOString();
    const { data, error } = await db()
      .from("xand0_rooms")
      .select("id, last_activity_at, xand0_players!xand0_players_room_id_fkey(last_seen_at)")
      .lt("last_activity_at", cutoff)
      .limit(200);
    if (error) {
      console.error("abandoned cleanup (select) failed", error);
      return;
    }
    const ids = (data ?? [])
      .filter((r) => {
        const members = (r.xand0_players as unknown as { last_seen_at: string | null }[] | null) ?? [];
        return isRoomAbandoned(r.last_activity_at as string, members.map((m) => m.last_seen_at), now);
      })
      .map((r) => r.id as string);
    if (ids.length === 0) return;
    // Re-check the activity cutoff in the delete itself, so a room touched meanwhile survives.
    const { error: delError } = await db().from("xand0_rooms").delete().in("id", ids).lt("last_activity_at", cutoff);
    if (delError) console.error("abandoned cleanup (delete) failed", delError);
  } catch (err) {
    console.error("abandoned cleanup failed", err);
  }
}

/** Records activity on a room, restarting its idle timer. */
export async function touchRoom(roomId: string): Promise<void> {
  const { error } = await db().from("xand0_rooms").update({ last_activity_at: new Date().toISOString() }).eq("id", roomId);
  if (error) throw error;
}

/**
 * Resolves the caller from the x-player-token header and checks they belong to the room.
 * Every member-only route goes through here.
 */
export async function requireMember(req: Request, code: string): Promise<{ room: RoomRow; player: PlayerRow }> {
  const token = req.headers.get("x-player-token");
  if (!token || token.length > 200) fail(401, "Nu ești în această cameră.");
  let room = await getRoomByCode(code);
  // Lazy enforcement of pending kicks (no timers on serverless); may remove the caller -> 401 below.
  if (await enforceExpiredKicks(room)) room = await getRoomByCode(code);
  const { data, error } = await db()
    .from("xand0_players")
    .select(PLAYER_COLUMNS)
    .eq("token_hash", hashToken(token))
    .eq("room_id", room.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) fail(401, "Nu ești în această cameră.");
  const player = data as PlayerRow;
  await touchPlayer(player);
  return { room, player };
}

/** Presence heartbeat: stamps last_seen_at at most every LAST_SEEN_TOUCH_MS. Best effort, never throws. */
async function touchPlayer(player: PlayerRow): Promise<void> {
  const now = Date.now();
  if (now - Date.parse(player.last_seen_at) < LAST_SEEN_TOUCH_MS) return;
  player.last_seen_at = new Date(now).toISOString();
  const { error } = await db().from("xand0_players").update({ last_seen_at: player.last_seen_at }).eq("id", player.id);
  if (error) console.error("presence touch failed", error);
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
    .from("xand0_players")
    .select(PLAYER_COLUMNS)
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlayerRow[];
}

/** Queued spectators (ids), first in line first. */
export function queueOf(players: PlayerRow[]): string[] {
  return players
    .filter((p) => p.queued_at !== null)
    .sort((a, b) => Date.parse(a.queued_at as string) - Date.parse(b.queued_at as string))
    .map((p) => p.id);
}

/** Seated players leave the queue. */
export async function clearQueued(roomId: string, seatedIds: (string | null)[]): Promise<void> {
  const ids = seatedIds.filter((id): id is string => id !== null);
  if (ids.length === 0) return;
  const { error } = await db().from("xand0_players").update({ queued_at: null }).eq("room_id", roomId).in("id", ids).not("queued_at", "is", null);
  if (error) throw error;
}

/** A new round starts: drop every pending kick in the room. */
export async function clearPendingKicks(roomId: string): Promise<void> {
  const { error } = await db()
    .from("xand0_players")
    .update({ kick_requested_at: null })
    .eq("room_id", roomId)
    .not("kick_requested_at", "is", null);
  if (error) throw error;
}

/** Adds 1 to a player's win count (only one request can finish a round, see the move route). */
export async function addWin(playerId: string | null): Promise<void> {
  if (!playerId) return;
  const { data, error } = await db().from("xand0_players").select("wins").eq("id", playerId).maybeSingle();
  if (error) throw error;
  if (!data) return;
  const { error: updateError } = await db()
    .from("xand0_players")
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
    const seats = waitingSeats(
      { x: room.x_player_id, o: room.o_player_id },
      room.starter_player_id,
      players.map((p) => p.id),
      queueOf(players),
    );
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
    if (start) Object.assign(update, { status: "playing", board: EMPTY_BOARD, winner: null, win_line: null, forfeit: false, starter_player_id: null });

    const { data, error } = await db()
      .from("xand0_rooms")
      .update(update)
      .eq("id", roomId)
      .eq("version", room.version)
      .select("id");
    if (error) throw error;
    if (data && data.length > 0) {
      if (start) await clearPendingKicks(roomId);
      await clearQueued(roomId, [seats.x, seats.o]);
      return;
    }
  }
}

export async function buildState(room: RoomRow, me: PlayerRow): Promise<RoomState> {
  const players = await listPlayers(room.id);
  const now = Date.now();
  const queue = queueOf(players);
  const toPublic = (p: PlayerRow): PublicPlayer => ({
    id: p.id,
    nickname: p.nickname,
    isHost: p.id === room.host_player_id,
    role: roleOf(room, p.id),
    wins: p.wins,
    queued: p.queued_at !== null && roleOf(room, p.id) === "spectator",
    queuePosition: p.queued_at !== null && roleOf(room, p.id) === "spectator" ? queue.indexOf(p.id) + 1 : null,
    kickRemainingMs: kickRemainingMs(p.kick_requested_at, now),
    connected: isConnected(p.last_seen_at, now),
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
      starterPlayerId: room.starter_player_id,
      draws: room.draws,
      version: room.version,
    },
    players: ordered,
    me: toPublic(me),
  };
}
