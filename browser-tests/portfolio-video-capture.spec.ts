// Captures a full duel turn as video for the README's animated demo.
// Depends on: browser-tests/helpers.ts (video-capable context). Consumed by: scripts/capture-gif.mjs.
// Invariant: this spec is gated behind CAPTURE_ASSETS=1 so it does not run during smoke.

import { mkdir, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  closeBridgePages,
  loadBattleStateFixture,
  openBridgePage,
  startBridgeServer,
  submitPlot
} from "./helpers";

const VIDEO_STAGE_DIR = path.resolve(process.cwd(), "test-results/portfolio-raw");
const VIDEO_OUTPUT_PATH = path.join(VIDEO_STAGE_DIR, "video.webm");

if (process.env.CAPTURE_ASSETS !== "1") {
  test.skip(true, "CAPTURE_ASSETS=1 required to regenerate portfolio video");
}

test("records a full duel turn as video for the README GIF", async ({ browser }) => {
  await rm(VIDEO_STAGE_DIR, { recursive: true, force: true });
  await mkdir(VIDEO_STAGE_DIR, { recursive: true });

  // Match the portfolio-capture.spec fixture so the GIF and the stills stay
  // visually consistent — same opening pose, same engagement.
  const battleState = await loadBattleStateFixture();

  battleState.match_setup.match_id = "portfolio_video_capture_v0_3";
  battleState.match_setup.seed_root = "portfolio-video-capture-1";
  battleState.match_setup.rules.damage.local_hit_resolution.radius_hull_units = 0.2;
  battleState.ships.alpha_ship!.pose.position = { x: 0, y: -100 };
  battleState.ships.alpha_ship!.pose.velocity = { x: 0, y: 0 };
  battleState.ships.alpha_ship!.pose.heading_degrees = 0;
  battleState.ships.bravo_ship!.pose.position = { x: 0, y: 0 };
  battleState.ships.bravo_ship!.pose.velocity = { x: 0, y: 0 };
  battleState.ships.bravo_ship!.pose.heading_degrees = 0;
  battleState.ships.bravo_ship!.systems.drive!.current_integrity = 20;

  const server = await startBridgeServer({ initialBattleState: battleState });
  const host = await openBridgePage(browser, server.origin, {
    recordVideo: {
      dir: VIDEO_STAGE_DIR,
      size: { width: 1600, height: 1000 }
    }
  });
  const guest = await openBridgePage(browser, server.origin);

  try {
    // Settle on the opening bridge view so the first frame is legible as PLOT PHASE.
    await expect(host.page.locator("[data-phase-label]")).toHaveText("PLOT PHASE");
    await expect(guest.page.locator("[data-phase-label]")).toHaveText("PLOT PHASE");
    await host.page.waitForTimeout(2_500);

    // Open the forward mount: AIM MODE highlights the arcs.
    await host.page.locator('[data-select-system-hit="forward_mount"]').click();
    await expect(host.page.locator("[data-phase-label]")).toHaveText("AIM MODE");
    await host.page.waitForTimeout(1_500);

    // Acquire the target and crank up the charge so the hit reads.
    await host.page.locator('[data-target-ship="bravo_ship"]').first().click();
    await host.page.locator('[data-aim-charge="forward_mount"]').selectOption("3");
    await expect(host.page.locator('[data-selected-panel="forward_mount"]')).toBeVisible();
    await host.page.waitForTimeout(2_000);

    // Commit the plot. Guest commits too so the resolver runs.
    await submitPlot(host.page);
    await expect(host.page.locator("[data-turn-status]")).toContainText("Plot submitted");
    await submitPlot(guest.page);

    // Let the replay unspool: projectile trail, combat feed, debrief.
    await expect(host.page.locator("[data-turn-number]")).toHaveText("Turn 2");
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/replay turn 1/i);
    await expect(host.page.locator("[data-combat-feed-summary]").first()).toBeVisible({ timeout: 12_000 });
    await expect(host.page.locator("[data-current-resolution-meta]")).toContainText(/turn 1 replay complete/i, {
      timeout: 18_000
    });

    // Hold on the debrief so the GIF's last frame is a clean summary, not mid-animation.
    await host.page.waitForTimeout(2_000);
  } finally {
    const hostVideo = host.page.video();
    await closeBridgePages(host, guest);
    await server.close();

    if (!hostVideo) {
      throw new Error("host page was opened without a video recorder");
    }

    const recordedPath = await hostVideo.path();

    await copyFile(recordedPath, VIDEO_OUTPUT_PATH);
  }
});
