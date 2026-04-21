import "./style.css";
import type { MatchSessionView, ServerToClientMessage, SessionIdentity } from "../shared/index.js";
import type {
  BattleBoundary,
  PlotSubmission,
  ShipConfig,
  ShipInstanceId,
  ShipRuntimeState,
  Vector2
} from "../shared/index.js";

type HealthResponse = {
  ok: boolean;
  matchId: string;
  rulesId: string;
  participantCount: number;
  shipCatalogCount: number;
};

type PlotPresetId = "balanced" | "charge" | "reposition";

interface PlotPreset {
  id: PlotPresetId;
  label: string;
  description: string;
  drivePips: number;
  railgunPips: number;
  chargePips: number;
  headingDeltaDegrees: number;
  knots: (frame: { advanceSign: number; lateralSign: number }) => Array<{
    t: number;
    thrust_fraction: Vector2;
  }>;
}

const PLOT_PRESETS: PlotPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Moderate turn, moderate drive, 2-pip shot.",
    drivePips: 6,
    railgunPips: 2,
    chargePips: 2,
    headingDeltaDegrees: 15,
    knots: ({ advanceSign, lateralSign }) => [
      { t: 0, thrust_fraction: { x: 0, y: 0.15 * advanceSign } },
      { t: 0.5, thrust_fraction: { x: 0.1 * lateralSign, y: 0.1 * advanceSign } },
      { t: 1, thrust_fraction: { x: 0.05 * lateralSign, y: 0 } }
    ]
  },
  {
    id: "charge",
    label: "Charge",
    description: "Heavier gun commitment with a steeper bow change.",
    drivePips: 5,
    railgunPips: 3,
    chargePips: 3,
    headingDeltaDegrees: 30,
    knots: ({ advanceSign, lateralSign }) => [
      { t: 0, thrust_fraction: { x: 0, y: 0.18 * advanceSign } },
      { t: 0.5, thrust_fraction: { x: 0.06 * lateralSign, y: 0.16 * advanceSign } },
      { t: 1, thrust_fraction: { x: 0.02 * lateralSign, y: 0.08 * advanceSign } }
    ]
  },
  {
    id: "reposition",
    label: "Reposition",
    description: "Pure drive turn with no shot authorization.",
    drivePips: 8,
    railgunPips: 0,
    chargePips: 0,
    headingDeltaDegrees: 45,
    knots: ({ advanceSign, lateralSign }) => [
      { t: 0, thrust_fraction: { x: 0.08 * lateralSign, y: 0.08 * advanceSign } },
      { t: 0.5, thrust_fraction: { x: 0.18 * lateralSign, y: 0.06 * advanceSign } },
      { t: 1, thrust_fraction: { x: 0.14 * lateralSign, y: 0 } }
    ]
  }
];

function getRootElement(): HTMLDivElement {
  const candidate = document.querySelector<HTMLDivElement>("#app");

  if (!candidate) {
    throw new Error("Missing #app root");
  }

  return candidate;
}

const root = getRootElement();

let health: HealthResponse | null = null;
let wsState: "connecting" | "connected" | "closed" | "error" = "connecting";
let identity: SessionIdentity | null = null;
let session: MatchSessionView | null = null;
let socket: WebSocket | null = null;
const messages: string[] = [];

function logMessage(message: string): void {
  messages.unshift(message);
  messages.splice(8);
}

function formatNumber(value: number): string {
  return value.toFixed(3);
}

function getFrameSigns(identityValue: SessionIdentity): { advanceSign: number; lateralSign: number } {
  if (identityValue.slot_id === "bravo") {
    return {
      advanceSign: 1,
      lateralSign: -1
    };
  }

  return {
    advanceSign: -1,
    lateralSign: 1
  };
}

type RectangleBoundary = Extract<BattleBoundary, { kind: "rectangle" }>;

