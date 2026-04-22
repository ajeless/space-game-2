import { expect, test } from "@playwright/test";
import { closeBridgePages, openBridgePage, startBridgeServer, submitPlot } from "./helpers";

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
    await expect(host.page.locator("[data-current-resolution]")).not.toHaveText("No turn resolved yet");
    await expect(guest.page.locator("[data-current-resolution]")).not.toHaveText("No turn resolved yet");
  } finally {
    await closeBridgePages(host, guest);
    await server.close();
  }
});
