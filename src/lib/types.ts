import type { Mark, Winner } from "./game";

export type RoomStatus = "waiting" | "playing" | "finished";
export type Role = Mark | "spectator";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  role: Role;
  wins: number;
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
  /** True when a newcomer would get a seat instead of watching. */
  seatFree: boolean;
}

export interface Session {
  playerId: string;
  token: string;
}