const TACTICAL_VIEWPORT = {
  width: 960,
  height: 560,
  padding: 36,
  hullScalePx: 44,
  headingVectorLengthPx: 28,
  velocityProjectionDistance: 120000
} as const;

function normalizeDegrees(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function getRectangleBoundary(sessionValue: MatchSessionView): RectangleBoundary | null {
  const boundary = sessionValue.battle_state.match_setup.battlefield.boundary;

  return boundary.kind === "rectangle" ? boundary : null;
}

function worldToViewport(point: Vector2, boundary: RectangleBoundary): Vector2 {
  const width = boundary.max.x - boundary.min.x;
  const height = boundary.max.y - boundary.min.y;
  const drawableWidth = TACTICAL_VIEWPORT.width - TACTICAL_VIEWPORT.padding * 2;
  const drawableHeight = TACTICAL_VIEWPORT.height - TACTICAL_VIEWPORT.padding * 2;

  return {
    x: TACTICAL_VIEWPORT.padding + ((point.x - boundary.min.x) / width) * drawableWidth,
    y:
      TACTICAL_VIEWPORT.height -
      TACTICAL_VIEWPORT.padding -
      ((point.y - boundary.min.y) / height) * drawableHeight
  };
}

function getHeadingVector(headingDegrees: number, length: number): Vector2 {
  const radians = (headingDegrees * Math.PI) / 180;

  return {
    x: Math.sin(radians) * length,
    y: -Math.cos(radians) * length
  };
}

function getShipHullPoints(shipConfig: ShipConfig, center: Vector2): string {
  return shipConfig.hull.silhouette
    .map((point) => {
      const x = center.x + point.x * TACTICAL_VIEWPORT.hullScalePx;
      const y = center.y + point.y * TACTICAL_VIEWPORT.hullScalePx;

      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function renderGuideLines(): string {
  const lines: string[] = [];
  const steps = 4;
  const innerWidth = TACTICAL_VIEWPORT.width - TACTICAL_VIEWPORT.padding * 2;
  const innerHeight = TACTICAL_VIEWPORT.height - TACTICAL_VIEWPORT.padding * 2;

  for (let step = 0; step <= steps; step += 1) {
    const x = TACTICAL_VIEWPORT.padding + (innerWidth * step) / steps;
    const y = TACTICAL_VIEWPORT.padding + (innerHeight * step) / steps;

    lines.push(
      `<line class="tactical-board__grid-line" x1="${x}" y1="${TACTICAL_VIEWPORT.padding}" x2="${x}" y2="${
        TACTICAL_VIEWPORT.height - TACTICAL_VIEWPORT.padding
      }" />`
    );
    lines.push(
      `<line class="tactical-board__grid-line" x1="${TACTICAL_VIEWPORT.padding}" y1="${y}" x2="${
        TACTICAL_VIEWPORT.width - TACTICAL_VIEWPORT.padding
      }" y2="${y}" />`
    );
  }

  return lines.join("");
}

function renderShipGlyph(
  sessionValue: MatchSessionView,
  identityValue: SessionIdentity | null,
  ship: ShipRuntimeState,
  shipConfig: ShipConfig,
  slotLabel: string,
  boundary: RectangleBoundary
): string {
  const center = worldToViewport(ship.pose.position, boundary);
  const hullPoints = getShipHullPoints(shipConfig, center);
  const headingVector = getHeadingVector(ship.pose.heading_degrees, TACTICAL_VIEWPORT.headingVectorLengthPx);
  const velocityProjection = worldToViewport(
    {
      x: ship.pose.position.x + ship.pose.velocity.x * TACTICAL_VIEWPORT.velocityProjectionDistance,
      y: ship.pose.position.y + ship.pose.velocity.y * TACTICAL_VIEWPORT.velocityProjectionDistance
    },
    boundary
  );
  const classes = [
    "ship-glyph",
    identityValue?.ship_instance_id === ship.ship_instance_id ? "ship-glyph--self" : "",
    sessionValue.pending_plot_ship_ids.includes(ship.ship_instance_id) ? "ship-glyph--pending" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <g class="${classes}">
      <line
        class="ship-glyph__velocity"
        x1="${center.x.toFixed(2)}"
        y1="${center.y.toFixed(2)}"
        x2="${velocityProjection.x.toFixed(2)}"
        y2="${velocityProjection.y.toFixed(2)}"
      />
      <polygon class="ship-glyph__hull" points="${hullPoints}" transform="rotate(${ship.pose.heading_degrees.toFixed(
        2
      )} ${center.x.toFixed(2)} ${center.y.toFixed(2)})" />
      <line
        class="ship-glyph__heading"
        x1="${center.x.toFixed(2)}"
        y1="${center.y.toFixed(2)}"
        x2="${(center.x + headingVector.x).toFixed(2)}"
        y2="${(center.y + headingVector.y).toFixed(2)}"
      />
      <circle class="ship-glyph__core" cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" r="4" />
      <text class="ship-glyph__label" x="${center.x.toFixed(2)}" y="${(center.y - 20).toFixed(2)}">
        ${slotLabel} · ${ship.ship_instance_id}
      </text>
    </g>
  `;
}

function renderTacticalViewport(sessionValue: MatchSessionView | null, identityValue: SessionIdentity | null): string {
  if (!sessionValue) {
    return "<p>Waiting for the session snapshot before rendering the tactical board.</p>";
  }

  const boundary = getRectangleBoundary(sessionValue);

  if (!boundary) {
    return "<p>The current battlefield boundary is not yet supported by the tactical viewport.</p>";
  }

  const ships = sessionValue.battle_state.match_setup.participants
    .map((participant) => {
      const ship = sessionValue.battle_state.ships[participant.ship_instance_id];
      const shipConfig = sessionValue.battle_state.match_setup.ship_catalog[participant.ship_config_id];

      if (!ship || !shipConfig) {
        return "";
      }

      return renderShipGlyph(sessionValue, identityValue, ship, shipConfig, participant.slot_id.toUpperCase(), boundary);
    })
    .join("");

  return `
    <div class="tactical-board">
      <svg viewBox="0 0 ${TACTICAL_VIEWPORT.width} ${TACTICAL_VIEWPORT.height}" aria-label="Tactical viewport">
        <rect
          class="tactical-board__frame"
          x="${TACTICAL_VIEWPORT.padding}"
          y="${TACTICAL_VIEWPORT.padding}"
          width="${TACTICAL_VIEWPORT.width - TACTICAL_VIEWPORT.padding * 2}"
          height="${TACTICAL_VIEWPORT.height - TACTICAL_VIEWPORT.padding * 2}"
          rx="18"
        />
        ${renderGuideLines()}
        <line
          class="tactical-board__axis"
          x1="${TACTICAL_VIEWPORT.width / 2}"
          y1="${TACTICAL_VIEWPORT.padding}"
          x2="${TACTICAL_VIEWPORT.width / 2}"
          y2="${TACTICAL_VIEWPORT.height - TACTICAL_VIEWPORT.padding}"
        />
        <line
          class="tactical-board__axis"
          x1="${TACTICAL_VIEWPORT.padding}"
          y1="${TACTICAL_VIEWPORT.height / 2}"
          x2="${TACTICAL_VIEWPORT.width - TACTICAL_VIEWPORT.padding}"
          y2="${TACTICAL_VIEWPORT.height / 2}"
        />
        ${ships}
      </svg>
      <div class="tactical-board__caption">
        <span>North is up. Hulls show heading, trails show projected drift.</span>
        <span>Highlighted frame marks your assigned ship. Amber frame means that ship has already submitted a plot.</span>
      </div>
    </div>
  `;
}

function getTargetShipInstanceId(sessionValue: MatchSessionView, selfShipId: ShipInstanceId): ShipInstanceId {
  const target = sessionValue.battle_state.match_setup.participants.find(
    (participant) => participant.ship_instance_id !== selfShipId
  )?.ship_instance_id;

  if (!target) {
    throw new Error("Could not determine target ship for preset plot");
  }

  return target;
}

function buildPresetPlot(presetId: PlotPresetId): PlotSubmission {
  if (!identity || !session || identity.role !== "player" || !identity.ship_instance_id) {
    throw new Error("No playable ship is assigned to this client");
  }

  const preset = PLOT_PRESETS.find((candidate) => candidate.id === presetId);

  if (!preset) {
    throw new Error(`Unknown preset '${presetId}'`);
  }

  const ship = session.battle_state.ships[identity.ship_instance_id];

  if (!ship) {
    throw new Error(`Session is missing ship '${identity.ship_instance_id}'`);
  }

  const targetShipInstanceId = getTargetShipInstanceId(session, identity.ship_instance_id);
  const frame = getFrameSigns(identity);

  return {
    schema_version: "sg2/v0.1",
    match_id: session.battle_state.match_setup.match_id,
    turn_number: session.battle_state.turn_number,
    ship_instance_id: identity.ship_instance_id,
    power: {
      drive_pips: preset.drivePips,
      railgun_pips: preset.railgunPips
    },
    maneuver: {
      desired_end_heading_degrees: normalizeDegrees(ship.pose.heading_degrees + preset.headingDeltaDegrees),
      translation_plan: {
        kind: "piecewise_linear",
        frame: "world",
        knots: preset.knots(frame)
      }
    },
    weapons:
      preset.chargePips > 0
        ? [
            {
              mount_id: "forward_mount",
              target_ship_instance_id: targetShipInstanceId,
              fire_mode: "best_shot_this_turn",
              charge_pips: preset.chargePips
            }
          ]
        : []
  };
}

function render(): void {
  const sessionValue = session;
  const tacticalViewport = renderTacticalViewport(sessionValue, identity);
  const shipCards =
    sessionValue?.battle_state.match_setup.participants
      .map((participant) => {
        const ship = sessionValue.battle_state.ships[participant.ship_instance_id];

        if (!ship) {
          return "";
        }

        return `
          <article class="card">
            <h3>${participant.slot_id.toUpperCase()} · ${participant.ship_instance_id}</h3>
            <dl class="kv">
              <dt>Heading</dt><dd>${formatNumber(ship.pose.heading_degrees)}°</dd>
              <dt>Position</dt><dd>${formatNumber(ship.pose.position.x)}, ${formatNumber(ship.pose.position.y)}</dd>
              <dt>Velocity</dt><dd>${formatNumber(ship.pose.velocity.x)}, ${formatNumber(ship.pose.velocity.y)}</dd>
              <dt>Status</dt><dd>${ship.status}</dd>
            </dl>
          </article>
        `;
      })
      .join("") ?? "<p>No session state yet.</p>";

  const resolutionLines =
    sessionValue?.last_resolution?.events
      .slice(-8)
      .map(
        (event) =>
          `<li><code>T${event.sub_tick}</code> <strong>${event.type}</strong>${
            event.actor ? ` · ${event.actor}` : ""
          }</li>`
      )
      .join("") ?? "";

  const presetButtons =
    identity?.role === "player"
      ? PLOT_PRESETS.map(
          (preset) => `
            <button class="button" data-preset="${preset.id}">
              <span>${preset.label}</span>
              <small>${preset.description}</small>
            </button>
          `
        ).join("")
      : "<p>Open a second browser session to claim the other player slot. Additional sessions join as spectators.</p>";

  root.innerHTML = `
    <main class="shell">
      <header class="shell__header">
        <div>
          <h1 class="shell__title">space_game_2 tactical loop</h1>
          <p class="shell__subtitle">Preset plots now flow through the live host session and shared resolver.</p>
        </div>
        <span class="${wsState === "connected" ? "status--ok" : "status--warn"}">WS: ${wsState}</span>
      </header>
      <section class="shell__body">
        <article class="panel">
          <h2>Session</h2>
          <dl class="kv">
            <dt>Match</dt><dd>${health?.matchId ?? "..."}</dd>
            <dt>Rules</dt><dd>${health?.rulesId ?? "..."}</dd>
            <dt>Turn</dt><dd>${sessionValue?.battle_state.turn_number ?? "..."}</dd>
            <dt>Role</dt><dd>${identity ? `${identity.role}${identity.slot_id ? ` · ${identity.slot_id}` : ""}` : "..."}</dd>
            <dt>Ship</dt><dd>${identity?.ship_instance_id ?? "unassigned"}</dd>
            <dt>Pending</dt><dd>${sessionValue?.pending_plot_ship_ids.join(", ") || "none"}</dd>
            <dt>Occupied Slots</dt><dd>${sessionValue?.occupied_slot_ids.join(", ") || "none"}</dd>
          </dl>
        </article>
        <article class="panel">
          <h2>Plot Presets</h2>
          <div class="button-grid">${presetButtons}</div>
        </article>
        <article class="panel panel--wide">
          <h2>Tactical View</h2>
          ${tacticalViewport}
        </article>
        <article class="panel">
          <h2>Last Resolution</h2>
          ${
            sessionValue?.last_resolution
              ? `
                <p>Resolved turn ${sessionValue.last_resolution.resolved_from_turn_number} with ${sessionValue.last_resolution.event_count} events.</p>
                <ul class="log-list">${resolutionLines}</ul>
              `
              : "<p>No turn has resolved yet.</p>"
          }
        </article>
        <article class="panel panel--wide">
          <h2>Ship State</h2>
          <div class="card-grid">${shipCards}</div>
        </article>
        <article class="panel panel--wide">
          <h2>Message Log</h2>
          <ul class="log-list">
            ${
              messages.length > 0
                ? messages.map((message) => `<li>${message}</li>`).join("")
                : "<li>No websocket traffic yet.</li>"
            }
          </ul>
        </article>
      </section>
    </main>
  `;

  document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const presetId = button.dataset.preset as PlotPresetId | undefined;

      if (!presetId || !socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        const plot = buildPresetPlot(presetId);

        socket.send(
          JSON.stringify({
            type: "submit_plot",
            plot
          })
        );
        logMessage(`submitted ${presetId} plot for ${plot.ship_instance_id} on turn ${plot.turn_number}`);
        render();
      } catch (error) {
        logMessage(error instanceof Error ? error.message : "failed to build plot");
        render();
      }
    });
  });
}

async function loadHealth(): Promise<void> {
  const response = await fetch("/api/health");
  health = (await response.json()) as HealthResponse;
  render();
}

function handleServerMessage(message: ServerToClientMessage): void {
  if (message.type === "hello") {
    identity = message.identity;
    session = message.session;
    logMessage(
      `hello received · ${message.identity.role}${message.identity.slot_id ? ` · ${message.identity.slot_id}` : ""}`
    );
    render();
    return;
  }

  if (message.type === "session_state") {
    session = message.session;
    logMessage(`session updated · turn ${message.session.battle_state.turn_number}`);
    render();
    return;
  }

  if (message.type === "plot_accepted") {
    logMessage(
      `plot accepted for ${message.shipInstanceId} · pending ${message.pendingPlotShipIds.join(", ") || "none"}`
    );
    render();
    return;
  }

  if (message.type === "plot_rejected" || message.type === "error") {
    logMessage(message.message);
    render();
  }
}

function connectWebSocket(): void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  socket.addEventListener("open", () => {
    wsState = "connected";
    render();
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data) as ServerToClientMessage;
    handleServerMessage(message);
  });

  socket.addEventListener("close", () => {
    wsState = "closed";
    render();
  });

  socket.addEventListener("error", () => {
    wsState = "error";
    render();
  });
}

render();
void loadHealth();
connectWebSocket();
