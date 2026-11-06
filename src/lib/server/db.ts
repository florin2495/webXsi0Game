import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Winner } from "@/lib/game";
import type { RoomStatus } from "@/lib/types";

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS - must never be imported from client code. */
export function db(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  password_hash: string | null;
  status: RoomStatus;
  round: number;
  board: string;
  x_player_id: string | null;
  o_player_id: string | null;
  winner: Winner | null;
  win_line: number[] | null;
  forfeit: boolean;
  draws: number;
  host_player_id: string | null;
  version: number;
  last_activity_at: string;
}

export const ROOM_COLUMNS =
  "id, code, name, password_hash, status, round, board, x_player_id, o_player_id, winner, win_line, forfeit, draws, host_player_id, version, last_activity_at";

export interface PlayerRow {
  id: string;
  room_id: string;
  nickname: string;
  is_host: boolean;
  wins: number;
  joined_at: string;
}

export const PLAYER_COLUMNS = "id, room_id, nickname, is_host, wins, joined_at";
