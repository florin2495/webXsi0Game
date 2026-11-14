// Scenario 1: two real browsers play live on the deployed site: create, join by link (the round starts on its own),
// every move reaches the other screen through Realtime (well under the 15 s polling fallback), X wins with a line,
// the score updates on both screens, the guest starts round 2 (marks swapped, the other one starts), a draw,
// both leave. Runs on every project.
import { expect, test } from "@playwright/test";
import { createRoom, joinAndStart, leaveAll, playMoves, REALTIME_MS, status, withPlayers } from "./helpers";

test("two players play a live game: a win, then a draw with swapped marks", async ({ browser }) => {
  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("host creates a room, the guest joins by link, the round starts", async () => {
      room.code = await createRoom(host);
      await joinAndStart(host, guest, room.code);
      await expect(host.page.getByTestId("room-status")).toHaveAttribute("data-status", "playing");
    });

    await test.step("round 1: every move live, X (Ana) completes the top row", async () => {
      await playMoves(host, guest, room.code, [0, 3, 1, 4, 2]);
      await expect(status(host)).toHaveText("🏆 Ai câștigat!");
      await expect(status(guest)).toHaveText("🏆 Ana a câștigat (X).", { timeout: REALTIME_MS });
      for (const p of players) {
        await expect(p.page.getByTestId("score-X")).toContainText("Ana");
        await expect(p.page.getByTestId("score-X")).toContainText("1", { timeout: REALTIME_MS });
        for (const i of [0, 1, 2]) await expect(p.page.getByTestId(`cell-${i}`)).toHaveAttribute("data-mark", "X");
      }
    });

    await test.step("the guest starts round 2: marks swap, Bob (X) starts, Ana sees it live", async () => {
      await guest.page.getByTestId("new-round").click();
      await expect(status(guest)).toHaveText("Tura ta");
      await expect(status(host)).toHaveText("Tura lui Bob (X).", { timeout: REALTIME_MS });
      await expect(host.page.getByTestId("room-status")).toContainText("runda 2");
      for (let i = 0; i < 9; i++) await expect(host.page.getByTestId(`cell-${i}`)).toHaveAttribute("data-mark", "");
    });

    await test.step("round 2 ends in a draw on both screens", async () => {
      await playMoves(guest, host, room.code, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
      for (const p of players) {
        await expect(status(p)).toHaveText("🤝 Remiză!", { timeout: REALTIME_MS });
        await expect(p.page.getByTestId("new-round")).toBeVisible();
      }
    });

    await test.step("both leave, the room closes", async () => {
      await leaveAll([guest, host]);
      room.closed = true;
    });
  });
});
