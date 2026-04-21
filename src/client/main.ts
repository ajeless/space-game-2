import "./style.css";

type HealthResponse = {
  ok: boolean;
  matchId: string;
  rulesId: string;
  participantCount: number;
  shipCatalogCount: number;
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root");
}

app.innerHTML = `
  <main class="shell">
    <header class="shell__header">
      <h1 class="shell__title">space_game_2 foundation scaffold</h1>
      <span id="ws-status" class="status--warn">WS: connecting</span>
    </header>
    <section class="shell__body">
      <article class="panel">
        <h2>Host Health</h2>
        <dl class="kv" id="health-kv"></dl>
      </article>
      <article class="panel">
        <h2>What Exists</h2>
        <p>Shared contracts and validation, canonical JSON config, battle/plot fixtures, and a minimal Node host plus browser shell.</p>
      </article>
      <article class="panel">
        <h2>Next Step</h2>
        <p>Use the shared contracts and fixtures as the only authority while the resolver skeleton lands.</p>
      </article>
    </section>
  </main>
`;

const healthRoot = document.querySelector<HTMLDListElement>("#health-kv");
const wsStatus = document.querySelector<HTMLSpanElement>("#ws-status");

async function loadHealth(): Promise<void> {
  const response = await fetch("/api/health");
  const payload = (await response.json()) as HealthResponse;

  if (!healthRoot) {
    return;
  }

  healthRoot.innerHTML = `
    <dt>Status</dt><dd class="${payload.ok ? "status--ok" : "status--warn"}">${payload.ok ? "ok" : "not ok"}</dd>
    <dt>Match</dt><dd>${payload.matchId}</dd>
    <dt>Rules</dt><dd>${payload.rulesId}</dd>
    <dt>Participants</dt><dd>${payload.participantCount}</dd>
    <dt>Ship Catalog</dt><dd>${payload.shipCatalogCount}</dd>
  `;
}

function connectWebSocket(): void {
  if (!wsStatus) {
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  socket.addEventListener("open", () => {
    wsStatus.textContent = "WS: connected";
    wsStatus.className = "status--ok";
  });

  socket.addEventListener("close", () => {
    wsStatus.textContent = "WS: closed";
    wsStatus.className = "status--warn";
  });

  socket.addEventListener("error", () => {
    wsStatus.textContent = "WS: error";
    wsStatus.className = "status--warn";
  });
}

void loadHealth();
connectWebSocket();
