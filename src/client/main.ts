import "./style.css";
import {
  buildPlotPreview,
  buildPlotSubmissionFromDraft,
  createPlotDraft,
  getArcPolygonPoints,
  getAvailableReactorPips,
  getShipConfig,
  getSystemStateAndEffects,
  summarizePlotDraft
} from "../shared/index.js";
import type { MatchSessionView, ServerToClientMessage, SessionIdentity } from "../shared/index.js";
import type {
  BattleBoundary,
  PlotDraft,
  PlotDraftSummary,
  PlotPreview,
  ShipConfig,
  ShipSystemConfig,
  ShipRuntimeState,
  SystemId,
  Vector2
} from "../shared/index.js";

type HealthResponse = {
  ok: boolean;
  matchId: string;
  rulesId: string;
  participantCount: number;
  shipCatalogCount: number;
};

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
let plotDraft: PlotDraft | null = null;
let selectedSystemId: SystemId | null = null;
const messages: string[] = [];

function logMessage(message: string): void {
  messages.unshift(message);
  messages.splice(8);
}

function formatNumber(value: number): string {
  return value.toFixed(3);
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

const SCHEMATIC_VIEWPORT = {
  width: 420,
  height: 620,
  centerX: 210,
  centerY: 262,
  scalePx: 208,
  systemWidth: 108,
  systemHeight: 38
} as const;

function normalizeDegrees(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatRole(identityValue: SessionIdentity | null): string {
  if (!identityValue) {
    return "...";
  }

  return `${identityValue.role}${identityValue.slot_id ? ` · ${identityValue.slot_id}` : ""}`;
}

function getDisplayedShipContext(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null
):
  | {
      participant: MatchSessionView["battle_state"]["match_setup"]["participants"][number];
      ship: ShipRuntimeState;
      shipConfig: ShipConfig;
    }
  | null {
  if (!sessionValue) {
    return null;
  }

  const preferredShipId =
    identityValue?.role === "player" && identityValue.ship_instance_id
      ? identityValue.ship_instance_id
      : sessionValue.battle_state.match_setup.participants[0]?.ship_instance_id;
  const participant = sessionValue.battle_state.match_setup.participants.find(
    (candidate) => candidate.ship_instance_id === preferredShipId
  );

  if (!participant) {
    return null;
  }

  const ship = sessionValue.battle_state.ships[participant.ship_instance_id];

  if (!ship) {
    return null;
  }

  return {
    participant,
    ship,
    shipConfig: getShipConfig(sessionValue.battle_state, ship)
  };
}

function getOpponentStatusLabel(sessionValue: MatchSessionView | null, identityValue: SessionIdentity | null): string {
  if (!sessionValue || !identityValue || identityValue.role !== "player" || !identityValue.ship_instance_id) {
    return "observer";
  }

  const opponent = sessionValue.battle_state.match_setup.participants.find(
    (participant) => participant.ship_instance_id !== identityValue.ship_instance_id
  );

  if (!opponent) {
    return "no contact";
  }

  const opponentShip = sessionValue.battle_state.ships[opponent.ship_instance_id];

  if (opponentShip?.status === "destroyed") {
    return `${opponent.slot_id} destroyed`;
  }

  if (opponentShip?.status === "disengaged") {
    return `${opponent.slot_id} disengaged`;
  }

  if (!sessionValue.occupied_slot_ids.includes(opponent.slot_id)) {
    return `${opponent.slot_id} disconnected`;
  }

  if (sessionValue.pending_plot_ship_ids.includes(opponent.ship_instance_id)) {
    return `${opponent.slot_id} ready`;
  }

  return `${opponent.slot_id} plotting`;
}

function getPhaseLabel(
  sessionValue: MatchSessionView | null,
  selectedSystemContext: ReturnType<typeof getSelectedSystemContext>
): string {
  if (!sessionValue) {
    return "CONNECTING";
  }

  if (selectedSystemContext?.system.type === "weapon_mount") {
    return "AIM MODE";
  }

  return "PLOT PHASE";
}

function formatSignedNumber(value: number, digits = 0): string {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

function getPlayerPlotSummary(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null
): PlotDraftSummary | null {
  if (!sessionValue || !identityValue || identityValue.role !== "player" || !identityValue.ship_instance_id) {
    plotDraft = null;
    return null;
  }

  const ship = sessionValue.battle_state.ships[identityValue.ship_instance_id];

  if (!ship || ship.status !== "active") {
    plotDraft = null;
    return null;
  }

  if (
    !plotDraft ||
    plotDraft.ship_instance_id !== identityValue.ship_instance_id ||
    plotDraft.turn_number !== sessionValue.battle_state.turn_number
  ) {
    plotDraft = createPlotDraft(sessionValue.battle_state, identityValue.ship_instance_id);
  }

  const summary = summarizePlotDraft(sessionValue.battle_state, plotDraft);
  plotDraft = summary.draft;

  return summary;
}

function getSelectedSystemContext(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null
):
  | {
      ship: ShipRuntimeState;
      system: ShipSystemConfig;
      integrity_percent: number;
      state_label: ReturnType<typeof getSystemStateAndEffects>["state_label"];
    }
  | null {
  if (!sessionValue || !selectedSystemId) {
    return null;
  }

  const displayed = getDisplayedShipContext(sessionValue, identityValue);

  if (!displayed) {
    selectedSystemId = null;
    return null;
  }

  const system = displayed.shipConfig.systems.find((candidate) => candidate.id === selectedSystemId);
  const runtimeSystem = selectedSystemId ? displayed.ship.systems[selectedSystemId] : undefined;

  if (!system || !runtimeSystem) {
    selectedSystemId = null;
    return null;
  }

  const stateAndEffects = getSystemStateAndEffects(sessionValue.battle_state, displayed.ship, system.id);

  return {
    ship: displayed.ship,
    system,
    integrity_percent: (runtimeSystem.current_integrity / system.max_integrity) * 100,
    state_label: stateAndEffects.state_label
  };
}

function updatePlotDraft(mutator: (draft: PlotDraft) => PlotDraft): void {
  if (!session) {
    return;
  }

  const current = getPlayerPlotSummary(session, identity);

  if (!current) {
    return;
  }

  plotDraft = mutator(current.draft);
  plotDraft = summarizePlotDraft(session.battle_state, plotDraft).draft;
  render();
}

function localToSchematic(point: Vector2): Vector2 {
  return {
    x: SCHEMATIC_VIEWPORT.centerX + point.x * SCHEMATIC_VIEWPORT.scalePx,
    y: SCHEMATIC_VIEWPORT.centerY + point.y * SCHEMATIC_VIEWPORT.scalePx
  };
}

function getSystemShortLabel(system: ShipSystemConfig): string {
  const explicit = system.render?.short_label;

  if (explicit) {
    return explicit;
  }

  const label = system.render?.label ?? system.id.replaceAll("_", " ");
  const firstWord = label.split(" ")[0];

  return firstWord ? firstWord.toUpperCase() : system.id.toUpperCase();
}

function renderHeadingCompass(headingDegrees: number): string {
  const normalized = normalizeDegrees(headingDegrees);

  return `
    <div class="heading-compass">
      <svg viewBox="0 0 84 84" aria-label="Heading compass">
        <circle class="heading-compass__ring" cx="42" cy="42" r="31" />
        <line class="heading-compass__north" x1="42" y1="7" x2="42" y2="19" />
        <line class="heading-compass__north" x1="42" y1="65" x2="42" y2="77" />
        <line class="heading-compass__north" x1="7" y1="42" x2="19" y2="42" />
        <line class="heading-compass__north" x1="65" y1="42" x2="77" y2="42" />
        <g transform="rotate(${normalized.toFixed(2)} 42 42)">
          <path class="heading-compass__needle" d="M42 14 L49 38 L42 33 L35 38 Z" />
        </g>
      </svg>
      <div class="heading-compass__value">heading ${normalized.toFixed(0).padStart(3, "0")}°</div>
    </div>
  `;
}

function renderSchematicHull(shipConfig: ShipConfig): string {
  const points = shipConfig.hull.silhouette
    .map((point) => {
      const projected = localToSchematic(point);

      return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
    })
    .join(" ");
  const nose = localToSchematic({ x: 0, y: -0.5 });
  const tail = localToSchematic({ x: 0, y: 0.6 });

  return `
    <polygon class="ssd-hull__shape" points="${points}" />
    <line class="ssd-hull__spine" x1="${nose.x.toFixed(2)}" y1="${nose.y.toFixed(2)}" x2="${tail.x.toFixed(
      2
    )}" y2="${tail.y.toFixed(2)}" />
  `;
}

function renderSchematicSystem(
  state: MatchSessionView["battle_state"],
  ship: ShipRuntimeState,
  system: ShipSystemConfig,
  selectedSystemValue: SystemId | null
): string {
  const stateAndEffects = getSystemStateAndEffects(state, ship, system.id);
  const runtimeSystem = ship.systems[system.id];

  if (!runtimeSystem) {
    return "";
  }

  const position = localToSchematic(system.ssd_position ?? system.physical_position);
  const x = position.x - SCHEMATIC_VIEWPORT.systemWidth / 2;
  const y = position.y - SCHEMATIC_VIEWPORT.systemHeight / 2;
  const integrityPercent = (runtimeSystem.current_integrity / system.max_integrity) * 100;

  const classes = [
    "ssd-system",
    `ssd-system--${system.type}`,
    `ssd-system--${stateAndEffects.state_label}`,
    selectedSystemValue === system.id ? "ssd-system--selected" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <g class="${classes}">
      <rect
        class="ssd-system__hit"
        x="${x.toFixed(2)}"
        y="${y.toFixed(2)}"
        width="${SCHEMATIC_VIEWPORT.systemWidth}"
        height="${SCHEMATIC_VIEWPORT.systemHeight}"
        rx="12"
        data-select-system="${system.id}"
      />
      <rect class="ssd-system__body" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${
        SCHEMATIC_VIEWPORT.systemWidth
      }" height="${SCHEMATIC_VIEWPORT.systemHeight}" rx="12" />
      <text class="ssd-system__label" x="${position.x.toFixed(2)}" y="${(position.y - 4).toFixed(2)}">
        ${getSystemShortLabel(system)}
      </text>
      <text class="ssd-system__meta" x="${position.x.toFixed(2)}" y="${(position.y + 12).toFixed(2)}">
        ${stateAndEffects.state_label.toUpperCase()} · ${formatPercent(integrityPercent)}
      </text>
    </g>
  `;
}

function renderSchematicControlDeck(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null,
  plotSummary: PlotDraftSummary | null,
  selectedSystemContext: ReturnType<typeof getSelectedSystemContext>,
  plotPreview: PlotPreview | null
): string {
  if (!identityValue || identityValue.role !== "player") {
    return "";
  }

  if (!sessionValue || !plotSummary) {
    return `<div class="ssd-control-deck__note">Waiting for a playable ship and battle snapshot before enabling plot authoring.</div>`;
  }

  const { context, draft, power, desired_end_heading_degrees: desiredHeading, world_thrust_fraction: worldThrust } = plotSummary;
  const isPending = sessionValue.pending_plot_ship_ids.includes(context.ship_instance_id);
  let selectedPanel = `<div class="ssd-control-deck__note">Select a system on the SSD. Weapon mounts enter aim mode and use tactical contact clicks for fire intent.</div>`;

  if (selectedSystemContext) {
    if (selectedSystemContext.system.type === "weapon_mount") {
      const mountContext = context.weapon_mounts.find((mount) => mount.mount_id === selectedSystemContext.system.id);
      const weaponDraft = draft.weapons.find((weapon) => weapon.mount_id === selectedSystemContext.system.id);
      const cue = plotPreview?.weapon_cues.find((candidate) => candidate.mount_id === selectedSystemContext.system.id) ?? null;
      const selectedChargePips = weaponDraft?.charge_pips ?? 0;
      const chargeOptions = [
        `<option value="0"${selectedChargePips === 0 ? " selected" : ""}>Hold fire</option>`,
        ...(mountContext?.allowed_charge_pips ?? []).map(
          (pips) => `<option value="${pips}"${selectedChargePips === pips ? " selected" : ""}>${pips} pip</option>`
        )
      ].join("");
      const shotQuality =
        cue?.predicted_hit_probability !== null && cue?.predicted_hit_probability !== undefined
          ? `${Math.round(cue.predicted_hit_probability * 100)}% at T${cue.best_fire_sub_tick}`
          : selectedChargePips > 0
            ? "No legal shot"
            : "Unarmed";
      const shotState =
        !cue || cue.target_in_arc === null || cue.target_in_range === null
          ? "Assign charge to evaluate"
          : `${cue.target_in_arc ? "in arc" : "out of arc"} · ${cue.target_in_range ? "in range" : "out of range"}`;

      selectedPanel = `
        <section class="ssd-selected-panel ssd-selected-panel--aim">
          <div class="ssd-selected-panel__header">
            <div>
              <span class="section-kicker">Aim Mode</span>
              <strong>${mountContext?.label ?? selectedSystemContext.system.id}</strong>
            </div>
            <button class="action-button action-button--secondary action-button--compact" data-clear-system-selection>Close</button>
          </div>
          <div class="ssd-selected-panel__grid">
            <label class="ssd-inline-field">
              <span>Charge</span>
              <select data-aim-charge="${selectedSystemContext.system.id}" ${!mountContext?.firing_enabled ? "disabled" : ""}>
                ${chargeOptions}
              </select>
            </label>
            <div class="ssd-selected-readout">
              <span>Target</span>
              <strong>${weaponDraft?.target_ship_instance_id ?? "none"}</strong>
            </div>
            <div class="ssd-selected-readout">
              <span>Solution</span>
              <strong>${shotQuality}</strong>
            </div>
            <div class="ssd-selected-readout">
              <span>Arc / Range</span>
              <strong>${shotState}</strong>
            </div>
          </div>
          <p class="ssd-control-deck__note">Click an enemy contact in the tactical plot to authorize or withdraw fire for this mount.</p>
        </section>
      `;
    } else {
      selectedPanel = `
        <section class="ssd-selected-panel">
          <div class="ssd-selected-panel__header">
            <div>
              <span class="section-kicker">System Detail</span>
              <strong>${selectedSystemContext.system.render?.label ?? selectedSystemContext.system.id}</strong>
            </div>
            <button class="action-button action-button--secondary action-button--compact" data-clear-system-selection>Close</button>
          </div>
          <div class="ssd-selected-panel__grid">
            <div class="ssd-selected-readout">
              <span>State</span>
              <strong>${selectedSystemContext.state_label.toUpperCase()}</strong>
            </div>
            <div class="ssd-selected-readout">
              <span>Integrity</span>
              <strong>${formatPercent(selectedSystemContext.integrity_percent)}</strong>
            </div>
          </div>
          <p class="ssd-control-deck__note">Non-weapon systems are read-only in v0.1. Weapon mounts enter aim mode.</p>
        </section>
      `;
    }
  }

  return `
    <div class="ssd-control-deck">
      <div class="ssd-control-deck__header">
        <div>
          <span class="section-kicker">Plot Controls</span>
          <strong>Turn ${context.turn_number}</strong>
        </div>
        <span class="ssd-control-deck__status ${isPending ? "ssd-control-deck__status--pending" : ""}">
          ${isPending ? "plot on file" : "drafting"}
        </span>
      </div>
      <div class="ssd-control-grid">
        <label class="ssd-slider-card">
          <span>Turn</span>
          <strong>${formatSignedNumber(draft.heading_delta_degrees)}°</strong>
          <small>End ${desiredHeading.toFixed(0).padStart(3, "0")}°</small>
          <input
            type="range"
            min="${-Math.round(context.effective_turn_cap_degrees)}"
            max="${Math.round(context.effective_turn_cap_degrees)}"
            step="1"
            value="${draft.heading_delta_degrees}"
            data-plot-heading
          />
        </label>
        <label class="ssd-slider-card">
          <span>Axial Burn</span>
          <strong>${formatSignedNumber(draft.thrust_input.axial_fraction * 100)}%</strong>
          <small>Stern to bow</small>
          <input
            type="range"
            min="-100"
            max="100"
            step="5"
            value="${Math.round(draft.thrust_input.axial_fraction * 100)}"
            data-plot-axial
          />
        </label>
        <label class="ssd-slider-card">
          <span>Beam Trim</span>
          <strong>${formatSignedNumber(draft.thrust_input.lateral_fraction * 100)}%</strong>
          <small>Port to starboard</small>
          <input
            type="range"
            min="-100"
            max="100"
            step="5"
            value="${Math.round(draft.thrust_input.lateral_fraction * 100)}"
            data-plot-lateral
          />
        </label>
      </div>
      <div class="ssd-control-summary">
        <div class="ssd-summary-chip"><span>Drive</span><strong>${power.drive_pips}</strong></div>
        <div class="ssd-summary-chip"><span>Railgun</span><strong>${power.railgun_pips}</strong></div>
        <div class="ssd-summary-chip"><span>Burn</span><strong>${formatSignedNumber(
          worldThrust.x,
          2
        )}, ${formatSignedNumber(worldThrust.y, 2)}</strong></div>
      </div>
      ${selectedPanel}
    </div>
  `;
}

function renderSchematicViewport(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null,
  plotSummary: PlotDraftSummary | null,
  selectedSystemContext: ReturnType<typeof getSelectedSystemContext>,
  plotPreview: PlotPreview | null
): string {
  const displayed = getDisplayedShipContext(sessionValue, identityValue);

  if (!displayed || !sessionValue) {
    return "<p>Waiting for ship telemetry before drawing the schematic.</p>";
  }

  const { participant, ship, shipConfig } = displayed;
  const hullPercent = (ship.hull.current_integrity / shipConfig.hull.max_integrity) * 100;
  const reactorPips = getAvailableReactorPips(sessionValue.battle_state, ship);
  const mount = shipConfig.systems.find((system) => system.type === "weapon_mount");
  const mountState = mount ? getSystemStateAndEffects(sessionValue.battle_state, ship, mount.id).state_label : "offline";
  const systems = [...shipConfig.systems]
    .sort((left, right) => left.physical_position.y - right.physical_position.y)
    .map((system) => renderSchematicSystem(sessionValue.battle_state, ship, system, selectedSystemId))
    .join("");

  return `
    <section class="schematic-shell">
      <div class="schematic-shell__header">
        <div>
          <span class="section-kicker">${participant.slot_id.toUpperCase()}</span>
          <h2>${shipConfig.name}</h2>
          <p>${ship.ship_instance_id} · fixed-orientation SSD shell</p>
        </div>
        ${renderHeadingCompass(ship.pose.heading_degrees)}
      </div>
      <div class="ssd-viewport">
        <div class="ssd-status-grid">
          <article class="status-tile">
            <span>Hull</span>
            <strong>${formatPercent(hullPercent)}</strong>
          </article>
          <article class="status-tile">
            <span>Reactor</span>
            <strong>${reactorPips} pips</strong>
          </article>
          <article class="status-tile">
            <span>Mount</span>
            <strong>${mountState.toUpperCase()}</strong>
          </article>
        </div>
        <svg viewBox="0 0 ${SCHEMATIC_VIEWPORT.width} ${SCHEMATIC_VIEWPORT.height}" aria-label="Ship schematic">
          <rect class="ssd-viewport__frame" x="10" y="10" width="${SCHEMATIC_VIEWPORT.width - 20}" height="${
            SCHEMATIC_VIEWPORT.height - 20
          }" rx="24" />
          ${renderSchematicHull(shipConfig)}
          ${systems}
        </svg>
        ${renderSchematicControlDeck(sessionValue, identityValue, plotSummary, selectedSystemContext, plotPreview)}
      </div>
    </section>
  `;
}

function renderReadoutStrip(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null
): string {
  const displayed = getDisplayedShipContext(sessionValue, identityValue);

  if (!displayed || !sessionValue) {
    return `
      <div class="readout-strip">
        <div class="readout-chip"><span>Heading</span><strong>...</strong></div>
        <div class="readout-chip"><span>Velocity</span><strong>...</strong></div>
        <div class="readout-chip"><span>Status</span><strong>...</strong></div>
      </div>
    `;
  }

  const { ship, shipConfig } = displayed;
  const availablePips = getAvailableReactorPips(sessionValue.battle_state, ship);
  const speed = Math.hypot(ship.pose.velocity.x, ship.pose.velocity.y);

  return `
    <div class="readout-strip">
      <div class="readout-chip">
        <span>Heading</span>
        <strong>${formatNumber(ship.pose.heading_degrees)}°</strong>
      </div>
      <div class="readout-chip">
        <span>Velocity</span>
        <strong>${formatNumber(speed)}</strong>
      </div>
      <div class="readout-chip">
        <span>Hull</span>
        <strong>${ship.hull.current_integrity} / ${shipConfig.hull.max_integrity}</strong>
      </div>
      <div class="readout-chip">
        <span>Reactor</span>
        <strong>${availablePips} pips</strong>
      </div>
      <div class="readout-chip">
        <span>Status</span>
        <strong>${ship.status.toUpperCase()}</strong>
      </div>
    </div>
  `;
}

function renderFooterStrip(sessionValue: MatchSessionView | null): string {
  const latestResolutionEvent = sessionValue?.last_resolution?.events.at(-1);
  const latestResolutionText = sessionValue?.last_resolution
    ? `Resolved T${sessionValue.last_resolution.resolved_from_turn_number} with ${sessionValue.last_resolution.event_count} events${
        latestResolutionEvent ? ` · ${latestResolutionEvent.type}` : ""
      }`
    : "No turn resolved yet";
  const contactText =
    sessionValue?.battle_state.match_setup.participants
      .map((participant) => {
        const ship = sessionValue.battle_state.ships[participant.ship_instance_id];

        if (!ship) {
          return `${participant.slot_id}: unknown`;
        }

        return `${participant.slot_id} ${ship.status} ${formatNumber(ship.pose.heading_degrees)}°`;
      })
      .join(" · ") ?? "No contact data";
  const latestMessage = messages[0] ?? "No websocket traffic yet";

  return `
    <section class="footer-strip">
      <div class="footer-strip__cell">
        <span class="section-kicker">Resolution</span>
        <strong>${latestResolutionText}</strong>
      </div>
      <div class="footer-strip__cell">
        <span class="section-kicker">Contacts</span>
        <strong>${contactText}</strong>
      </div>
      <div class="footer-strip__cell footer-strip__cell--log">
        <span class="section-kicker">Log</span>
        <strong>${latestMessage}</strong>
      </div>
    </section>
  `;
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
  boundary: RectangleBoundary,
  isTargeted: boolean,
  isTargetable: boolean
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
    sessionValue.pending_plot_ship_ids.includes(ship.ship_instance_id) ? "ship-glyph--pending" : "",
    isTargeted ? "ship-glyph--targeted" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const targetAttribute = isTargetable ? `data-target-ship="${ship.ship_instance_id}"` : "";

  return `
    <g class="${classes}">
      <circle
        class="ship-glyph__hit ${isTargetable ? "ship-glyph__hit--targetable" : ""}"
        cx="${center.x.toFixed(2)}"
        cy="${center.y.toFixed(2)}"
        r="30"
        ${targetAttribute}
      />
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

function renderPreviewPath(boundary: RectangleBoundary, plotPreview: PlotPreview): string {
  const points = plotPreview.projected_path
    .map((sample) => {
      const point = worldToViewport(sample.position, boundary);
      return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    })
    .join(" ");

  if (!points) {
    return "";
  }

  return `<polyline class="plot-preview__path" points="${points}" />`;
}

function renderPreviewGhost(sessionValue: MatchSessionView, boundary: RectangleBoundary, plotPreview: PlotPreview): string {
  const ship = sessionValue.battle_state.ships[plotPreview.ship_instance_id];

  if (!ship) {
    return "";
  }

  const shipConfig = getShipConfig(sessionValue.battle_state, ship);
  const center = worldToViewport(plotPreview.projected_pose.position, boundary);
  const hullPoints = getShipHullPoints(shipConfig, center);
  const headingVector = getHeadingVector(plotPreview.projected_pose.heading_degrees, TACTICAL_VIEWPORT.headingVectorLengthPx);
  const labelY = center.y - 22;

  return `
    <g class="plot-preview__ghost">
      <polygon
        class="plot-preview__ghost-hull"
        points="${hullPoints}"
        transform="rotate(${plotPreview.projected_pose.heading_degrees.toFixed(2)} ${center.x.toFixed(2)} ${center.y.toFixed(2)})"
      />
      <line
        class="plot-preview__ghost-heading"
        x1="${center.x.toFixed(2)}"
        y1="${center.y.toFixed(2)}"
        x2="${(center.x + headingVector.x).toFixed(2)}"
        y2="${(center.y + headingVector.y).toFixed(2)}"
      />
      <circle class="plot-preview__ghost-core" cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" r="4" />
      <text class="plot-preview__ghost-label" x="${center.x.toFixed(2)}" y="${labelY.toFixed(2)}">
        planned end · ${plotPreview.projected_pose.heading_degrees.toFixed(0).padStart(3, "0")}°
      </text>
    </g>
  `;
}

function renderWeaponCue(boundary: RectangleBoundary, plotPreview: PlotPreview): string {
  return plotPreview.weapon_cues
    .map((cue) => {
      if (cue.target_position === null) {
        return "";
      }

      const polygonPoints = getArcPolygonPoints(cue, 12)
        .map((point) => {
          const projected = worldToViewport(point, boundary);
          return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
        })
        .join(" ");
      const mountPoint = worldToViewport(cue.mount_position, boundary);
      const targetPoint = worldToViewport(cue.target_position, boundary);
      const cueClass = cue.target_in_arc && cue.target_in_range ? "plot-preview__cue--valid" : "plot-preview__cue--warn";
      const hitText =
        cue.predicted_hit_probability !== null ? `${Math.round(cue.predicted_hit_probability * 100)}%` : "no shot";

      return `
        <g class="plot-preview__cue ${cueClass}">
          <polygon class="plot-preview__arc" points="${polygonPoints}" />
          <line
            class="plot-preview__target-line"
            x1="${mountPoint.x.toFixed(2)}"
            y1="${mountPoint.y.toFixed(2)}"
            x2="${targetPoint.x.toFixed(2)}"
            y2="${targetPoint.y.toFixed(2)}"
          />
          <circle class="plot-preview__target-reticle" cx="${targetPoint.x.toFixed(2)}" cy="${targetPoint.y.toFixed(2)}" r="18" />
          <text class="plot-preview__target-label" x="${targetPoint.x.toFixed(2)}" y="${(targetPoint.y - 24).toFixed(2)}">
            ${cue.label} · ${cue.charge_pips}p · ${hitText}
          </text>
        </g>
      `;
    })
    .join("");
}

function renderPlotPreviewOverlay(
  sessionValue: MatchSessionView,
  boundary: RectangleBoundary,
  plotPreview: PlotPreview | null,
  focusedMountId: SystemId | null
): string {
  if (!plotPreview) {
    return "";
  }

  const focusedPreview =
    focusedMountId === null
      ? plotPreview
      : {
          ...plotPreview,
          weapon_cues: plotPreview.weapon_cues.filter((cue) => cue.mount_id === focusedMountId)
        };

  return `
    <g class="plot-preview">
      ${renderPreviewPath(boundary, focusedPreview)}
      ${renderWeaponCue(boundary, focusedPreview)}
      ${renderPreviewGhost(sessionValue, boundary, focusedPreview)}
    </g>
  `;
}

function renderTacticalViewport(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null,
  plotPreview: PlotPreview | null,
  selectedSystemContext: ReturnType<typeof getSelectedSystemContext>
): string {
  if (!sessionValue) {
    return "<p>Waiting for the session snapshot before rendering the tactical board.</p>";
  }

  const boundary = getRectangleBoundary(sessionValue);

  if (!boundary) {
    return "<p>The current battlefield boundary is not yet supported by the tactical viewport.</p>";
  }

  const focusedMountId = selectedSystemContext?.system.type === "weapon_mount" ? selectedSystemContext.system.id : null;
  const targetedShipIds = new Set(
    plotPreview?.weapon_cues
      .map((cue) => cue.target_ship_instance_id)
      .filter((shipId): shipId is string => shipId !== null) ?? []
  );
  const ships = sessionValue.battle_state.match_setup.participants
    .map((participant) => {
      const ship = sessionValue.battle_state.ships[participant.ship_instance_id];
      const shipConfig = sessionValue.battle_state.match_setup.ship_catalog[participant.ship_config_id];

      if (!ship || !shipConfig) {
        return "";
      }

      return renderShipGlyph(
        sessionValue,
        identityValue,
        ship,
        shipConfig,
        participant.slot_id.toUpperCase(),
        boundary,
        targetedShipIds.has(ship.ship_instance_id),
        focusedMountId !== null && identityValue?.ship_instance_id !== ship.ship_instance_id
      );
    })
    .join("");
  const overlay = renderPlotPreviewOverlay(sessionValue, boundary, plotPreview, focusedMountId);

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
        ${overlay}
        ${ships}
      </svg>
    </div>
  `;
}

function renderActionStripControls(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null,
  plotSummary: PlotDraftSummary | null
): string {
  if (!identityValue || identityValue.role !== "player") {
    return "<p class=\"action-strip__note\">Open a second browser session to claim the other player slot. Additional sessions join as spectators.</p>";
  }

  if (!sessionValue || !plotSummary) {
    return "<p class=\"action-strip__note\">Waiting for a playable ship and battle snapshot before enabling plot authoring.</p>";
  }

  const { context } = plotSummary;
  const isPending = sessionValue.pending_plot_ship_ids.includes(context.ship_instance_id);

  return `
    <section class="commit-strip">
      <div class="commit-strip__status">
        <span class="section-kicker">Plot Status</span>
        <strong>${isPending ? "Plot on file" : "Drafting turn"} ${context.turn_number}</strong>
      </div>
      <div class="commit-strip__actions">
        <button class="action-button action-button--secondary" data-reset-plot>Reset draft</button>
        <button class="action-button action-button--primary" data-submit-plot>Submit plot</button>
      </div>
    </section>
  `;
}

function render(): void {
  const sessionValue = session;
  const displayed = getDisplayedShipContext(sessionValue, identity);
  const plotSummary = getPlayerPlotSummary(sessionValue, identity);
  const selectedSystemContext = getSelectedSystemContext(sessionValue, identity);
  const plotPreview = sessionValue && plotSummary ? buildPlotPreview(sessionValue.battle_state, plotSummary.draft) : null;
  const tacticalViewport = renderTacticalViewport(sessionValue, identity, plotPreview, selectedSystemContext);
  const schematicViewport = renderSchematicViewport(sessionValue, identity, plotSummary, selectedSystemContext, plotPreview);
  const readoutStrip = renderReadoutStrip(sessionValue, identity);
  const actionStripControls = renderActionStripControls(sessionValue, identity, plotSummary);
  const footerStrip = renderFooterStrip(sessionValue);
  const phaseLabel = getPhaseLabel(sessionValue, selectedSystemContext);
  const missionBarClass = `mission-bar${selectedSystemContext?.system.type === "weapon_mount" ? " mission-bar--aim" : ""}`;

  root.innerHTML = `
    <main class="bridge-shell">
      <header class="${missionBarClass}">
        <div class="mission-bar__mode">${phaseLabel}</div>
        <div class="mission-bar__meta">
          <span>Turn ${sessionValue?.battle_state.turn_number ?? "..."}</span>
          <span>${health?.rulesId ?? "..."}</span>
          <span>${formatRole(identity)}</span>
        </div>
        <div class="mission-bar__status">
          <span>Opponent ${getOpponentStatusLabel(sessionValue, identity)}</span>
          <span class="${wsState === "connected" ? "status--ok" : "status--warn"}">WS ${wsState}</span>
        </div>
      </header>
      <div class="bridge-shell__subline">
        <span>Match ${health?.matchId ?? "..."}</span>
        <span>Displayed ship ${displayed?.ship.ship_instance_id ?? "..."}</span>
        <span>Pending ${sessionValue?.pending_plot_ship_ids.join(", ") || "none"}</span>
      </div>
      <section class="bridge-main">
        <article class="bridge-panel bridge-panel--schematic">
          ${schematicViewport}
        </article>
        <article class="bridge-panel bridge-panel--tactical">
          <div class="tactical-panel__header">
            <div>
              <span class="section-kicker">Tactical View</span>
              <h2>Shared sensor plot</h2>
            </div>
            <div class="tactical-panel__meta">
              <span>${selectedSystemContext?.system.type === "weapon_mount" ? "Aim mode overlays the selected mount only." : "Heading is separate from drift."}</span>
              <span>Dashed geometry is your current draft preview.</span>
            </div>
          </div>
          ${tacticalViewport}
        </article>
      </section>
      <section class="action-strip">
        <div class="action-strip__readouts">
          ${readoutStrip}
        </div>
        <div class="action-strip__controls">
          ${actionStripControls}
        </div>
      </section>
      ${footerStrip}
    </main>
  `;

  document.querySelector<HTMLInputElement>("[data-plot-heading]")?.addEventListener("input", (event) => {
    const target = event.currentTarget as HTMLInputElement;

    updatePlotDraft((draft) => ({
      ...draft,
      heading_delta_degrees: Number.parseFloat(target.value)
    }));
  });

  document.querySelector<HTMLInputElement>("[data-plot-axial]")?.addEventListener("input", (event) => {
    const target = event.currentTarget as HTMLInputElement;

    updatePlotDraft((draft) => ({
      ...draft,
      thrust_input: {
        ...draft.thrust_input,
        axial_fraction: Number.parseFloat(target.value) / 100
      }
    }));
  });

  document.querySelector<HTMLInputElement>("[data-plot-lateral]")?.addEventListener("input", (event) => {
    const target = event.currentTarget as HTMLInputElement;

    updatePlotDraft((draft) => ({
      ...draft,
      thrust_input: {
        ...draft.thrust_input,
        lateral_fraction: Number.parseFloat(target.value) / 100
      }
    }));
  });

  document.querySelectorAll<SVGElement>("[data-select-system]").forEach((element) => {
    element.addEventListener("click", () => {
      const systemId = element.getAttribute("data-select-system");

      if (!systemId) {
        return;
      }

      selectedSystemId = selectedSystemId === systemId ? null : systemId;
      render();
    });
  });

  document.querySelector<HTMLButtonElement>("[data-clear-system-selection]")?.addEventListener("click", () => {
    selectedSystemId = null;
    render();
  });

  document.querySelectorAll<HTMLSelectElement>("[data-aim-charge]").forEach((select) => {
    select.addEventListener("change", (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      const mountId = target.dataset.aimCharge;

      if (!mountId) {
        return;
      }

      updatePlotDraft((draft) => ({
        ...draft,
        weapons: draft.weapons.map((weapon) =>
          weapon.mount_id === mountId ? { ...weapon, charge_pips: Number.parseInt(target.value, 10) } : weapon
        )
      }));
    });
  });

  document.querySelectorAll<SVGElement>("[data-target-ship]").forEach((element) => {
    element.addEventListener("click", () => {
      const targetShipId = element.getAttribute("data-target-ship");
      const selectedMountId =
        selectedSystemContext?.system.type === "weapon_mount" ? selectedSystemContext.system.id : null;
      const mountContext = plotSummary?.context.weapon_mounts.find((mount) => mount.mount_id === selectedMountId);

      if (!targetShipId || !selectedMountId || !mountContext || !mountContext.firing_enabled) {
        return;
      }

      updatePlotDraft((draft) => ({
        ...draft,
        weapons: draft.weapons.map((weapon) =>
          weapon.mount_id === selectedMountId
            ? {
                ...weapon,
                target_ship_instance_id: targetShipId,
                charge_pips:
                  weapon.target_ship_instance_id === targetShipId && weapon.charge_pips > 0
                    ? 0
                    : Math.max(weapon.charge_pips, mountContext.allowed_charge_pips[0] ?? 0)
              }
            : weapon
        )
      }));
    });
  });

  document.querySelector<HTMLButtonElement>("[data-reset-plot]")?.addEventListener("click", () => {
    if (!session || !identity || identity.role !== "player" || !identity.ship_instance_id) {
      return;
    }

    plotDraft = createPlotDraft(session.battle_state, identity.ship_instance_id);
    render();
  });

  document.querySelector<HTMLButtonElement>("[data-submit-plot]")?.addEventListener("click", () => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !session) {
      return;
    }

    try {
      const summary = getPlayerPlotSummary(session, identity);

      if (!summary) {
        throw new Error("No playable ship is assigned to this client");
      }

      const plot = buildPlotSubmissionFromDraft(session.battle_state, summary.draft);

      socket.send(
        JSON.stringify({
          type: "submit_plot",
          plot
        })
      );
      logMessage(`submitted direct plot for ${plot.ship_instance_id} on turn ${plot.turn_number}`);
      render();
    } catch (error) {
      logMessage(error instanceof Error ? error.message : "failed to build plot");
      render();
    }
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
