/** Pending kick: a host's kick during a running game gives the player this long to press "Ignoră". */
export const KICK_GRACE_MS = 10_000;
/** Network grace on top of KICK_GRACE_MS before the server removes the player / refuses "Ignoră". */
export const KICK_ENFORCE_EXTRA_MS = 2_000;

function toMs(at: string | number | Date): number {
  return typeof at === "number" ? at : new Date(at).getTime();
}

/** Milliseconds left of the grace period, clamped to [0, KICK_GRACE_MS]; null when no kick is pending. */
export function kickRemainingMs(requestedAt: string | number | Date | null | undefined, now = Date.now()): number | null {
  if (requestedAt === null || requestedAt === undefined) return null;
  const t = toMs(requestedAt);
  if (Number.isNaN(t)) return null;
  return Math.min(KICK_GRACE_MS, Math.max(0, KICK_GRACE_MS - (now - t)));
}

/** True once the grace period plus the network grace has passed (the player is removed / can no longer ignore). */
export function isKickExpired(requestedAt: string | number | Date | null | undefined, now = Date.now()): boolean {
  if (requestedAt === null || requestedAt === undefined) return false;
  const t = toMs(requestedAt);
  return !Number.isNaN(t) && now - t > KICK_GRACE_MS + KICK_ENFORCE_EXTRA_MS;
}
