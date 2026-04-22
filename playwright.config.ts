import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const port = Number.parseInt(process.env.PLAYWRIGHT_SERVER_PORT ?? "4174", 10);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const chromeExecutablePath = process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH
  ? process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH
  : existsSync("/usr/bin/google-chrome")
    ? "/usr/bin/google-chrome"
    : undefined;

export default defineConfig({
  testDir: "./browser-tests",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
    viewport: {
      width: 1600,
      height: 1000
    },
    ...(chromeExecutablePath
      ? {
          launchOptions: {
            executablePath: chromeExecutablePath
          }
        }
      : {})
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "node scripts/start-browser-smoke-server.mjs",
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
      }
});
