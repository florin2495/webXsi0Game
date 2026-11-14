import { describe, expect, it } from "vitest";
import {
  applyMove,
  EMPTY_BOARD,
  fillSeats,
  isBoard,
  isPermutation,
  isRoomAbandoned,
  isRoomExpired,
  MAX_MEMBERS,
  MAX_SPECTATORS,
  nextRoundSeats,
  outcome,
  ROOM_ABANDONED_MS,
  starterFromOrder,
  swapSeats,
  turnOf,
  waitingSeats,
} from "./game";

describe("turnOf", () => {
  it("starts with X and alternates", () => {
    expect(turnOf(EMPTY_BOARD)).toBe("X");
    expect(turnOf("X........")).toBe("O");
    expect(turnOf("XO.......")).toBe("X");
  });
});

describe("outcome", () => {
  it("is null for an open board", () => {
    expect(outcome(EMPTY_BOARD)).toBeNull();
    expect(outcome("XO.X.....")).toBeNull();
  });
  it("finds rows, columns and diagonals", () => {
    expect(outcome("XXXOO....")).toEqual({ winner: "X", line: [0, 1, 2] });
    expect(outcome("OX.OX.O..")).toEqual({ winner: "O", line: [0, 3, 6] });
    expect(outcome("XO.OX...X")).toEqual({ winner: "X", line: [0, 4, 8] });
    expect(outcome("XXO.OXO..")).toEqual({ winner: "O", line: [2, 4, 6] });
  });
  it("reports a draw on a full board without a line", () => {
    expect(outcome("XOXXOOOXX")).toEqual({ winner: "draw", line: null });
  });
  it("prefers a win over a draw when the last move fills the board", () => {
    expect(outcome("XOXOXOOXX")?.winner).toBe("X");
  });
});

describe("applyMove", () => {
  it("places the mark of the player on turn", () => {
    expect(applyMove(EMPTY_BOARD, 4, "X")).toEqual({ ok: true, board: "....X....", mark: "X" });
  });
  it("rejects out-of-turn, occupied, invalid and finished", () => {
    expect(applyMove(EMPTY_BOARD, 0, "O").ok).toBe(false);
    expect(applyMove("X........", 0, "O").ok).toBe(false);
    expect(applyMove(EMPTY_BOARD, 9, "X").ok).toBe(false);
    expect(applyMove(EMPTY_BOARD, 1.5, "X").ok).toBe(false);
    expect(applyMove("XXXOO....", 8, "O").ok).toBe(false);
  });
});

describe("seats", () => {
  it("fills empty seats from spectators in join order", () => {
    expect(fillSeats({ x: "a", o: null }, ["a", "b", "c"])).toEqual({ x: "a", o: "b" });
    expect(fillSeats({ x: null, o: "b" }, ["a", "b", "c"])).toEqual({ x: "a", o: "b" });
    expect(fillSeats({ x: "gone", o: "b" }, ["b", "c", "d"])).toEqual({ x: "c", o: "b" });
    expect(fillSeats({ x: null, o: null }, [])).toEqual({ x: null, o: null });
  });
  it("swaps marks for the next round", () => {
    expect(swapSeats({ x: "a", o: "b" })).toEqual({ x: "b", o: "a" });
  });
});

describe("misc", () => {
  it("validates board strings", () => {
    expect(isBoard(EMPTY_BOARD)).toBe(true);
    expect(isBoard("XO")).toBe(false);
    expect(isBoard("XOZ......")).toBe(false);
  });
  it("expires idle rooms, with a longer limit while playing", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    const nineMinAgo = new Date(now - 9 * 60_000);
    const elevenMinAgo = new Date(now - 11 * 60_000);
    expect(isRoomExpired("waiting", nineMinAgo, now)).toBe(false);
    expect(isRoomExpired("waiting", elevenMinAgo, now)).toBe(true);
    expect(isRoomExpired("finished", elevenMinAgo, now)).toBe(true);
    expect(isRoomExpired("playing", elevenMinAgo, now)).toBe(false);
    expect(isRoomExpired("playing", new Date(now - 31 * 60_000), now)).toBe(true);
  });
});

describe("abandoned rooms (any status)", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const sec = (s: number) => new Date(now - s * 1000).toISOString();
  it(`is abandoned after ${ROOM_ABANDONED_MS / 1000} s with nobody seen`, () => {
    expect(isRoomAbandoned(sec(121), [sec(300), sec(200)], now)).toBe(true);
    expect(isRoomAbandoned(sec(121), [], now)).toBe(true);
    expect(isRoomAbandoned(sec(121), [null], now)).toBe(true);
  });
  it("is kept while the last activity is recent", () => {
    expect(isRoomAbandoned(sec(119), [], now)).toBe(false);
  });
  it("is kept while any player or spectator was seen recently", () => {
    expect(isRoomAbandoned(sec(600), [sec(600), sec(30)], now)).toBe(false);
  });
});

describe("spectator queue and starter", () => {
  const seats = { x: "a", o: "b" };

  it("swaps X and O when nobody picked a starter", () => {
    expect(nextRoundSeats(seats, null, ["a", "b", "c"], [])).toEqual({ x: "b", o: "a" });
  });

  it("honors the host-chosen starter", () => {
    expect(nextRoundSeats(seats, "a", ["a", "b"], [])).toEqual({ x: "a", o: "b" });
    expect(nextRoundSeats(seats, "zzz", ["a", "b"], [])).toEqual({ x: "b", o: "a" });
  });

  it("fills a free seat only from the queue, in queue order", () => {
    // b left; c did not queue, d queued first, e queued second
    expect(nextRoundSeats({ x: "a", o: null }, null, ["a", "c", "d", "e"], ["d", "e"])).toEqual({ x: "d", o: "a" });
    expect(nextRoundSeats({ x: "a", o: null }, null, ["a", "c"], [])).toEqual({ x: null, o: "a" });
  });

  it("waiting rooms seat queued spectators first, then join order, starter becomes X", () => {
    expect(waitingSeats({ x: "a", o: null }, null, ["a", "c", "d"], ["d"])).toEqual({ x: "a", o: "d" });
    expect(waitingSeats({ x: "a", o: null }, "d", ["a", "c", "d"], ["d"])).toEqual({ x: "d", o: "a" });
  });

  it("validates a reorder as a full permutation", () => {
    expect(isPermutation(["b", "a"], ["a", "b"])).toBe(true);
    expect(isPermutation(["a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a", "a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a", "x"], ["a", "b"])).toBe(false);
    expect(isPermutation("ab", ["a", "b"])).toBe(false);
  });

  it("the first seated player of the order starts", () => {
    expect(starterFromOrder(["c", "b", "a"], seats)).toBe("b");
    expect(starterFromOrder(["c"], seats)).toBeNull();
  });

  it("allows 16 spectators on top of the 2 players", () => {
    expect(MAX_SPECTATORS).toBe(16);
    expect(MAX_MEMBERS).toBe(18);
  });
});
