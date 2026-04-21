import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { validateBattleState } from "../shared/index.js";
import type { ClientToServerMessage, ServerToClientMessage } from "../shared/network.js";
import { getServerConfig } from "./config.js";
import { MatchSession } from "./session.js";

const CLIENT_DIST_ROOT = path.resolve(process.cwd(), "dist/client");

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function loadBattleState(relativePath: string) {
  return validateBattleState(await readJson(relativePath));
}

async function readRequestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function getContentType(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream";
}

function getClientAssetPath(pathname: string): string | null {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const resolvedPath = path.resolve(CLIENT_DIST_ROOT, `.${normalizedPath}`);

  return resolvedPath.startsWith(CLIENT_DIST_ROOT) ? resolvedPath : null;
}

async function serveClientAsset(pathname: string, response: ServerResponse): Promise<boolean> {
  const assetPath = getClientAssetPath(pathname);

  if (!assetPath) {
    response.writeHead(400).end("bad asset path");
    return true;
  }

  try {
    const body = await readFile(assetPath);
    response.writeHead(200, { "content-type": getContentType(assetPath) });
    response.end(body);
    return true;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  if (pathname === "/" || !path.extname(pathname)) {
    try {
      const indexPath = path.resolve(CLIENT_DIST_ROOT, "index.html");
      const body = await readFile(indexPath);
      response.writeHead(200, { "content-type": getContentType(indexPath) });
      response.end(body);
      return true;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }

      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      response.end("Client build not found. Run 'npm run build' or start the Vite client.");
      return true;
    }
  }

  return false;
}

function getResetToken(request: IncomingMessage, requestUrl: URL, body: unknown): string | null {
  const headerToken = request.headers["x-sg2-admin-token"];
  const headerValue = typeof headerToken === "string" ? headerToken : null;
  const queryToken = requestUrl.searchParams.get("token");
  const bodyToken =
    body && typeof body === "object" && "adminToken" in body && typeof body.adminToken === "string"
      ? body.adminToken
      : null;

  return headerValue ?? queryToken ?? bodyToken;
}

async function bootstrap() {
  const config = getServerConfig();
  const initialBattleState = await loadBattleState(config.battle_state_fixture_path);
  const session = new MatchSession(initialBattleState);
  let nextClientId = 1;
  const clients = new Map<string, WebSocket>();

  function send(clientId: string, message: ServerToClientMessage): void {
    const client = clients.get(clientId);

    if (!client || client.readyState !== WebSocket.OPEN) {
      return;
    }

    client.send(JSON.stringify(message));
  }

  function broadcast(message: ServerToClientMessage): void {
    for (const clientId of clients.keys()) {
      send(clientId, message);
    }
  }

  function makeHealthPayload() {
    const view = session.getView();

    return {
      ok: true,
      matchId: view.battle_state.match_setup.match_id,
      rulesId: view.battle_state.match_setup.rules.id,
      participantCount: view.battle_state.match_setup.participants.length,
      shipCatalogCount: Object.keys(view.battle_state.match_setup.ship_catalog).length,
      occupiedSlotCount: view.occupied_slot_ids.length,
      websocketPath: "/ws",
      resetEnabled: config.admin_token !== null,
      fixturePath: config.battle_state_fixture_path,
      host: config.host,
      port: config.port,
      externalOrigin: config.external_origin
    };
  }

  const server = createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(400).end("missing URL");
      return;
    }

    const requestUrl = new URL(request.url, "http://127.0.0.1");
    const pathname = requestUrl.pathname;

    if (request.method === "GET" && pathname === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(makeHealthPayload()));
      return;
    }

    if (request.method === "POST" && pathname === "/api/session/reset") {
      if (!config.admin_token) {
        response.writeHead(403, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            ok: false,
            message: "session reset is disabled until SG2_ADMIN_TOKEN is configured"
          })
        );
        return;
      }

      const rawBody = await readRequestText(request);
      const body =
        rawBody.trim().length === 0
          ? null
          : (() => {
              try {
                return JSON.parse(rawBody) as unknown;
              } catch {
                return undefined;
              }
            })();

      if (body === undefined) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, message: "invalid JSON body" }));
        return;
      }

      const resetToken = getResetToken(request, requestUrl, body);

      if (resetToken !== config.admin_token) {
        response.writeHead(403, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, message: "invalid admin token" }));
        return;
      }

      const freshState = await loadBattleState(config.battle_state_fixture_path);
      const resetView = session.reset(freshState);

      broadcast({
        type: "session_reset",
        matchId: resetView.battle_state.match_setup.match_id,
        turnNumber: resetView.battle_state.turn_number
      });
      broadcast({
        type: "session_state",
        session: resetView
      });

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          matchId: resetView.battle_state.match_setup.match_id,
          turnNumber: resetView.battle_state.turn_number
        })
      );
      return;
    }

    if (request.method === "GET" && (pathname === "/" || pathname.startsWith("/assets/"))) {
      if (await serveClientAsset(pathname, response)) {
        return;
      }
    }

    response.writeHead(404).end("not found");
  });
  const websocketServer = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") {
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request);
    });
  });

  websocketServer.on("connection", (client) => {
    const clientId = `client_${nextClientId}`;
    nextClientId += 1;
    clients.set(clientId, client);

    send(clientId, {
      type: "hello",
      identity: session.connectClient(clientId),
      session: session.getView()
    });
    broadcast({
      type: "session_state",
      session: session.getView()
    });

    client.on("message", (payload) => {
      try {
        const parsed = JSON.parse(payload.toString()) as ClientToServerMessage;

        if (parsed.type !== "submit_plot") {
          send(clientId, { type: "error", message: "unknown message type" });
          return;
        }

        const result = session.submitPlot(clientId, parsed.plot);

        broadcast({
          type: "plot_accepted",
          shipInstanceId: result.plot.ship_instance_id,
          turnNumber: result.plot.turn_number,
          pendingPlotShipIds: result.session.pending_plot_ship_ids
        });
        broadcast({
          type: "session_state",
          session: result.session
        });
      } catch (error) {
        send(clientId, {
          type: "plot_rejected",
          message: error instanceof Error ? error.message : "unknown validation error"
        });
      }
    });

    client.on("close", () => {
      session.disconnectClient(clientId);
      clients.delete(clientId);
      broadcast({
        type: "session_state",
        session: session.getView()
      });
    });
  });

  server.listen(config.port, config.host, () => {
    console.log(`space_game_2 server listening on http://${config.host}:${config.port}`);

    if (config.external_origin) {
      console.log(`external origin: ${config.external_origin}`);
    }

    console.log(`fixture: ${config.battle_state_fixture_path}`);
    console.log(`session reset: ${config.admin_token ? "enabled" : "disabled"}`);
  });
}

void bootstrap();
