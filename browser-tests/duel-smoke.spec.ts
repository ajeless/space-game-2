import { expect, test } from "@playwright/test";
import { closeBridgePages, loadBattleStateFixture, openBridgePage, startBridgeServer, submitPlot } from "./helpers";

test("two players can aim, submit, and resolve a turn", async ({ browser }) => {
  const server = await startBridgeServer();
  const host = await openBridgePage(browser, server.origin);
  const guest = await openBridgePage(browser, server.origin);

  try {
    await expect(host.page.locator("[data-phase-label]")).toHaveText("PLOT PHASE");
    await expect(guest.page.locator("[data-phase-label]")).toHaveText("PLOT PHASE");

    await host.page.locator('[data-select-system-hit="forward_mount"]').click();
    await expect(host.page.locator("[data-phase-label]")).toHaveText("AIM MODE");
    await host.page.keyboard.press("Escape");
    await expect(host.page.locator("[data-phase-label]")).toHaveText("PLOT PHASE");

    await submitPlot(host.page);
    await expect(host.page.locator("[data-turn-status]")).toContainText("Plot submitted");

    await submitPlot(guest.page);

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(guest.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1.*replay|replay turn 1/i);
    await expect(guest.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1.*replay|replay turn 1/i);
    await expect(host.page.locator("[data-current-resolution]")).not.toHaveText("No turn resolved yet");
    await expect(guest.page.locator("[data-current-resolution]")).not.toHaveText("No turn resolved yet");
  } finally {
    await closeBridgePages(host, guest);
    await server.close();
  }
});

test.describe("selected mount panel", () => {
  test.use({
    viewport: {
      width: 1366,
      height: 768
    }
  });

  test("shows blocked-shot detail without overlapping plot controls or pushing the panel off-screen", async ({ browser }) => {
    const battleState = await loadBattleStateFixture();

    battleState.match_setup.match_id = "blocked_mount_panel_fixture_v0_2";
    battleState.match_setup.seed_root = "blocked-panel-browser-1";
    battleState.ships.alpha_ship!.pose.position = { x: 0, y: -90 };
    battleState.ships.alpha_ship!.pose.heading_degrees = 0;
    battleState.ships.alpha_ship!.pose.velocity = { x: 0, y: 0 };
    battleState.ships.bravo_ship!.pose.position = { x: 0, y: 260 };
    battleState.ships.bravo_ship!.pose.heading_degrees = 180;
    battleState.ships.bravo_ship!.pose.velocity = { x: 0, y: 0 };

    const server = await startBridgeServer({
      initialBattleState: battleState
    });
    const host = await openBridgePage(browser, server.origin);

    try {
      await host.page.getByRole("button", { name: /take css meridian/i }).first().click();
      await expect(host.page.getByText("Ship controls live.")).toBeVisible();

      const schematicViewport = host.page.locator("[data-schematic-viewport]");
      await expect(host.page.locator('[data-select-system="forward_mount"]')).toBeVisible();
      await expect(schematicViewport).toBeVisible();
      const beforeViewport = await schematicViewport.boundingBox();

      if (!beforeViewport) {
        throw new Error("Unable to read schematic viewport bounds");
      }

      await host.page.locator('[data-select-system="forward_mount"]').evaluate((element) => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await expect(host.page.locator('[data-selected-panel="forward_mount"]')).toBeVisible();
      await host.page.locator('[data-target-ship="bravo_ship"]').first().click();
      await host.page.locator('[data-aim-charge="forward_mount"]').selectOption("2");

      await expect(host.page.locator("[data-phase-label]")).toHaveText("AIM MODE");
      await expect(host.page.locator("[data-selected-system-state]")).toContainText("BOW RAILGUN · OPERATIONAL");
      await expect(host.page.locator('[data-selected-summary="status"]')).toContainText("BLOCKED 2P");
      await expect(host.page.locator('[data-selected-summary="detail"]')).toContainText("OPERATIONAL · IN ARC · OUT OF RANGE");
      await expect(host.page.locator("[data-selected-system-note]")).toContainText(
        "Click the same contact again or use Clear Target to stand it down."
      );

      const afterViewport = await schematicViewport.boundingBox();

      if (!afterViewport) {
        throw new Error("Unable to read schematic viewport bounds after selecting the mount");
      }

      expect(Math.abs(afterViewport.height - beforeViewport.height)).toBeLessThan(6);

      const shellMetrics = await host.page.evaluate(() => {
        const selectedPanel = document.querySelector<HTMLElement>('[data-selected-panel="forward_mount"]');
        const stationKeepButton = document.querySelector<HTMLElement>("[data-station-keep]");
        const scrollingElement = document.scrollingElement;

        return {
          viewportHeight: window.innerHeight,
          documentScrollHeight: scrollingElement?.scrollHeight ?? 0,
          panelBottom: selectedPanel?.getBoundingClientRect().bottom ?? 0,
          panelTop: selectedPanel?.getBoundingClientRect().top ?? 0,
          panelScrollHeight: selectedPanel?.scrollHeight ?? 0,
          panelClientHeight: selectedPanel?.clientHeight ?? 0,
          stationKeepBottom: stationKeepButton?.getBoundingClientRect().bottom ?? 0
        };
      });

      expect(shellMetrics.documentScrollHeight).toBeLessThanOrEqual(shellMetrics.viewportHeight + 1);
      expect(shellMetrics.panelTop).toBeGreaterThanOrEqual(shellMetrics.stationKeepBottom - 1);
      expect(shellMetrics.panelBottom).toBeLessThanOrEqual(shellMetrics.viewportHeight);
      expect(shellMetrics.panelScrollHeight).toBeLessThanOrEqual(shellMetrics.panelClientHeight + 1);
    } finally {
      await closeBridgePages(host);
      await server.close();
    }
  });
});
