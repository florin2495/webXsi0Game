// Pure game rules - shared by server and client, no I/O.

export type Mark = "X" | "O";
export type Winner = Mark | "draw";

export const NICKNAME_MAX = 10;
/** 2 players + 2 spectators. */
export const MAX_MEMBERS = 4;
export const EMPTY_BOARD = ".........";

/**
 * Waiting/finished rooms are closed (deleted) after this long without activity. Every open room
 * page polls /state, which refreshes the timer (see PRESENCE_TOUCH_MS), so a room only closes
 * once nobody has it open.
 */
export const ROOM_IDLE_MINUTES = 10;
/** A game in progress that nobody has open is closed after this long. */
export const PLAYING_IDLE_MINUTES = 30;
/** /state refreshes last_activity_at at most this often, to keep DB writes low. */
export const PRESENCE_TOUCH_MS = 20_000;

/** "2 minute" / "30 de minute" (Romanian numeral agreement). */
export function minutesLabel(n: number): string {
  return `${n} ${n >= 20 ? "de " : ""}${n === 1 ? "minut" : "minute"}`;
}

export function isRoomExpired(status: string, lastActivityAt: string | Date, now = Date.now()): boolean {
  const limit = status === "playing" ? PLAYING_IDLE_MINUTES : ROOM_IDLE_MINUTES;
  return now - new Date(lastActivityAt).getTime() > limit * 60_000;
}

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function isBoard(board: unknown): board is string {
  return typeof board === "string" && /^[.XO]{9}$/.test(board);
}

/** X always moves first, so it is X's turn whenever both have placed the same number of marks. */
export function turnOf(board: string): Mark {
  let x = 0;
  let o = 0;
  for (const c of board) {
    if (c === "X") x++;
    else if (c === "O") o++;
  }
  return x === o ? "X" : "O";
}

/** Winner of a board (with the winning line), "draw" when full, null while still open. */
export function outcome(board: string): { winner: Winner; line: number[] | null } | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const m = board[a];
    if (m !== "." && m === board[b] && m === board[c]) return { winner: m as Mark, line: [...line] };
  }
  if (!board.includes(".")) return { winner: "draw", line: null };
  return null;
}

export type MoveResult = { ok: true; board: string; mark: Mark } | { ok: false; reason: string };

/** Places the next mark at `cell` if it is legal for `mark`. */
export function applyMove(board: string, cell: number, mark: Mark): MoveResult {
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { ok: false, reason: "Căsuță invalidă." };
  if (outcome(board)) return { ok: false, reason: "Runda s-a terminat." };
  if (turnOf(board) !== mark) return { ok: false, reason: "Nu e tura ta." };
  if (board[cell] !== ".") return { ok: false, reason: "Căsuța e deja ocupată." };
  return { ok: true, board: board.slice(0, cell) + mark + board.slice(cell + 1), mark };
}

export interface Seats {
  x: string | null;
  o: string | null;
}

/**
 * Fills empty seats with the members who joined first and are not seated yet (spectators
 * move up in join order). Seated players are never moved.
 */
export function fillSeats(seats: Seats, memberIdsByJoin: string[]): Seats {
  const present = new Set(memberIdsByJoin);
  let x = seats.x && present.has(seats.x) ? seats.x : null;
  let o = seats.o && present.has(seats.o) ? seats.o : null;
  const free = memberIdsByJoin.filter((id) => id !== x && id !== o);
  if (!x) x = free.shift() ?? null;
  if (!o) o = free.shift() ?? null;
  return { x, o };
}

/** Next round: the two players swap marks, so the one who was O now moves first. */
export function swapSeats(seats: Seats): Seats {
  return { x: seats.o, o: seats.x };
}
