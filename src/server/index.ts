import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { validateBattleState } from "../shared/index.js";
import type { ClientToServerMessage, ServerToClientMessage } from "../shared/network.js";
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

async function bootstrap() {
  const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
  const session = new MatchSession(battleState);
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

  const server = createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(400).end("missing URL");
      return;
    }

    const pathname = new URL(request.url, "http://127.0.0.1").pathname;

    if (request.method === "GET" && pathname === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          matchId: session.getView().battle_state.match_setup.match_id,
          rulesId: session.getView().battle_state.match_setup.rules.id,
          participantCount: session.getView().battle_state.match_setup.participants.length,
          shipCatalogCount: Object.keys(session.getView().battle_state.match_setup.ship_catalog).length
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

  const host = "127.0.0.1";
  const port = 8000;

  server.listen(port, host, () => {
    console.log(`space_game_2 server listening on http://${host}:${port}`);
  });
}

void bootstrap();
