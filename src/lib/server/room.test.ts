import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROOM_ABANDONED_MS } from "@/lib/game";

// cleanupAbandonedRooms with the Supabase client mocked: every db().from(...) returns a chainable query that
// records its calls and resolves to state.selectResult (select) or state.deleteResult (delete).
type Result = { data?: unknown; error: unknown };

const state = vi.hoisted(() => ({
  queries: [] as { table: string; ops: unknown[][] }[],
  selectResult: { data: [], error: null } as { data?: unknown; error: unknown },
  deleteResult: { error: null } as { data?: unknown; error: unknown },
  throwOnFrom: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("./membership", () => ({ enforceExpiredKicks: vi.fn(async () => false) }));
vi.mock("./db", () => {
  class Query implements PromiseLike<Result> {
    readonly ops: unknown[][] = [];
    constructor(readonly table: string) {}
    private add(op: string, args: unknown[]) {
      this.ops.push([op, ...args]);
      return this;
    }
    select(...args: unknown[]) {
      return this.add("select", args);
    }
    delete(...args: unknown[]) {
      return this.add("delete", args);
    }
    lt(...args: unknown[]) {
      return this.add("lt", args);
    }
    in(...args: unknown[]) {
      return this.add("in", args);
    }
    limit(...args: unknown[]) {
      return this.add("limit", args);
    }
    then<A = Result, B = never>(
      onFulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
      onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      const isDelete = this.ops.some((op) => op[0] === "delete");
      return Promise.resolve(isDelete ? state.deleteResult : state.selectResult).then(onFulfilled, onRejected);
    }
  }
  return {
    PLAYER_COLUMNS: "",
    ROOM_COLUMNS: "",
    db: () => ({
      from: (table: string) => {
        if (state.throwOnFrom) throw new Error("db down");
        const q = new Query(table);
        state.queries.push(q);
        return q;
      },
    }),
  };
});

import { cleanupAbandonedRooms } from "./room";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const CUTOFF = new Date(NOW - ROOM_ABANDONED_MS).toISOString();
const OLD = ROOM_ABANDONED_MS / 1000 + 60;
const deletes = () => state.queries.filter((q) => q.ops.some((op) => op[0] === "delete"));

describe("cleanupAbandonedRooms", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    state.queries = [];
    state.selectResult = { data: [], error: null };
    state.deleteResult = { error: null };
    state.throwOnFrom = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("only looks at rooms idle past the cutoff", async () => {
    await cleanupAbandonedRooms();
    expect(state.queries[0].table).toBe("xand0_rooms");
    expect(state.queries[0].ops).toContainEqual(["lt", "last_activity_at", CUTOFF]);
  });

  it("keeps rooms with a recently seen member and deletes the silent ones", async () => {
    state.selectResult = {
      data: [
        { id: "kept", last_activity_at: ago(OLD), xand0_players: [{ last_seen_at: ago(OLD) }, { last_seen_at: ago(30) }] },
        { id: "silent", last_activity_at: ago(OLD), xand0_players: [{ last_seen_at: ago(OLD) }, { last_seen_at: null }] },
        { id: "empty", last_activity_at: ago(OLD), xand0_players: [] },
      ],
      error: null,
    };
    await cleanupAbandonedRooms();
    const del = deletes();
    expect(del).toHaveLength(1);
    expect(del[0].table).toBe("xand0_rooms");
    expect(del[0].ops).toContainEqual(["in", "id", ["silent", "empty"]]);
  });

  it("re-checks the activity cutoff in the delete, so a room touched meanwhile survives", async () => {
    state.selectResult = { data: [{ id: "silent", last_activity_at: ago(OLD), xand0_players: [] }], error: null };
    await cleanupAbandonedRooms();
    expect(deletes()[0].ops).toContainEqual(["lt", "last_activity_at", CUTOFF]);
  });

  it("deletes nothing when every room still has someone around", async () => {
    state.selectResult = { data: [{ id: "kept", last_activity_at: ago(OLD), xand0_players: [{ last_seen_at: ago(10) }] }], error: null };
    await cleanupAbandonedRooms();
    expect(deletes()).toHaveLength(0);
  });

  it("logs a select error instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.selectResult = { data: null, error: { message: "boom" } };
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    expect(deletes()).toHaveLength(0);
  });

  it("logs a delete error instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.selectResult = { data: [{ id: "silent", last_activity_at: ago(OLD), xand0_players: [] }], error: null };
    state.deleteResult = { error: { message: "boom" } };
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  it("logs a thrown DB error instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.throwOnFrom = true;
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });
});
