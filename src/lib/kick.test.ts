import { describe, expect, it } from "vitest";
import { isKickExpired, KICK_GRACE_MS, kickRemainingMs } from "./kick";

const T = Date.parse("2026-01-01T00:00:00Z");

describe("kickRemainingMs", () => {
  it("is null when no kick is pending", () => {
    expect(kickRemainingMs(null, T)).toBeNull();
    expect(kickRemainingMs(undefined, T)).toBeNull();
  });
  it("counts down from the grace period", () => {
    expect(kickRemainingMs(new Date(T).toISOString(), T)).toBe(KICK_GRACE_MS);
    expect(kickRemainingMs(new Date(T).toISOString(), T + 4_000)).toBe(6_000);
  });
  it("clamps to [0, KICK_GRACE_MS]", () => {
    expect(kickRemainingMs(T, T + 60_000)).toBe(0);
    expect(kickRemainingMs(T + 5_000, T)).toBe(KICK_GRACE_MS); // clock skew: requested "in the future"
  });
});

describe("isKickExpired", () => {
  it("is false without a pending kick", () => {
    expect(isKickExpired(null, T)).toBe(false);
  });
  it("allows 2 s of network grace after the 10 s", () => {
    expect(isKickExpired(T, T + 10_000)).toBe(false);
    expect(isKickExpired(T, T + 12_000)).toBe(false);
    expect(isKickExpired(T, T + 12_001)).toBe(true);
  });
});
