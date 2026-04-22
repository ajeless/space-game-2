import { expect, test } from "@playwright/test";
import {
  acceptNextConfirm,
  closeBridgePages,
  fixturePath,
  openBridgePage,
  setStoredAdminToken,
  startBridgeServer,
  submitPlot
} from "./helpers";

test("reloading a claimed page resumes the same seat and preserves submitted-turn status", async ({ browser }) => {
  const server = await startBridgeServer();
  const host = await openBridgePage(browser, server.origin);
  const guest = await openBridgePage(browser, server.origin);

  try {
    await submitPlot(host.page);
    await expect(host.page.locator("[data-turn-status]")).toContainText("Plot submitted");

    const reconnectToken = await host.page.evaluate(() => window.localStorage.getItem("sg2_reconnect_token"));
    expect(reconnectToken).toBeTruthy();

    await host.page.reload();

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 1");
    await expect(host.page.locator("[data-turn-status]")).toContainText("Plot submitted");
    await expect(host.page.locator("[data-submit-plot]")).toBeVisible();
    await expect(host.page.locator("[data-claim-slot]")).toHaveCount(0);
    const resumedReconnectToken = await host.page.evaluate(() => window.localStorage.getItem("sg2_reconnect_token"));
    expect(resumedReconnectToken).toBe(reconnectToken);

    await submitPlot(guest.page);

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(guest.page.locator("[data-turn-number]")).toHaveText("Turn 2");
  } finally {
    await closeBridgePages(host, guest);
    await server.close();
  }
});

test("a fresh spectator can reclaim a reconnecting slot and keep the duel moving", async ({ browser }) => {
  const server = await startBridgeServer();
  const host = await openBridgePage(browser, server.origin);
  const guest = await openBridgePage(browser, server.origin);
  const spectator = await openBridgePage(browser, server.origin);

  try {
    await expect(spectator.page.locator("[data-submit-plot]")).toHaveCount(0);
    await expect(spectator.page.locator('[data-claim-slot="bravo"]')).toHaveCount(0);

    await guest.context.close();

    await expect(spectator.page.locator('[data-claim-slot="bravo"]')).toBeVisible();
    await spectator.page.locator('[data-claim-slot="bravo"]').click();

    await expect(spectator.page.locator("[data-submit-plot]")).toBeVisible();
    await expect(spectator.page.locator("[data-claim-slot]")).toHaveCount(0);

    await submitPlot(host.page);
    await submitPlot(spectator.page);

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(spectator.page.locator("[data-turn-number]")).toHaveText("Turn 2");
  } finally {
    await closeBridgePages(host, spectator);
    await server.close();
  }
});

test("host reset returns both connected crews to a fresh turn-one duel", async ({ browser }) => {
  const server = await startBridgeServer();
  const host = await openBridgePage(browser, server.origin);
  const guest = await openBridgePage(browser, server.origin);

  try {
    await submitPlot(host.page);
    await submitPlot(guest.page);

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(guest.page.locator("[data-turn-number]")).toHaveText("Turn 2");

    await setStoredAdminToken(host.page);
    await acceptNextConfirm(host.page);
    await host.page.locator("[data-reset-session]").click();

    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 1");
    await expect(guest.page.locator("[data-turn-number]")).toHaveText("Turn 1");
    await expect(host.page.locator("[data-current-resolution]")).toHaveText("No turn resolved yet");
    await expect(guest.page.locator("[data-current-resolution]")).toHaveText("No turn resolved yet");
    await expect(host.page.locator("[data-turn-status]")).toContainText("Plot in progress");
    await expect(guest.page.locator("[data-turn-status]")).toContainText("Plot in progress");
  } finally {
    await closeBridgePages(host, guest);
    await server.close();
  }
});

test("ended matches lock plotting and only expose post-duel state", async ({ browser }) => {
  const server = await startBridgeServer({
    fixturePath: fixturePath("fixtures/battle_states/ended_duel_turn_5.json")
  });
  const player = await openBridgePage(browser, server.origin, { expectedTurnLabel: "Turn 5" });

  try {
    await expect(player.page.locator("[data-phase-label]")).toHaveText("MATCH ENDED");
    await expect(player.page.locator("[data-turn-status]")).toHaveText("Victory");
    await expect(player.page.locator(".ssd-control-deck--locked")).toContainText("Plotting is disabled until the host resets the duel.");
    await expect(player.page.locator("[data-submit-plot]")).toHaveCount(0);
    await expect(player.page.locator("[data-reset-plot]")).toHaveCount(0);
  } finally {
    await closeBridgePages(player);
    await server.close();
  }
});
