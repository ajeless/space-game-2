import { expect, test } from "@playwright/test";
import {
  closeBridgePages,
  loadBattleStateFixture,
  openBridgePage,
  startBridgeServer,
  submitPlot
} from "./helpers";

test("movement-only replay settles into a completed turn summary", async ({ browser }) => {
  const server = await startBridgeServer();
  const host = await openBridgePage(browser, server.origin);
  const guest = await openBridgePage(browser, server.origin);

  try {
    await submitPlot(host.page);
    await submitPlot(guest.page);

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(host.page.locator("[data-turn-status]")).toContainText("replaying turn 1");
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/replay turn 1/i);
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1 replay complete/i, {
      timeout: 8_000
    });
    await expect(guest.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1 replay complete/i, {
      timeout: 8_000
    });
  } finally {
    await closeBridgePages(host, guest);
    await server.close();
  }
});

test("combat replay keeps fire and hit events visible in the feed", async ({ browser }) => {
  const battleState = await loadBattleStateFixture();

  battleState.match_setup.match_id = "combat_replay_fixture_v0_1";
  battleState.match_setup.seed_root = "combat-browser-3";
  battleState.match_setup.rules.damage.local_hit_resolution.radius_hull_units = 0.2;
  battleState.ships.alpha_ship!.pose.position = { x: 0, y: -100 };
  battleState.ships.alpha_ship!.pose.velocity = { x: 0, y: 0 };
  battleState.ships.alpha_ship!.pose.heading_degrees = 0;
  battleState.ships.bravo_ship!.pose.position = { x: 0, y: 0 };
  battleState.ships.bravo_ship!.pose.velocity = { x: 0, y: 0 };
  battleState.ships.bravo_ship!.pose.heading_degrees = 0;
  battleState.ships.bravo_ship!.systems.drive!.current_integrity = 20;

  const server = await startBridgeServer({
    initialBattleState: battleState
  });
  const host = await openBridgePage(browser, server.origin);
  const guest = await openBridgePage(browser, server.origin);

  try {
    await host.page.locator('[data-select-system-hit="forward_mount"]').click();
    await host.page.locator('[data-target-ship="bravo_ship"]').first().click();
    await host.page.locator('[data-aim-charge="forward_mount"]').selectOption("3");

    await submitPlot(host.page);
    await submitPlot(guest.page);

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/replay turn 1/i);
    await expect(host.page.locator("[data-combat-feed-summary]")).toContainText([
      "Contact drive degraded",
      "You hit contact · drive",
      "You fired bow railgun at contact · 3P"
    ]);
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1 replay complete/i, {
      timeout: 8_000
    });
  } finally {
    await closeBridgePages(host, guest);
    await server.close();
  }
});
