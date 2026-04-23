import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { validateBattleState, type BattleState } from "../src/shared/index.js";
import { createSpaceGameServer, type SpaceGameServer } from "../src/server/app.js";

export const DEFAULT_ADMIN_TOKEN = "browser-smoke-token";
const DEFAULT_FIXTURE_PATH = "fixtures/battle_states/default_duel_turn_1.json";

type StartedServerOptions = {
  fixturePath?: string;
  initialBattleState?: BattleState;
  adminToken?: string | null;
  reconnectGraceMs?: number;
};

export type StartedBridgeServer = {
  app: SpaceGameServer;
  origin: string;
  close: () => Promise<void>;
};

export type BridgePage = {
  context: BrowserContext;
  page: Page;
};

export async function loadBattleStateFixture(relativePath = DEFAULT_FIXTURE_PATH): Promise<BattleState> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return validateBattleState(JSON.parse(raw) as unknown);
}

async function getAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("failed to allocate a TCP port"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

export async function startBridgeServer(options: StartedServerOptions = {}): Promise<StartedBridgeServer> {
  const port = await getAvailablePort();
  const fixturePath = options.fixturePath ?? DEFAULT_FIXTURE_PATH;
  const app = await createSpaceGameServer({
    initial_battle_state: options.initialBattleState,
    config: {
      host: "127.0.0.1",
      port,
      battle_state_fixture_path: fixturePath,
      admin_token: options.adminToken ?? DEFAULT_ADMIN_TOKEN,
      external_origin: null,
      reconnect_grace_ms: options.reconnectGraceMs ?? 120_000
    }
  });
  const address = await app.listen();
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    app,
    origin,
    close: async () => {
      await app.close();
    }
  };
}

export async function openBridgePage(
  browser: Browser,
  origin: string,
  options: { expectedTurnLabel?: string } = {}
): Promise<BridgePage> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(origin);
  await expect(page.locator("[data-turn-number]")).toHaveText(options.expectedTurnLabel ?? "Turn 1");

  return { context, page };
}

export async function closeBridgePages(...pages: BridgePage[]): Promise<void> {
  await Promise.all(pages.map(async ({ context }) => await context.close()));
}

export async function submitPlot(page: Page): Promise<void> {
  await page.locator("[data-submit-plot]").click();
}

export async function setStoredAdminToken(page: Page, token = DEFAULT_ADMIN_TOKEN): Promise<void> {
  await page.evaluate(
    ([storageKey, value]) => {
      window.localStorage.setItem(storageKey, value);
    },
    ["sg2_admin_token", token]
  );
}

export function acceptNextConfirm(page: Page): void {
  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
}

export function fixturePath(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}
