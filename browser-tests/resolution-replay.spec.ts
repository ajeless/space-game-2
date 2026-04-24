import { expect, test } from "@playwright/test";
import {
  closeBridgePages,
  fixturePath,
  loadBattleStateFixture,
  openBridgePage,
  startBridgeServer,
  submitPlot
} from "./helpers";

async function getLocatorCenter(page: Parameters<typeof submitPlot>[0], selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox();

  if (!box) {
    throw new Error(`Unable to read bounding box for ${selector}`);
  }

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

async function armForwardRailgun(
  page: Parameters<typeof submitPlot>[0],
  targetShipId: string,
  chargePips: string
): Promise<void> {
  await page.locator('[data-select-system-hit="forward_mount"]').click();
  await page.locator(`[data-target-ship="${targetShipId}"]`).first().click();
  await page.locator('[data-aim-charge="forward_mount"]').selectOption(chargePips);
}

test("movement-only replay settles into a completed turn summary", async ({ browser }) => {
  const server = await startBridgeServer();
  const host = await openBridgePage(browser, server.origin);
  const guest = await openBridgePage(browser, server.origin);

  try {
    await submitPlot(host.page);
    await submitPlot(guest.page);

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(host.page.locator("[data-turn-status]")).toContainText("resolving turn 1");
    await expect(host.page.locator("[data-current-resolution]")).toHaveText("Resolving committed plots");
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/resolving committed plots/i);
    await expect(host.page.locator("[data-turn-status]")).toContainText("replaying turn 1");
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/replay turn 1/i);
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1 replay complete/i, {
      timeout: 18_000
    });
    await expect(guest.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1 replay complete/i, {
      timeout: 18_000
    });
  } finally {
    await closeBridgePages(host, guest);
    await server.close();
  }
});

test("drift-only replay keeps the ship centered before and after the playback settle", async ({ browser }) => {
  const battleState = await loadBattleStateFixture();

  battleState.match_setup.match_id = "drift_replay_fixture_v0_1";
  battleState.match_setup.seed_root = "drift-browser-1";
  battleState.ships.alpha_ship!.pose.velocity = { x: 0.2, y: 0 };
  battleState.ships.alpha_ship!.pose.heading_degrees = 0;

  const server = await startBridgeServer({
    initialBattleState: battleState
  });
  const host = await openBridgePage(browser, server.origin);
  const guest = await openBridgePage(browser, server.origin);

  try {
    const tacticalBounds = await host.page.locator("[data-tactical-viewport]").boundingBox();

    if (!tacticalBounds) {
      throw new Error("Unable to read tactical viewport bounds");
    }

    const tacticalCenter = {
      x: tacticalBounds.x + tacticalBounds.width / 2,
      y: tacticalBounds.y + tacticalBounds.height / 2
    };
    const initialShipCenter = await getLocatorCenter(host.page, '[data-ship-core="alpha_ship"]');

    expect(Math.hypot(initialShipCenter.x - tacticalCenter.x, initialShipCenter.y - tacticalCenter.y)).toBeLessThan(8);

    await submitPlot(host.page);
    await submitPlot(guest.page);

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(host.page.locator("[data-turn-status]")).toContainText("replaying turn 1");
    await expect
      .poll(async () => {
        const currentShipCenter = await getLocatorCenter(host.page, '[data-ship-core="alpha_ship"]');

        return Math.hypot(currentShipCenter.x - initialShipCenter.x, currentShipCenter.y - initialShipCenter.y);
      }, { timeout: 5_000 })
      .toBeGreaterThan(30);
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1 replay complete/i, {
      timeout: 18_000
    });

    const settledShipCenter = await getLocatorCenter(host.page, '[data-ship-core="alpha_ship"]');

    expect(Math.hypot(settledShipCenter.x - initialShipCenter.x, settledShipCenter.y - initialShipCenter.y)).toBeLessThan(8);
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
    await armForwardRailgun(host.page, "bravo_ship", "3");

    await submitPlot(host.page);
    await submitPlot(guest.page);

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/replay turn 1/i);
    await expect(host.page.locator("[data-resolution-projectile]")).toHaveCount(1);
    await expect(host.page.locator("[data-combat-feed-summary]")).toContainText([
      "Contact drive degraded",
      "Direct hit on contact · drive",
      "You opened fire with bow railgun on contact · 3P"
    ]);
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1 replay complete/i, {
      timeout: 18_000
    });
  } finally {
    await closeBridgePages(host, guest);
    await server.close();
  }
});

test("close-action fixture degrades both bow guns in the opening replay", async ({ browser }) => {
  const server = await startBridgeServer({
    fixturePath: fixturePath("fixtures/battle_states/close_action_duel_turn_1.json")
  });
  const host = await openBridgePage(browser, server.origin);
  const guest = await openBridgePage(browser, server.origin);

  try {
    await armForwardRailgun(host.page, "bravo_ship", "3");
    await armForwardRailgun(guest.page, "alpha_ship", "3");

    await submitPlot(host.page);
    await submitPlot(guest.page);

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(guest.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1 replay complete/i, {
      timeout: 18_000
    });
    await expect(guest.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1 replay complete/i, {
      timeout: 18_000
    });
    await expect(host.page.locator("[data-combat-feed-summary]").filter({ hasText: "Your bow railgun degraded" })).toHaveCount(
      1
    );
    await expect(
      host.page.locator("[data-combat-feed-summary]").filter({ hasText: "Contact bow railgun degraded" })
    ).toHaveCount(1);
    await expect(host.page.locator('[data-select-system="forward_mount"]')).toHaveClass(/ssd-system--degraded/);
    await expect(guest.page.locator('[data-select-system="forward_mount"]')).toHaveClass(/ssd-system--degraded/);
  } finally {
    await closeBridgePages(host, guest);
    await server.close();
  }
});
