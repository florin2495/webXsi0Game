// Shared steps for the Playwright UI tests (tests/ui/*.e2e.ts). Not a test file itself (no .e2e.ts suffix).
// Rooms are named "e2e-test-ui-…"; a leftover is deleted with the service key (env) as a safety net.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/** A change has to show up on another screen within this, without a reload. Polling alone takes up to 60 s. */
export const REALTIME_MS = 5_000;

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** A separate browser context = a separate device (own localStorage session), with the project's device settings. */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  });
  return { name, context, page: await context.newPage() };
}

/** Board cell 0-8 (row by row), `data-mark` "X" / "O" / "" (Game.tsx). */
export const cell = (p: Player, i: number) => p.page.getByTestId(`cell-${i}`);
export const status = (p: Player) => p.page.getByTestId("status-line");
/** A member's row in the "În cameră" list, with `data-role` X / O / spectator and `data-queued`. */
export const member = (p: Player, nickname: string) => p.page.getByTestId("player-list").locator(`li[data-nickname="${nickname}"]`);

/** Host creates a room from the home page (host = X); returns its code. */
export async function createRoom(host: Player): Promise<string> {
  const page = host.page;
  await page.goto("./");
  await page.getByLabel("Numele camerei").fill(`e2e-test-ui-${Date.now().toString(36)}`);
  await page.getByLabel("Nickname-ul tău").fill(host.name);
  await page.getByTestId("home-submit").click();
  await page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
  await expect(page.getByTestId("room-status")).toHaveAttribute("data-status", "waiting");
  await expect(member(host, host.name)).toHaveAttribute("data-role", "X");
  return page.url().match(/\/room\/([A-Z2-9]{6})$/)![1];
}

/** Opens the invite link and joins with the player's nickname (takes the free seat or watches as a spectator). */
export async function joinRoom(p: Player, code: string): Promise<void> {
  await p.page.goto(`room/${code}`);
  await p.page.getByLabel("Nickname-ul tău").fill(p.name);
  await p.page.getByTestId("join-submit").click();
  await expect(p.page.getByTestId("join-submit")).toBeHidden();
  await expect(p.page.getByTestId("board")).toBeVisible();
}

/** The guest joins the host's room by link: the round starts on its own (host X, guest O), both screens follow live. */
export async function joinAndStart(host: Player, guest: Player, code: string): Promise<void> {
  await joinRoom(guest, code);
  await expect(status(host)).toHaveText("Tura ta", { timeout: REALTIME_MS });
  await expect(status(guest)).toHaveText(`Tura lui ${host.name} (X).`);
  await expect(member(host, guest.name)).toHaveAttribute("data-role", "O", { timeout: REALTIME_MS });
}

/** Plays cell `i` on the mover's screen (their turn) and waits for the server to accept it. */
export async function play(mover: Player, code: string, i: number, mark: "X" | "O", tap = false): Promise<void> {
  await expect(status(mover)).toHaveText("Tura ta", { timeout: REALTIME_MS });
  await Promise.all([
    mover.page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${code}/move`) && r.ok()),
    tap ? cell(mover, i).tap() : cell(mover, i).click(),
  ]);
  await expect(cell(mover, i)).toHaveAttribute("data-mark", mark);
}

/**
 * Plays `cells` alternately, starting with `x` (X), then `o` (O). Every move must reach the opponent and every
 * watcher live (no reload).
 */
export async function playMoves(x: Player, o: Player, code: string, cells: number[], watchers: Player[] = []): Promise<void> {
  for (let k = 0; k < cells.length; k++) {
    const [mover, other, mark] = k % 2 === 0 ? ([x, o, "X"] as const) : ([o, x, "O"] as const);
    await play(mover, code, cells[k], mark);
    for (const w of [other, ...watchers]) {
      await expect(cell(w, cells[k])).toHaveAttribute("data-mark", mark, { timeout: REALTIME_MS });
    }
  }
}

/** Leaves through the "Părăsește" button (accepting the confirm), in the given order. */
export async function leaveAll(players: Player[]): Promise<void> {
  for (const p of players) {
    p.page.once("dialog", (d) => void d.accept());
    await p.page.getByTestId("leave").click();
    await expect(p.page.getByTestId("home-submit")).toBeVisible();
  }
}

/** The page must not scroll sideways (the usual mobile layout bug). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
}

/** Safety net: delete the room straight in the DB if the UI flow did not close it. */
export async function deleteRoom(code: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(`cleanup: no Supabase env, delete room ${code} by hand if it is still there`);
    return;
  }
  const res = await fetch(`${url}/rest/v1/xand0_rooms?code=eq.${code}&name=like.e2e-test-ui-*`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  console.log(`cleanup: room ${code} delete = ${res.status}`);
}

/** Runs `body` with fresh players; always closes their browsers and deletes the room if it was left open. */
export async function withPlayers(
  browser: Browser,
  names: string[],
  body: (players: Player[], room: { code: string; closed: boolean }) => Promise<void>,
): Promise<void> {
  const players = await Promise.all(names.map((n) => newPlayer(browser, n)));
  const room = { code: "", closed: false };
  try {
    await body(players, room);
  } finally {
    if (room.code && !room.closed) await deleteRoom(room.code);
    for (const p of players) await p.context.close();
  }
}
