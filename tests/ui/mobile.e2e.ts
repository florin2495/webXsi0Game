// Scenario 3 (phone only): no screen may scroll sideways (home, waiting room, game), every board cell and the main
// buttons stay big enough to tap (44 x 44 CSS px, Apple HIG; WCAG 2.2 minimum is 24), and a real touch tap plays
// a move that the other phone sees live. Scenario 1 already plays full rounds on the emulated iPhone.
import { expect, test } from "@playwright/test";
import {
  cell,
  createRoom,
  expectNoHorizontalScroll,
  joinAndStart,
  leaveAll,
  play,
  REALTIME_MS,
  status,
  withPlayers,
} from "./helpers";

const MIN_TAP_PX = 44;

test("every screen fits a phone, targets are tappable, a tap plays a move", async ({ browser }) => {
  test.skip(!test.info().project.use.isMobile, "phone layout only");

  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("home page fits the screen", async () => {
      await host.page.goto("./");
      await expect(host.page.getByTestId("home-submit")).toBeVisible();
      await expectNoHorizontalScroll(host.page);
    });

    await test.step("waiting room fits the screen", async () => {
      room.code = await createRoom(host);
      await expectNoHorizontalScroll(host.page);
    });

    await test.step("game screen fits, cells and buttons are big enough to tap", async () => {
      await joinAndStart(host, guest, room.code);
      for (const p of players) {
        await expectNoHorizontalScroll(p.page);
        const sizes = await p.page
          .getByTestId("board")
          .getByRole("gridcell")
          .evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)));
        expect(sizes).toHaveLength(9);
        expect(Math.min(...sizes), `smallest cell on ${p.name}'s board`).toBeGreaterThanOrEqual(MIN_TAP_PX);
        const leave = await p.page.getByTestId("leave").boundingBox();
        expect(leave?.height ?? 0, "leave button height").toBeGreaterThanOrEqual(MIN_TAP_PX);
      }
    });

    await test.step("a touch tap plays a move, the other phone sees it live", async () => {
      await play(host, room.code, 4, "X", true);
      await expect(cell(guest, 4)).toHaveAttribute("data-mark", "X", { timeout: REALTIME_MS });
      await expect(status(guest)).toHaveText("Tura ta", { timeout: REALTIME_MS });
      await expectNoHorizontalScroll(guest.page);
    });

    await test.step("Bob leaves mid-round (Ana wins by forfeit), then Ana, the room closes", async () => {
      await leaveAll([guest]);
      await expect(status(host)).toHaveText("🏆 Ai câștigat! Adversarul a părăsit jocul.", { timeout: REALTIME_MS });
      await leaveAll([host]);
      room.closed = true;
    });
  });
});
