import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer } from "ws";
import { validateBattleState, validatePlotSubmission } from "../shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function bootstrap() {
  const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
  const server = createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(400).end("missing URL");
      return;
    }

    if (request.method === "GET" && request.url === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          matchId: battleState.match_setup.match_id,
          rulesId: battleState.match_setup.rules.id,
          participantCount: battleState.match_setup.participants.length,
          shipCatalogCount: Object.keys(battleState.match_setup.ship_catalog).length
        })
      );
      return;
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
    client.send(
      JSON.stringify({
        type: "hello",
        matchId: battleState.match_setup.match_id,
        turnNumber: battleState.turn_number
      })
    );

    client.on("message", (payload) => {
      try {
        const parsed = JSON.parse(payload.toString()) as { type?: string; plot?: unknown };

        if (parsed.type !== "submit_plot") {
          client.send(JSON.stringify({ type: "error", message: "unknown message type" }));
          return;
        }

        const plot = validatePlotSubmission(parsed.plot, battleState);

        client.send(
          JSON.stringify({
            type: "plot_accepted",
            shipInstanceId: plot.ship_instance_id,
            turnNumber: plot.turn_number
          })
        );
      } catch (error) {
        client.send(
          JSON.stringify({
            type: "plot_rejected",
            message: error instanceof Error ? error.message : "unknown validation error"
          })
        );
      }
    });
  });

  const host = "127.0.0.1";
  const port = 8000;

  server.listen(port, host, () => {
    console.log(`space_game_2 server listening on http://${host}:${port}`);
  });
}

void bootstrap();
