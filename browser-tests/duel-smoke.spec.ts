import { expect, test } from "@playwright/test";

test("two players can aim, submit, and resolve a turn", async ({ browser, baseURL }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    await Promise.all([hostPage.goto(baseURL!), guestPage.goto(baseURL!)]);

    await expect(hostPage.locator("[data-phase-label]")).toHaveText("PLOT PHASE");
    await expect(guestPage.locator("[data-phase-label]")).toHaveText("PLOT PHASE");
    await expect(hostPage.locator("[data-turn-number]")).toHaveText("Turn 1");
    await expect(guestPage.locator("[data-turn-number]")).toHaveText("Turn 1");

    await hostPage.locator('[data-select-system="forward_mount"]').click();
    await expect(hostPage.locator("[data-phase-label]")).toHaveText("AIM MODE");
    await hostPage.keyboard.press("Escape");
    await expect(hostPage.locator("[data-phase-label]")).toHaveText("PLOT PHASE");

    await hostPage.mouse.click(40, 40);
    await hostPage.keyboard.press("Space");
    await expect(hostPage.locator("[data-turn-status]")).toContainText("Plot submitted");

    await guestPage.locator("[data-submit-plot]").click();

    await expect(hostPage.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(guestPage.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(hostPage.locator("[data-current-resolution]")).not.toHaveText("No turn resolved yet");
    await expect(guestPage.locator("[data-current-resolution]")).not.toHaveText("No turn resolved yet");
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});
