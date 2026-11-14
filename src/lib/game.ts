// Pure game rules - shared by server and client, no I/O.

export type Mark = "X" | "O";
export type Winner = Mark | "draw";

export const NICKNAME_MAX = 10;
/** Max spectators per room (cross-game contract B). */
export const MAX_SPECTATORS = 16;
/** 2 players + MAX_SPECTATORS spectators. */
export const MAX_MEMBERS = 2 + MAX_SPECTATORS;
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

/**
 * A room in any status (waiting, playing, finished) is abandoned once its last activity is older than this
 * AND no member (seated player or spectator) has been seen within it. Swept every time the room list loads
 * (GET /api/rooms). Open room pages poll /state every 15 s, which keeps both stamps fresher than this.
 */
export const ROOM_ABANDONED_MS = 120_000;

export function isRoomAbandoned(
  lastActivityAt: string | Date,
  membersLastSeen: (string | Date | null | undefined)[],
  now = Date.now(),
): boolean {
  const recent = (t: string | Date | null | undefined) => {
    if (t === null || t === undefined) return false;
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && now - ms <= ROOM_ABANDONED_MS;
  };
  return !recent(lastActivityAt) && !membersLastSeen.some(recent);
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

/**
 * Seats of the next round (new-round route). The previous X and O stay; the host-chosen `starterId`
 * (reorder) gets X, otherwise they swap so the one who was O starts. Free seats go ONLY to spectators
 * who asked for it ("Intră la runda următoare"), in queue order. Everyone else keeps watching.
 */
export function nextRoundSeats(prev: Seats, starterId: string | null, memberIds: string[], queuedIds: string[]): Seats {
  const present = new Set(memberIds);
  const px = prev.x && present.has(prev.x) ? prev.x : null;
  const po = prev.o && present.has(prev.o) ? prev.o : null;
  let seats: Seats;
  if (starterId && (starterId === px || starterId === po)) {
    seats = { x: starterId, o: starterId === px ? po : px };
  } else {
    seats = swapSeats({ x: px, o: po });
  }
  const queue = queuedIds.filter((id) => present.has(id) && id !== seats.x && id !== seats.o);
  return { x: seats.x ?? queue.shift() ?? null, o: seats.o ?? queue.shift() ?? null };
}

/**
 * Room still waiting (the round has not started): free seats are taken by queued spectators first (queue
 * order), then by the others in join order. When both seats fill up, the host-chosen starter becomes X.
 */
export function waitingSeats(seats: Seats, starterId: string | null, joinOrderIds: string[], queuedIds: string[]): Seats {
  const queued = queuedIds.filter((id) => joinOrderIds.includes(id));
  const ordered = [...queued, ...joinOrderIds.filter((id) => !queued.includes(id))];
  const filled = fillSeats(seats, ordered);
  if (filled.x && filled.o && starterId === filled.o) return { x: filled.o, o: filled.x };
  return filled;
}

/** A reorder is valid when it lists every member exactly once. */
export function isPermutation(order: unknown, memberIds: string[]): order is string[] {
  if (!Array.isArray(order) || order.length !== memberIds.length) return false;
  const set = new Set(order);
  return set.size === memberIds.length && memberIds.every((id) => set.has(id));
}

/** The seated player who comes first in `order` (that one starts the next round), null when nobody is seated. */
export function starterFromOrder(order: string[], seats: Seats): string | null {
  return order.find((id) => id === seats.x || id === seats.o) ?? null;
}
