import type { Mark, Winner } from "./game";

export type RoomStatus = "waiting" | "playing" | "finished";
export type Role = Mark | "spectator";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  role: Role;
  wins: number;
  /** Spectator who asked to play next round ("Intră la runda următoare"). */
  queued: boolean;
  /** 1-based place in the queue, null when not queued. */
  queuePosition: number | null;
  /** Ms left of a pending kick (host kicked this player mid-round), null when none. */
  kickRemainingMs: number | null;
  /** Seen in the last 301 s (see lib/reconnect.ts). False = phone in the background, closed tab, no network. */
  connected: boolean;
}

/** What GET /api/rooms/[code]/state returns to a member. Nothing in it is secret. */
export interface RoomState {
  room: {
    id: string;
    code: string;
    name: string;
    status: RoomStatus;
    round: number;
    hasPassword: boolean;
    hostPlayerId: string | null;
    board: string;
    xPlayerId: string | null;
    oPlayerId: string | null;
    /** Mark to move while playing, null otherwise. */
    turn: Mark | null;
    winner: Winner | null;
    winLine: number[] | null;
    forfeit: boolean;
    /** Host-chosen X (who starts) of the next round, null = default (the two swap). */
    starterPlayerId: string | null;
    draws: number;
    /** Changes on every move / seat change; the client uses it to drop stale optimistic moves. */
    version: number;
  };
  /** Seated players first (X, O), then spectators in join order. */
  players: PublicPlayer[];
  me: PublicPlayer;
}

/** Item of the public room list (GET /api/rooms). */
export interface RoomListItem {
  code: string;
  name: string;
  status: RoomStatus;
  hasPassword: boolean;
  members: number;
  /** Seated players (X/O), 0-2. */
  players: number;
  /** True when a newcomer would get a seat instead of watching. */
  seatFree: boolean;
}

export interface Session {
  playerId: string;
  token: string;
}
