// Scenario 2: someone opens the invite link of a running game. They become a spectator (banner, cannot play),
// the players see them live, they see every move live, they queue ("Intră la runda următoare", the players see
// it live), see the end of the round; a player leaves and the host's "Rundă nouă" gives the free seat to the queued
// spectator, who then plays. Desktop Chromium only: it checks game logic and Realtime, the device does not matter
// (scenario 1 already runs on WebKit).
import { expect, test } from "@playwright/test";
import { cell, createRoom, joinAndStart, joinRoom, leaveAll, member, play, playMoves, REALTIME_MS, status, withPlayers } from "./helpers";

test("a late joiner watches, queues and takes the free seat next round", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop-chromium", "game logic, one browser is enough");

  await withPlayers(browser, ["Ana", "Bob", "Cris"], async (players, room) => {
    const [host, guest, spectator] = players;

    await test.step("two players start a game", async () => {
      room.code = await createRoom(host);
      await joinAndStart(host, guest, room.code);
    });

    await test.step("a third person joins mid-game and becomes a spectator", async () => {
      await joinRoom(spectator, room.code);
      await expect(spectator.page.getByTestId("spectator-banner")).toBeVisible();
      await expect(status(spectator)).toHaveText("Tura lui Ana (X).");
      for (let i = 0; i < 9; i++) await expect(cell(spectator, i)).toBeDisabled();
      for (const p of [host, guest]) {
        await expect(member(p, spectator.name)).toHaveAttribute("data-role", "spectator", { timeout: REALTIME_MS });
      }
    });

    await test.step("the spectator queues for the next round, the players see it live", async () => {
      await spectator.page.getByTestId("queue-toggle").click();
      await expect(spectator.page.getByTestId("queue-toggle")).toContainText("În coadă (locul 1)");
      await expect(member(host, spectator.name)).toHaveAttribute("data-queued", "true", { timeout: REALTIME_MS });
      await expect(member(host, spectator.name)).toContainText("coada #1");
    });

    await test.step("the round is played; the spectator sees every move live and the end", async () => {
      await playMoves(host, guest, room.code, [0, 3, 1, 4, 2], [spectator]);
      await expect(status(spectator)).toHaveText("🏆 Ana a câștigat (X).", { timeout: REALTIME_MS });
      await expect(spectator.page.getByTestId("new-round")).toHaveCount(0);
    });

    await test.step("Bob leaves; the host's new round seats the queued spectator, who starts as X", async () => {
      await leaveAll([guest]);
      await expect(member(host, guest.name)).toHaveCount(0, { timeout: REALTIME_MS });
      await host.page.getByTestId("new-round").click();
      await expect(spectator.page.getByTestId("spectator-banner")).toHaveCount(0, { timeout: REALTIME_MS });
      await expect(status(spectator)).toHaveText("Tura ta", { timeout: REALTIME_MS });
      await expect(status(host)).toHaveText("Tura lui Cris (X).");
      await expect(member(host, spectator.name)).toHaveAttribute("data-role", "X");
      await play(spectator, room.code, 4, "X");
      await expect(cell(host, 4)).toHaveAttribute("data-mark", "X", { timeout: REALTIME_MS });
    });

    await test.step("Cris leaves mid-round (Ana wins by forfeit), then Ana, the room closes", async () => {
      await leaveAll([spectator]);
      await expect(status(host)).toHaveText("🏆 Ai câștigat! Adversarul a părăsit jocul.", { timeout: REALTIME_MS });
      await leaveAll([host]);
      room.closed = true;
    });
  });
});
