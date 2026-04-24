#!/usr/bin/env node
// Converts the Playwright video (test-results/portfolio-raw/video.webm)
// into docs/assets/duel-demo.gif via ffmpeg's two-pass palette workflow.
// Consumed by: npm run capture:assets. Produces: docs/assets/duel-demo.gif.
// Invariant: fails if the produced GIF exceeds 10 MB — no bloated assets land.

import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const SOURCE_VIDEO = path.join(REPO_ROOT, "test-results/portfolio-raw/video.webm");
const OUTPUT_GIF = path.join(REPO_ROOT, "docs/assets/duel-demo.gif");
const PALETTE_PATH = path.join(REPO_ROOT, "test-results/portfolio-raw/palette.png");

const FPS = 14;
const SCALE_WIDTH = 1000;
const MAX_BYTES = 10 * 1024 * 1024;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  if (!existsSync(SOURCE_VIDEO)) {
    throw new Error(
      `Source video not found at ${SOURCE_VIDEO}. Run \`CAPTURE_ASSETS=1 npx playwright test browser-tests/portfolio-video-capture.spec.ts\` first.`
    );
  }

  await mkdir(path.dirname(OUTPUT_GIF), { recursive: true });
  await rm(OUTPUT_GIF, { force: true });
  await rm(PALETTE_PATH, { force: true });

  // Pass 1: build an optimized palette from the source video. stats_mode=diff
  // biases the palette toward moving regions (the tactical scope, projectiles).
  // -update 1 -frames:v 1 tells ffmpeg this is a single PNG, not an image sequence.
  await run("ffmpeg", [
    "-y",
    "-i",
    SOURCE_VIDEO,
    "-vf",
    `fps=${FPS},scale=${SCALE_WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff`,
    "-update",
    "1",
    "-frames:v",
    "1",
    PALETTE_PATH
  ]);

  // Pass 2: render the GIF using that palette with bayer dithering.
  // diff_mode=rectangle keeps static regions stable between frames, shrinking the file.
  await run("ffmpeg", [
    "-y",
    "-i",
    SOURCE_VIDEO,
    "-i",
    PALETTE_PATH,
    "-filter_complex",
    `fps=${FPS},scale=${SCALE_WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    OUTPUT_GIF
  ]);

  const gifStats = await stat(OUTPUT_GIF);
  const sizeMB = gifStats.size / (1024 * 1024);

  console.log(`\nCaptured ${OUTPUT_GIF}`);
  console.log(`  size: ${sizeMB.toFixed(2)} MB (${gifStats.size} bytes)`);
  console.log(`  fps:  ${FPS}`);
  console.log(`  width: ${SCALE_WIDTH}px`);

  if (gifStats.size > MAX_BYTES) {
    await rm(OUTPUT_GIF, { force: true });
    throw new Error(
      `GIF exceeds 10 MB hard limit (${sizeMB.toFixed(2)} MB). Removed bloated output. Tune FPS or SCALE_WIDTH and re-run.`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
