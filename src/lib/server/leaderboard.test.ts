import { describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ db: () => ({ from }) }));

import { isTestRoom, playerKey, reportRound } from "./leaderboard";

describe("isTestRoom", () => {
  it("matches the rooms of scripts/e2e.mjs and tests/ui", () => {
    expect(isTestRoom("e2e-test-1731585600000")).toBe(true);
    expect(isTestRoom("e2e-test-ui-abc")).toBe(true);
  });
  it("leaves real rooms alone", () => {
    expect(isTestRoom("Camera lui Ana")).toBe(false);
    expect(isTestRoom("my e2e-test-room")).toBe(false);
    expect(isTestRoom("e2e-tes")).toBe(false);
    expect(isTestRoom("")).toBe(false);
  });
});

describe("reportRound", () => {
  it("never touches the leaderboard for a test room", async () => {
    await reportRound({ code: "ABCDEF", name: "e2e-test-1", round: 1 }, [{ nickname: "Ana", won: true }]);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("playerKey", () => {
  it("trims, lowercases and caps at 40 chars", () => {
    expect(playerKey("  Ana ")).toBe("ana");
    expect(playerKey("x".repeat(50))).toHaveLength(40);
  });
});
