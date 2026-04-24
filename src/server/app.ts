import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { validateBattleState, type BattleState } from "../shared/index.js";
import type { ClientToServerMessage, ServerToClientMessage } from "../shared/network.js";
import { getServerConfig, type ServerConfig } from "./config.js";
import { MatchSession } from "./session.js";

const CLIENT_DIST_ROOT = path.resolve(process.cwd(), "dist/client");

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

export interface SpaceGameServer {
  config: ServerConfig;
  session: MatchSession;
  server: HttpServer;
  websocket_server: WebSocketServer;
  listen(): Promise<AddressInfo>;
  close(): Promise<void>;
}

interface CreateSpaceGameServerOptions {
  config?: ServerConfig;
  initial_battle_state?: BattleState;
}

interface BootstrapOptions extends CreateSpaceGameServerOptions {
  log?: (message: string) => void;
}

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function loadBattleState(relativePath: string): Promise<BattleState> {
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

function getAddressInfo(server: HttpServer): AddressInfo {
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("server is not listening on a TCP address");
  }

  return address;
}

export async function createSpaceGameServer(
  options: CreateSpaceGameServerOptions = {}
): Promise<SpaceGameServer> {
  const config = options.config ?? getServerConfig();
  const initialBattleState = validateBattleState(
    options.initial_battle_state ?? (await loadBattleState(config.battle_state_fixture_path))
  );
  const session = new MatchSession(initialBattleState, {
    reconnect_grace_ms: config.reconnect_grace_ms
  });
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
      externalOrigin: config.external_origin,
      reconnectGraceMs: config.reconnect_grace_ms
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
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (requestUrl.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (client) => {
      websocketServer.emit("connection", client, request);
    });
  });

  websocketServer.on("connection", (client, request) => {
    const clientId = `client_${nextClientId}`;
    nextClientId += 1;
    clients.set(clientId, client);
    const requestUrl = new URL(request.url ?? "/ws", "http://127.0.0.1");
    const reconnectToken = requestUrl.searchParams.get("reconnectToken");
    const connectionResult = session.connectClient(clientId, reconnectToken);

    if (connectionResult.displaced_client_id) {
      send(connectionResult.displaced_client_id, {
        type: "error",
        message: "session resumed in another browser tab"
      });
      clients.get(connectionResult.displaced_client_id)?.close(4001, "session resumed elsewhere");
      clients.delete(connectionResult.displaced_client_id);
    }

    send(clientId, {
      type: "hello",
      identity: connectionResult.identity,
      session: session.getView()
    });
    broadcast({
      type: "session_state",
      session: session.getView()
    });

    client.on("message", (payload) => {
      try {
        const parsed = JSON.parse(payload.toString()) as ClientToServerMessage;

        if (parsed.type === "claim_slot") {
          const claim = session.claimSlot(clientId, parsed.slot_id);

          send(clientId, {
            type: "hello",
            identity: claim.identity,
            session: claim.session
          });
          broadcast({
            type: "session_state",
            session: claim.session
          });
          return;
        }

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

  return {
    config,
    session,
    server,
    websocket_server: websocketServer,
    listen: async () =>
      await new Promise<AddressInfo>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("error", onError);
          reject(error);
        };

        server.once("error", onError);
        server.listen(config.port, config.host, () => {
          server.off("error", onError);
          resolve(getAddressInfo(server));
        });
      }),
    close: async () => {
      for (const client of clients.values()) {
        client.terminate();
      }
      clients.clear();

      await new Promise<void>((resolve, reject) => {
        websocketServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      if (!server.listening) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<SpaceGameServer> {
  const app = await createSpaceGameServer(options);
  const address = await app.listen();
  const log = options.log ?? console.log;

  log(`Burn Vector server listening on http://${address.address}:${address.port}`);

  if (app.config.external_origin) {
    log(`external origin: ${app.config.external_origin}`);
  }

  log(`fixture: ${app.config.battle_state_fixture_path}`);
  log(`session reset: ${app.config.admin_token ? "enabled" : "disabled"}`);

  return app;
}
