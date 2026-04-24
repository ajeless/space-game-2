// Playwright spec that captures portfolio screenshots during a scripted duel.
// Depends on: browser-tests/helpers.ts, fixtures/. Consumed by: docs/assets/screenshots/.
// Invariant: running this spec regenerates the README's embedded images from current UI.
// Gated behind CAPTURE_ASSETS=1 so it does not run during smoke and silently regenerate PNGs.

import { expect, test } from "@playwright/test";
import {
  closeBridgePages,
  loadBattleStateFixture,
  openBridgePage,
  startBridgeServer,
  submitPlot
} from "./helpers";

const SCREENSHOT_DIR = "docs/assets/screenshots";

if (process.env.CAPTURE_ASSETS !== "1") {
  test.skip(true, "CAPTURE_ASSETS=1 required to regenerate portfolio screenshots");
}

test("captures the four portfolio screenshots for the README", async ({ browser }) => {
  // Stage a close-enough, stationary encounter so the scope, aim arcs, and
  // combat events all have something visibly interesting to show.
  const battleState = await loadBattleStateFixture();

  battleState.match_setup.match_id = "portfolio_capture_v0_3";
  battleState.match_setup.seed_root = "portfolio-capture-1";
  battleState.match_setup.rules.damage.local_hit_resolution.radius_hull_units = 0.2;
  battleState.ships.alpha_ship!.pose.position = { x: 0, y: -100 };
  battleState.ships.alpha_ship!.pose.velocity = { x: 0, y: 0 };
  battleState.ships.alpha_ship!.pose.heading_degrees = 0;
  battleState.ships.bravo_ship!.pose.position = { x: 0, y: 0 };
  battleState.ships.bravo_ship!.pose.velocity = { x: 0, y: 0 };
  battleState.ships.bravo_ship!.pose.heading_degrees = 0;
  battleState.ships.bravo_ship!.systems.drive!.current_integrity = 20;

  const server = await startBridgeServer({ initialBattleState: battleState });
  const host = await openBridgePage(browser, server.origin);
  const guest = await openBridgePage(browser, server.origin);

  try {
    // --- Moment 1: Bridge at start ----------------------------------------
    await expect(host.page.locator("[data-phase-label]")).toHaveText("PLOT PHASE");
    await expect(guest.page.locator("[data-phase-label]")).toHaveText("PLOT PHASE");
    await host.page.screenshot({
      path: `${SCREENSHOT_DIR}/01-bridge-start.png`,
      fullPage: false
    });

    // --- Moment 2: Mid-turn plotting, AIM MODE on forward mount -----------
    await host.page.locator('[data-select-system-hit="forward_mount"]').click();
    await expect(host.page.locator("[data-phase-label]")).toHaveText("AIM MODE");
    await host.page.locator('[data-target-ship="bravo_ship"]').first().click();
    await host.page.locator('[data-aim-charge="forward_mount"]').selectOption("3");
    await expect(host.page.locator('[data-selected-panel="forward_mount"]')).toBeVisible();
    await host.page.screenshot({
      path: `${SCREENSHOT_DIR}/02-plotting.png`,
      fullPage: false
    });

    // --- Moment 3: Combat in flight ---------------------------------------
    await submitPlot(host.page);
    await submitPlot(guest.page);

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    // Wait for the replay phase to start (events rendering on the tactical scope).
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/replay turn 1/i);
    await expect(host.page.locator("[data-combat-feed-summary]").first()).toBeVisible({ timeout: 12_000 });
    await host.page.screenshot({
      path: `${SCREENSHOT_DIR}/03-combat.png`,
      fullPage: false
    });

    // --- Moment 4: Post-resolution debrief --------------------------------
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1 replay complete/i, {
      timeout: 18_000
    });
    await host.page.screenshot({
      path: `${SCREENSHOT_DIR}/04-debrief.png`,
      fullPage: false
    });
  } finally {
    await closeBridgePages(host, guest);
    await server.close();
  }
});
