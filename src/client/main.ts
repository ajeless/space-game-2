import "./style.css";
import {
  buildPlotPreview,
  buildTacticalCamera,
  buildPlotSubmissionFromDraft,
  clampWorldPointToTacticalViewportEdge,
  createPlotDraft,
  createDefaultTacticalCameraSelection,
  getArcPolygonPoints,
  getAvailableReactorPips,
  getTacticalCameraModeDefinition,
  getTacticalCameraScaleBarWorldUnits,
  getTacticalZoomPresetDefinition,
  getShipConfig,
  getSystemStateAndEffects,
  isWorldPointVisibleInTacticalCamera,
  setPlotDraftDesiredEndHeading,
  setPlotDraftWorldThrust,
  summarizePlotDraft,
  TACTICAL_CAMERA_MODES,
  TACTICAL_ZOOM_PRESETS,
  worldToTacticalViewport
} from "../shared/index.js";
import type { MatchSessionView, ResolverEvent, ServerToClientMessage, SessionIdentity } from "../shared/index.js";
import type {
  BattleBoundary,
  PlotDraft,
  PlotDraftSummary,
  PlotPreview,
  ShipConfig,
  ShipInstanceId,
  ShipSystemConfig,
  ShipRuntimeState,
  SystemId,
  TacticalCamera,
  TacticalCameraModeId,
  TacticalCameraSelection,
  TacticalZoomPresetId,
  Vector2
} from "../shared/index.js";

type HealthResponse = {
  ok: boolean;
  matchId: string;
  rulesId: string;
  participantCount: number;
  shipCatalogCount: number;
  resetEnabled: boolean;
  reconnectGraceMs: number;
};

function getRootElement(): HTMLDivElement {
  const candidate = document.querySelector<HTMLDivElement>("#app");

  if (!candidate) {
    throw new Error("Missing #app root");
  }

  return candidate;
}

const root = getRootElement();
const RECONNECT_TOKEN_STORAGE_KEY = "sg2_reconnect_token";
const ADMIN_TOKEN_STORAGE_KEY = "sg2_admin_token";

let health: HealthResponse | null = null;
let wsState: "connecting" | "connected" | "closed" | "error" = "connecting";
let identity: SessionIdentity | null = null;
let session: MatchSessionView | null = null;
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let plotDraft: PlotDraft | null = null;
let selectedSystemId: SystemId | null = null;
let tacticalCameraSelection: TacticalCameraSelection = createDefaultTacticalCameraSelection();
const messages: string[] = [];
type TacticalDragHandleId = "thrust" | "heading";
type ActiveTacticalDrag = {
  handle_id: TacticalDragHandleId;
  pointer_id: number;
};
let activeTacticalDrag: ActiveTacticalDrag | null = null;
type ResolutionPlaybackState = {
  key: string;
  focus_events: ResolverEvent[];
  current_index: number;
};
let resolutionPlayback: ResolutionPlaybackState | null = null;
let resolutionPlaybackTimer: number | null = null;

function readStoredValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage failures in v0.1
  }
}

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
  height: 860,
  padding: 28,
  hullScalePx: 44,
  headingVectorLengthPx: 28,
  velocityProjectionDistance: 120000,
  markerInsetPx: 22,
  scaleBarTargetPx: 112
} as const;

const TACTICAL_PLOT_HANDLES = {
  thrustRadiusPx: 72,
  headingRadiusPx: 44,
  deadzonePx: 8
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

function formatDistance(value: number): string {
  return `${Math.round(value)} km`;
}

function formatRole(identityValue: SessionIdentity | null): string {
  if (!identityValue) {
    return "...";
  }

  return `${identityValue.role}${identityValue.slot_id ? ` · ${identityValue.slot_id}` : ""}`;
}

function isResolutionFocusEvent(event: ResolverEvent): boolean {
  return (
    event.type === "weapon_fired" ||
    event.type === "hit_registered" ||
    event.type === "subsystem_damaged" ||
    event.type === "ship_destroyed" ||
    event.type === "ship_disengaged" ||
    event.type === "turn_ended"
  );
}

function getResolutionKey(sessionValue: MatchSessionView | null): string | null {
  if (!sessionValue?.last_resolution) {
    return null;
  }

  return `${sessionValue.last_resolution.resolved_from_turn_number}:${sessionValue.last_resolution.event_count}`;
}

function clearResolutionPlaybackTimer(): void {
  if (resolutionPlaybackTimer !== null) {
    window.clearTimeout(resolutionPlaybackTimer);
    resolutionPlaybackTimer = null;
  }
}

function clearResolutionPlayback(): void {
  clearResolutionPlaybackTimer();
  resolutionPlayback = null;
}

function queueResolutionPlaybackAdvance(): void {
  clearResolutionPlaybackTimer();

  if (!resolutionPlayback) {
    return;
  }

  if (resolutionPlayback.current_index >= resolutionPlayback.focus_events.length - 1) {
    resolutionPlaybackTimer = window.setTimeout(() => {
      resolutionPlayback = null;
      resolutionPlaybackTimer = null;
      render();
    }, 1400);
    return;
  }

  resolutionPlaybackTimer = window.setTimeout(() => {
    if (!resolutionPlayback) {
      return;
    }

    resolutionPlayback.current_index += 1;
    queueResolutionPlaybackAdvance();
    render();
  }, 700);
}

function syncResolutionPlayback(sessionValue: MatchSessionView | null): void {
  const key = getResolutionKey(sessionValue);

  if (!key || !sessionValue?.last_resolution) {
    clearResolutionPlayback();
    return;
  }

  if (resolutionPlayback?.key === key) {
    return;
  }

  const focusEvents = sessionValue.last_resolution.events.filter(isResolutionFocusEvent);

  if (focusEvents.length === 0) {
    clearResolutionPlayback();
    return;
  }

  resolutionPlayback = {
    key,
    focus_events: focusEvents,
    current_index: 0
  };
  queueResolutionPlaybackAdvance();
}

function getCurrentResolutionPlaybackEvent(sessionValue: MatchSessionView | null): ResolverEvent | null {
  if (!resolutionPlayback || resolutionPlayback.key !== getResolutionKey(sessionValue)) {
    return null;
  }

  return resolutionPlayback.focus_events[resolutionPlayback.current_index] ?? null;
}

function getRecentResolutionEvents(sessionValue: MatchSessionView | null): ResolverEvent[] {
  return sessionValue?.last_resolution?.events.filter(isResolutionFocusEvent).slice(-4).reverse() ?? [];
}

function getSystemPlaybackTone(
  playbackEvent: ResolverEvent | null,
  shipInstanceId: ShipInstanceId,
  systemId: SystemId
): "hit" | "critical" | null {
  if (!playbackEvent) {
    return null;
  }

  if (
    playbackEvent.type === "hit_registered" &&
    playbackEvent.target === shipInstanceId &&
    playbackEvent.details.impactSystemId === systemId
  ) {
    return "hit";
  }

  if (
    playbackEvent.type === "subsystem_damaged" &&
    playbackEvent.actor === shipInstanceId &&
    playbackEvent.details.systemId === systemId
  ) {
    return playbackEvent.details.newState === "offline" ? "critical" : "hit";
  }

  return null;
}

function getShipPlaybackTone(
  playbackEvent: ResolverEvent | null,
  shipInstanceId: ShipInstanceId
): "hit" | "destroyed" | "disengaged" | null {
  if (!playbackEvent) {
    return null;
  }

  if (playbackEvent.type === "ship_destroyed" && playbackEvent.target === shipInstanceId) {
    return "destroyed";
  }

  if (playbackEvent.type === "ship_disengaged" && playbackEvent.target === shipInstanceId) {
    return "disengaged";
  }

  if (playbackEvent.type === "hit_registered" && playbackEvent.target === shipInstanceId) {
    return "hit";
  }

  return null;
}

function getShipSlotLabel(sessionValue: MatchSessionView, shipInstanceId: ShipInstanceId | null): string {
  if (!shipInstanceId) {
    return "NONE";
  }

  const participant = sessionValue.battle_state.match_setup.participants.find(
    (candidate) => candidate.ship_instance_id === shipInstanceId
  );

  return participant ? participant.slot_id.toUpperCase() : shipInstanceId;
}

function formatShipContactLabel(sessionValue: MatchSessionView, shipInstanceId: ShipInstanceId | null): string {
  if (!shipInstanceId) {
    return "none";
  }

  return `${getShipSlotLabel(sessionValue, shipInstanceId)} · ${shipInstanceId}`;
}

function formatResolutionEventSummary(sessionValue: MatchSessionView, event: ResolverEvent): string {
  switch (event.type) {
    case "weapon_fired":
      return `${getShipSlotLabel(sessionValue, event.actor ?? null)} fired ${event.details.mountId} at ${getShipSlotLabel(
        sessionValue,
        event.target ?? null
      )} · ${event.details.chargePips}P`;
    case "hit_registered":
      return `${getShipSlotLabel(sessionValue, event.details.fromActor)} hit ${getShipSlotLabel(
        sessionValue,
        event.target ?? null
      )}${event.details.impactSystemId ? ` · ${event.details.impactSystemId}` : ""}`;
    case "subsystem_damaged":
      return `${getShipSlotLabel(sessionValue, event.actor ?? null)} ${event.details.systemId} ${event.details.newState.toUpperCase()}`;
    case "ship_destroyed":
      return `${getShipSlotLabel(sessionValue, event.target ?? null)} destroyed by ${getShipSlotLabel(
        sessionValue,
        event.details.causeActor
      )}`;
    case "ship_disengaged":
      return `${getShipSlotLabel(sessionValue, event.target ?? null)} disengaged beyond boundary`;
    case "turn_ended":
      return `Turn ${event.details.turnNumber - 1} resolved${event.details.winner ? ` · winner ${getShipSlotLabel(sessionValue, event.details.winner)}` : ""}`;
    default:
      return event.type;
  }
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

function getSlotConnectionState(
  sessionValue: MatchSessionView | null,
  slotId: string | null
): MatchSessionView["slot_states"][number]["connection_state"] | null {
  if (!sessionValue || !slotId) {
    return null;
  }

  return sessionValue.slot_states.find((slotState) => slotState.slot_id === slotId)?.connection_state ?? null;
}

function formatSlotConnectionLabel(
  sessionValue: MatchSessionView | null,
  slotId: string | null
): string {
  const connectionState = getSlotConnectionState(sessionValue, slotId);

  if (!slotId || !connectionState) {
    return "unknown";
  }

  if (connectionState === "connected") {
    return `${slotId} connected`;
  }

  if (connectionState === "reconnecting") {
    return `${slotId} reconnecting`;
  }

  return `${slotId} open`;
}

function getClaimableSlotStates(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null
): MatchSessionView["slot_states"] {
  if (!sessionValue) {
    return [];
  }

  return sessionValue.slot_states.filter((slotState) => {
    if (slotState.connection_state === "connected") {
      return false;
    }

    if (identityValue?.role === "player" && identityValue.slot_id === slotState.slot_id) {
      return false;
    }

    return true;
  });
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

  const opponentConnectionState = getSlotConnectionState(sessionValue, opponent.slot_id);

  if (opponentConnectionState === "reconnecting") {
    return `${opponent.slot_id} reconnecting`;
  }

  if (opponentConnectionState === "open") {
    return `${opponent.slot_id} open`;
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

function getPlayerTacticalAuthoringContext():
  | {
      sessionValue: MatchSessionView;
      displayed: NonNullable<ReturnType<typeof getDisplayedShipContext>>;
      plotSummary: PlotDraftSummary;
      plotPreview: PlotPreview;
      camera: TacticalCamera;
    }
  | null {
  if (!session || !identity) {
    return null;
  }

  const displayed = getDisplayedShipContext(session, identity);
  const plotSummary = getPlayerPlotSummary(session, identity);

  if (!displayed || !plotSummary) {
    return null;
  }

  const plotPreview = buildPlotPreview(session.battle_state, plotSummary.draft);
  const camera = getTacticalCamera(session, plotPreview, displayed.ship.ship_instance_id);

  if (!camera) {
    return null;
  }

  return {
    sessionValue: session,
    displayed,
    plotSummary,
    plotPreview,
    camera
  };
}

function getSvgViewportPoint(svg: SVGSVGElement, clientX: number, clientY: number): Vector2 {
  const bounds = svg.getBoundingClientRect();

  return {
    x: ((clientX - bounds.left) / bounds.width) * TACTICAL_VIEWPORT.width,
    y: ((clientY - bounds.top) / bounds.height) * TACTICAL_VIEWPORT.height
  };
}

function getTacticalPointerPoint(clientX: number, clientY: number): Vector2 | null {
  const svg = root.querySelector<SVGSVGElement>("[data-tactical-viewport]");

  if (!svg) {
    return null;
  }

  return getSvgViewportPoint(svg, clientX, clientY);
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

type WeaponCue = PlotPreview["weapon_cues"][number];

type WeaponIntentPresentation = {
  tone: "idle" | "armed" | "warn" | "disabled";
  banner_label: string;
  target_label: string;
  status_label: string;
  system_meta_label: string;
  shot_quality_label: string;
  shot_state_label: string;
  is_armed: boolean;
};

function isArmedWeaponCue(cue: WeaponCue | null | undefined): boolean {
  return Boolean(cue && cue.firing_enabled && cue.charge_pips > 0 && cue.target_ship_instance_id !== null);
}

function getWeaponIntentPresentation(
  sessionValue: MatchSessionView,
  weaponDraft: PlotDraft["weapons"][number] | undefined,
  cue: WeaponCue | null,
  firingEnabled: boolean
): WeaponIntentPresentation {
  const chargePips = weaponDraft?.charge_pips ?? 0;
  const targetShipInstanceId = weaponDraft?.target_ship_instance_id ?? null;
  const targetShortLabel = getShipSlotLabel(sessionValue, targetShipInstanceId);
  const targetLabel = formatShipContactLabel(sessionValue, targetShipInstanceId);
  const isArmed = firingEnabled && chargePips > 0 && targetShipInstanceId !== null;
  const shotQualityLabel =
    cue?.predicted_hit_probability !== null && cue?.predicted_hit_probability !== undefined
      ? `${Math.round(cue.predicted_hit_probability * 100)}% at T${cue.best_fire_sub_tick}`
      : isArmed
        ? "No legal shot"
        : "Unarmed";
  const shotStateLabel =
    !cue || cue.target_in_arc === null || cue.target_in_range === null
      ? targetShipInstanceId
        ? "Selected contact only"
        : "Await contact selection"
      : `${cue.target_in_arc ? "in arc" : "out of arc"} · ${cue.target_in_range ? "in range" : "out of range"}`;

  if (!firingEnabled) {
    return {
      tone: "disabled",
      banner_label: "MOUNT DISABLED",
      target_label: "none",
      status_label: "Disabled",
      system_meta_label: "DISABLED",
      shot_quality_label: "Mount offline",
      shot_state_label: "No fire control",
      is_armed: false
    };
  }

  if (!targetShipInstanceId) {
    return {
      tone: "idle",
      banner_label: "NO CONTACT SELECTED",
      target_label: "none",
      status_label: "Await contact",
      system_meta_label: "SAFE",
      shot_quality_label: shotQualityLabel,
      shot_state_label: shotStateLabel,
      is_armed: false
    };
  }

  if (!isArmed) {
    return {
      tone: "idle",
      banner_label: `HOLD FIRE · ${targetShortLabel}`,
      target_label: targetLabel,
      status_label: "Standby",
      system_meta_label: "STBY",
      shot_quality_label: shotQualityLabel,
      shot_state_label: shotStateLabel,
      is_armed: false
    };
  }

  if (cue?.predicted_hit_probability !== null && cue?.predicted_hit_probability !== undefined) {
    return {
      tone: "armed",
      banner_label: `ARMED ON ${targetShortLabel} · ${chargePips}P`,
      target_label: targetLabel,
      status_label: `${chargePips} pip shot armed`,
      system_meta_label: `ARM ${chargePips}P`,
      shot_quality_label: shotQualityLabel,
      shot_state_label: shotStateLabel,
      is_armed: true
    };
  }

  return {
    tone: "warn",
    banner_label: `NO LEGAL SHOT · ${targetShortLabel}`,
    target_label: targetLabel,
    status_label: `${chargePips} pip shot blocked`,
    system_meta_label: "NO SHOT",
    shot_quality_label: shotQualityLabel,
    shot_state_label: shotStateLabel,
    is_armed: false
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

function applyTacticalDrag(clientX: number, clientY: number): void {
  if (!activeTacticalDrag) {
    return;
  }

  const context = getPlayerTacticalAuthoringContext();
  const pointer = getTacticalPointerPoint(clientX, clientY);

  if (!context || !pointer) {
    return;
  }

  if (activeTacticalDrag.handle_id === "thrust") {
    const shipAnchor = worldToTacticalViewport(context.camera, context.displayed.ship.pose.position);
    const delta = {
      x: pointer.x - shipAnchor.x,
      y: pointer.y - shipAnchor.y
    };
    const distance = Math.hypot(delta.x, delta.y);
    const scale = distance <= TACTICAL_PLOT_HANDLES.deadzonePx ? 0 : Math.min(1, distance / TACTICAL_PLOT_HANDLES.thrustRadiusPx);
    const direction = distance > 0 ? { x: delta.x / distance, y: delta.y / distance } : { x: 0, y: 0 };

    updatePlotDraft((draft) =>
      setPlotDraftWorldThrust(context.sessionValue.battle_state, draft, {
        x: direction.x * scale,
        y: -direction.y * scale
      })
    );

    return;
  }

  const ghostAnchor = worldToTacticalViewport(context.camera, context.plotPreview.projected_pose.position);
  const delta = {
    x: pointer.x - ghostAnchor.x,
    y: pointer.y - ghostAnchor.y
  };
  const distance = Math.hypot(delta.x, delta.y);

  if (distance <= TACTICAL_PLOT_HANDLES.deadzonePx) {
    return;
  }

  const desiredHeadingDegrees = normalizeDegrees((Math.atan2(delta.x, -delta.y) * 180) / Math.PI);

  updatePlotDraft((draft) => setPlotDraftDesiredEndHeading(context.sessionValue.battle_state, draft, desiredHeadingDegrees));
}

function clearActiveTacticalDrag(pointerId?: number): void {
  if (!activeTacticalDrag || (pointerId !== undefined && activeTacticalDrag.pointer_id !== pointerId)) {
    return;
  }

  activeTacticalDrag = null;
  document.body.classList.remove("is-plot-dragging");
}

function handleGlobalTacticalPointerMove(event: PointerEvent): void {
  if (!activeTacticalDrag || activeTacticalDrag.pointer_id !== event.pointerId) {
    return;
  }

  event.preventDefault();
  applyTacticalDrag(event.clientX, event.clientY);
}

function handleGlobalTacticalPointerEnd(event: PointerEvent): void {
  clearActiveTacticalDrag(event.pointerId);
}

window.addEventListener("pointermove", handleGlobalTacticalPointerMove);
window.addEventListener("pointerup", handleGlobalTacticalPointerEnd);
window.addEventListener("pointercancel", handleGlobalTacticalPointerEnd);

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
        <line class="heading-compass__reference" x1="42" y1="7" x2="42" y2="19" />
        <line class="heading-compass__reference" x1="42" y1="65" x2="42" y2="77" />
        <line class="heading-compass__reference" x1="7" y1="42" x2="19" y2="42" />
        <line class="heading-compass__reference" x1="65" y1="42" x2="77" y2="42" />
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
  selectedSystemValue: SystemId | null,
  weaponIntent: Pick<WeaponIntentPresentation, "is_armed" | "system_meta_label"> | null,
  playbackTone: "hit" | "critical" | null
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
    weaponIntent?.is_armed ? "ssd-system--armed" : "",
    playbackTone === "hit" ? "ssd-system--recent-hit" : "",
    playbackTone === "critical" ? "ssd-system--critical-hit" : "",
    selectedSystemValue === system.id ? "ssd-system--selected" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const metaLabel = weaponIntent?.system_meta_label
    ? `${weaponIntent.system_meta_label} · ${formatPercent(integrityPercent)}`
    : `${stateAndEffects.state_label.toUpperCase()} · ${formatPercent(integrityPercent)}`;

  return `
    <g class="${classes}" data-select-system="${system.id}">
      <rect
        class="ssd-system__hit"
        x="${x.toFixed(2)}"
        y="${y.toFixed(2)}"
        width="${SCHEMATIC_VIEWPORT.systemWidth}"
        height="${SCHEMATIC_VIEWPORT.systemHeight}"
        rx="12"
      />
      <rect class="ssd-system__body" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${
        SCHEMATIC_VIEWPORT.systemWidth
      }" height="${SCHEMATIC_VIEWPORT.systemHeight}" rx="12" />
      <text class="ssd-system__label" x="${position.x.toFixed(2)}" y="${(position.y - 4).toFixed(2)}">
        ${getSystemShortLabel(system)}
      </text>
      <text class="ssd-system__meta" x="${position.x.toFixed(2)}" y="${(position.y + 12).toFixed(2)}">
        ${metaLabel}
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
      const intent = getWeaponIntentPresentation(
        sessionValue,
        weaponDraft,
        cue,
        mountContext?.firing_enabled ?? false
      );
      const chargeOptions = [
        `<option value="0"${selectedChargePips === 0 ? " selected" : ""}>Hold fire</option>`,
        ...(mountContext?.allowed_charge_pips ?? []).map(
          (pips) => `<option value="${pips}"${selectedChargePips === pips ? " selected" : ""}>${pips} pip</option>`
        )
      ].join("");

      selectedPanel = `
        <section class="ssd-selected-panel ssd-selected-panel--aim">
          <div class="ssd-selected-panel__header">
            <div>
              <span class="section-kicker">Aim Mode</span>
              <strong>${mountContext?.label ?? selectedSystemContext.system.id}</strong>
            </div>
            <button class="action-button action-button--secondary action-button--compact" data-clear-system-selection>Close</button>
          </div>
          <div class="ssd-selection-banner ssd-selection-banner--${intent.tone}">
            ${intent.banner_label}
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
              <strong>${intent.target_label}</strong>
            </div>
            <div class="ssd-selected-readout">
              <span>Fire Control</span>
              <strong>${intent.status_label}</strong>
            </div>
            <div class="ssd-selected-readout">
              <span>Solution</span>
              <strong>${intent.shot_quality_label}</strong>
            </div>
            <div class="ssd-selected-readout">
              <span>Arc / Range</span>
              <strong>${intent.shot_state_label}</strong>
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
          <span>Lateral Burn</span>
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
  plotPreview: PlotPreview | null,
  playbackEvent: ResolverEvent | null
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
  const weaponIntentByMountId = new Map<SystemId, Pick<WeaponIntentPresentation, "is_armed" | "system_meta_label">>();

  if (plotSummary) {
    for (const weapon of plotSummary.draft.weapons) {
      const cue = plotPreview?.weapon_cues.find((candidate) => candidate.mount_id === weapon.mount_id) ?? null;
      const mountContext = plotSummary.context.weapon_mounts.find((candidate) => candidate.mount_id === weapon.mount_id);
      const intent = getWeaponIntentPresentation(
        sessionValue,
        weapon,
        cue,
        mountContext?.firing_enabled ?? false
      );

      weaponIntentByMountId.set(weapon.mount_id, {
        is_armed: intent.is_armed,
        system_meta_label: intent.system_meta_label
      });
    }
  }

  const systems = [...shipConfig.systems]
    .sort((left, right) => left.physical_position.y - right.physical_position.y)
    .map((system) =>
      renderSchematicSystem(
        sessionValue.battle_state,
        ship,
        system,
        selectedSystemId,
        system.type === "weapon_mount" ? weaponIntentByMountId.get(system.id) ?? null : null,
        getSystemPlaybackTone(playbackEvent, ship.ship_instance_id, system.id)
      )
    )
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

function renderFooterStrip(sessionValue: MatchSessionView | null, playbackEvent: ResolverEvent | null): string {
  const playbackSummary =
    sessionValue && playbackEvent
      ? formatResolutionEventSummary(sessionValue, playbackEvent)
      : sessionValue?.last_resolution
        ? `Resolved T${sessionValue.last_resolution.resolved_from_turn_number}`
        : "No turn resolved yet";
  const recentResolutionMarkup = sessionValue?.last_resolution
    ? `<ul class="resolution-feed">${getRecentResolutionEvents(sessionValue)
        .map((event) => `<li>${formatResolutionEventSummary(sessionValue, event)}</li>`)
        .join("")}</ul>`
    : `<div class="resolution-feed resolution-feed--empty">Awaiting first turn resolution.</div>`;
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
        <span class="section-kicker">Resolution Playback</span>
        <strong>${playbackSummary}</strong>
      </div>
      <div class="footer-strip__cell">
        <span class="section-kicker">Recent Events</span>
        ${recentResolutionMarkup}
      </div>
      <div class="footer-strip__cell footer-strip__cell--log">
        <span class="section-kicker">Status</span>
        <strong>${contactText}</strong>
        <span class="footer-strip__meta">${latestMessage}</span>
      </div>
    </section>
  `;
}

function getRectangleBoundary(sessionValue: MatchSessionView): RectangleBoundary | null {
  const boundary = sessionValue.battle_state.match_setup.battlefield.boundary;

  return boundary.kind === "rectangle" ? boundary : null;
}

function getTacticalCamera(
  sessionValue: MatchSessionView | null,
  plotPreview: PlotPreview | null,
  preferredShipInstanceId: ShipInstanceId | null
): TacticalCamera | null {
  if (!sessionValue) {
    return null;
  }

  const boundary = getRectangleBoundary(sessionValue);

  if (!boundary) {
    return null;
  }

  return buildTacticalCamera({
    state: sessionValue.battle_state,
    boundary,
    viewport: TACTICAL_VIEWPORT,
    selection: tacticalCameraSelection,
    preferred_ship_instance_id: preferredShipInstanceId,
    plot_preview: plotPreview
  });
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
  camera: TacticalCamera,
  ship: ShipRuntimeState,
  shipConfig: ShipConfig,
  slotLabel: string,
  targetCue: WeaponCue | null,
  isTargeted: boolean,
  isTargetable: boolean,
  playbackTone: "hit" | "destroyed" | "disengaged" | null
): string {
  const center = worldToTacticalViewport(camera, ship.pose.position);
  const hullPoints = getShipHullPoints(shipConfig, center);
  const headingVector = getHeadingVector(ship.pose.heading_degrees, TACTICAL_VIEWPORT.headingVectorLengthPx);
  const velocityProjection = worldToTacticalViewport(
    camera,
    {
      x: ship.pose.position.x + ship.pose.velocity.x * TACTICAL_VIEWPORT.velocityProjectionDistance,
      y: ship.pose.position.y + ship.pose.velocity.y * TACTICAL_VIEWPORT.velocityProjectionDistance
    }
  );
  const classes = [
    "ship-glyph",
    identityValue?.ship_instance_id === ship.ship_instance_id ? "ship-glyph--self" : "",
    sessionValue.pending_plot_ship_ids.includes(ship.ship_instance_id) ? "ship-glyph--pending" : "",
    isTargeted ? "ship-glyph--targeted" : "",
    playbackTone === "hit" ? "ship-glyph--impact" : "",
    playbackTone === "destroyed" ? "ship-glyph--destroyed" : "",
    playbackTone === "disengaged" ? "ship-glyph--disengaged" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const targetAttribute = isTargetable ? `data-target-ship="${ship.ship_instance_id}"` : "";
  const targetTag =
    targetCue && isArmedWeaponCue(targetCue)
      ? `${targetCue.charge_pips}P · ${
          targetCue.predicted_hit_probability !== null ? `${Math.round(targetCue.predicted_hit_probability * 100)}%` : "locked"
        }`
      : null;

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
      ${
        isTargeted
          ? `<circle class="ship-glyph__target-ring" cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" r="22" />`
          : ""
      }
      <text class="ship-glyph__label" x="${center.x.toFixed(2)}" y="${(center.y - 20).toFixed(2)}">
        ${slotLabel} · ${ship.ship_instance_id}
      </text>
      ${
        targetTag
          ? `<text class="ship-glyph__target-tag" x="${center.x.toFixed(2)}" y="${(center.y + 32).toFixed(2)}">TARGET · ${targetTag}</text>`
          : ""
      }
    </g>
  `;
}

function renderPreviewPath(camera: TacticalCamera, plotPreview: PlotPreview): string {
  const points = plotPreview.projected_path
    .map((sample) => {
      const point = worldToTacticalViewport(camera, sample.position);
      return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    })
    .join(" ");

  if (!points) {
    return "";
  }

  return `<polyline class="plot-preview__path" points="${points}" />`;
}

function renderPreviewGhost(sessionValue: MatchSessionView, camera: TacticalCamera, plotPreview: PlotPreview): string {
  const ship = sessionValue.battle_state.ships[plotPreview.ship_instance_id];

  if (!ship) {
    return "";
  }

  const shipConfig = getShipConfig(sessionValue.battle_state, ship);
  const center = worldToTacticalViewport(camera, plotPreview.projected_pose.position);
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

function renderPlotInteractionHandles(
  sessionValue: MatchSessionView,
  camera: TacticalCamera,
  plotSummary: PlotDraftSummary | null,
  plotPreview: PlotPreview | null
): string {
  if (!plotSummary || !plotPreview) {
    return "";
  }

  const ship = sessionValue.battle_state.ships[plotPreview.ship_instance_id];

  if (!ship) {
    return "";
  }

  if (!isWorldPointVisibleInTacticalCamera(camera, ship.pose.position, 42)) {
    return "";
  }

  const shipAnchor = worldToTacticalViewport(camera, ship.pose.position);
  const thrustHandle = {
    x: shipAnchor.x + plotSummary.world_thrust_fraction.x * TACTICAL_PLOT_HANDLES.thrustRadiusPx,
    y: shipAnchor.y - plotSummary.world_thrust_fraction.y * TACTICAL_PLOT_HANDLES.thrustRadiusPx
  };
  const headingAnchor = worldToTacticalViewport(camera, plotPreview.projected_pose.position);
  const headingVector = getHeadingVector(plotPreview.desired_end_heading_degrees, TACTICAL_PLOT_HANDLES.headingRadiusPx);
  const headingHandle = {
    x: headingAnchor.x + headingVector.x,
    y: headingAnchor.y + headingVector.y
  };

  return `
    <g class="plot-handles">
      <g class="plot-handles__thrust">
        <circle
          class="plot-handles__guide-ring"
          cx="${shipAnchor.x.toFixed(2)}"
          cy="${shipAnchor.y.toFixed(2)}"
          r="${TACTICAL_PLOT_HANDLES.thrustRadiusPx}"
        />
        <line
          class="plot-handles__vector"
          x1="${shipAnchor.x.toFixed(2)}"
          y1="${shipAnchor.y.toFixed(2)}"
          x2="${thrustHandle.x.toFixed(2)}"
          y2="${thrustHandle.y.toFixed(2)}"
        />
        <circle
          class="plot-handles__hit-target"
          cx="${thrustHandle.x.toFixed(2)}"
          cy="${thrustHandle.y.toFixed(2)}"
          r="18"
          data-plot-drag-handle="thrust"
        />
        <circle
          class="plot-handles__grip plot-handles__grip--thrust"
          cx="${thrustHandle.x.toFixed(2)}"
          cy="${thrustHandle.y.toFixed(2)}"
          r="10"
          data-plot-drag-handle="thrust"
        />
        <text class="plot-handles__label" x="${shipAnchor.x.toFixed(2)}" y="${(shipAnchor.y + TACTICAL_PLOT_HANDLES.thrustRadiusPx + 22).toFixed(2)}">
          burn vector
        </text>
      </g>
      <g class="plot-handles__heading">
        <circle
          class="plot-handles__guide-ring plot-handles__guide-ring--heading"
          cx="${headingAnchor.x.toFixed(2)}"
          cy="${headingAnchor.y.toFixed(2)}"
          r="${TACTICAL_PLOT_HANDLES.headingRadiusPx}"
        />
        <line
          class="plot-handles__vector plot-handles__vector--heading"
          x1="${headingAnchor.x.toFixed(2)}"
          y1="${headingAnchor.y.toFixed(2)}"
          x2="${headingHandle.x.toFixed(2)}"
          y2="${headingHandle.y.toFixed(2)}"
        />
        <circle
          class="plot-handles__hit-target"
          cx="${headingHandle.x.toFixed(2)}"
          cy="${headingHandle.y.toFixed(2)}"
          r="16"
          data-plot-drag-handle="heading"
        />
        <circle
          class="plot-handles__grip plot-handles__grip--heading"
          cx="${headingHandle.x.toFixed(2)}"
          cy="${headingHandle.y.toFixed(2)}"
          r="9"
          data-plot-drag-handle="heading"
        />
        <text class="plot-handles__label" x="${headingAnchor.x.toFixed(2)}" y="${(headingAnchor.y + TACTICAL_PLOT_HANDLES.headingRadiusPx + 20).toFixed(2)}">
          end heading
        </text>
      </g>
    </g>
  `;
}

function renderWeaponCue(sessionValue: MatchSessionView, camera: TacticalCamera, plotPreview: PlotPreview): string {
  return plotPreview.weapon_cues
    .map((cue) => {
      if (cue.target_position === null) {
        return "";
      }

      const polygonPoints = getArcPolygonPoints(cue, 12)
        .map((point) => {
          const projected = worldToTacticalViewport(camera, point);
          return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
        })
        .join(" ");
      const mountPoint = worldToTacticalViewport(camera, cue.mount_position);
      const targetPoint = worldToTacticalViewport(camera, cue.target_position);
      const isArmed = isArmedWeaponCue(cue);
      const cueClass = !isArmed
        ? "plot-preview__cue--idle"
        : cue.target_in_arc && cue.target_in_range
          ? "plot-preview__cue--valid"
          : "plot-preview__cue--warn";
      const targetShortLabel = getShipSlotLabel(sessionValue, cue.target_ship_instance_id);
      const hitText = isArmed
        ? cue.predicted_hit_probability !== null
          ? `${Math.round(cue.predicted_hit_probability * 100)}%`
          : "no shot"
        : "standby";

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
            ${cue.label} · ${targetShortLabel} · ${cue.charge_pips}p · ${hitText}
          </text>
        </g>
      `;
    })
    .join("");
}

function renderPlotPreviewOverlay(
  sessionValue: MatchSessionView,
  camera: TacticalCamera,
  plotPreview: PlotPreview | null,
  focusedMountId: SystemId | null,
  plotSummary: PlotDraftSummary | null
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
      ${renderPreviewPath(camera, focusedPreview)}
      ${renderWeaponCue(sessionValue, camera, focusedPreview)}
      ${renderPreviewGhost(sessionValue, camera, focusedPreview)}
    </g>
  `;
}

function getBearingDegrees(from: Vector2, to: Vector2): number {
  return normalizeDegrees((Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI);
}

function getOffscreenMarkerTextAnchor(camera: TacticalCamera, anchor: Vector2): "start" | "middle" | "end" {
  if (anchor.x <= camera.drawable.min_x + 40) {
    return "start";
  }

  if (anchor.x >= camera.drawable.max_x - 40) {
    return "end";
  }

  return "middle";
}

function renderOffscreenMarker(
  camera: TacticalCamera,
  viewpointShip: ShipRuntimeState | null,
  ship: ShipRuntimeState,
  slotLabel: string,
  targetCue: WeaponCue | null,
  isTargeted: boolean,
  isTargetable: boolean,
  isSelf: boolean,
  playbackTone: "hit" | "destroyed" | "disengaged" | null
): string {
  const anchor = clampWorldPointToTacticalViewportEdge(camera, ship.pose.position, TACTICAL_VIEWPORT.markerInsetPx);
  const targetAttribute = isTargetable ? `data-target-ship="${ship.ship_instance_id}"` : "";
  const labelAnchor = getOffscreenMarkerTextAnchor(camera, anchor);
  const labelX =
    labelAnchor === "start" ? anchor.x + 18 : labelAnchor === "end" ? anchor.x - 18 : anchor.x;
  const bearingDegrees = viewpointShip ? getBearingDegrees(viewpointShip.pose.position, ship.pose.position) : 0;
  const rangeText = viewpointShip
    ? formatDistance(
        Math.hypot(ship.pose.position.x - viewpointShip.pose.position.x, ship.pose.position.y - viewpointShip.pose.position.y)
      )
    : formatDistance(Math.hypot(ship.pose.position.x - camera.center_world.x, ship.pose.position.y - camera.center_world.y));
  const classes = [
    "offscreen-marker",
    isSelf ? "offscreen-marker--self" : "",
    isTargeted ? "offscreen-marker--targeted" : "",
    isTargetable ? "offscreen-marker--targetable" : "",
    playbackTone === "hit" ? "offscreen-marker--impact" : "",
    playbackTone === "destroyed" ? "offscreen-marker--destroyed" : "",
    playbackTone === "disengaged" ? "offscreen-marker--disengaged" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const targetStatus =
    targetCue && isArmedWeaponCue(targetCue)
      ? `TARGET · ${targetCue.charge_pips}P${
          targetCue.predicted_hit_probability !== null ? ` · ${Math.round(targetCue.predicted_hit_probability * 100)}%` : ""
        }`
      : null;

  return `
    <g class="${classes}">
      <circle
        class="offscreen-marker__hit"
        cx="${anchor.x.toFixed(2)}"
        cy="${anchor.y.toFixed(2)}"
        r="24"
        ${targetAttribute}
      />
      <g transform="translate(${anchor.x.toFixed(2)} ${anchor.y.toFixed(2)}) rotate(${bearingDegrees.toFixed(2)})">
        <path class="offscreen-marker__arrow" d="M-12 -9 L12 0 L-12 9 Z" />
      </g>
      <circle class="offscreen-marker__core" cx="${anchor.x.toFixed(2)}" cy="${anchor.y.toFixed(2)}" r="4" />
      <text
        class="offscreen-marker__label"
        x="${labelX.toFixed(2)}"
        y="${(anchor.y - 16).toFixed(2)}"
        text-anchor="${labelAnchor}"
      >
        ${slotLabel} · ${rangeText}
      </text>
      ${
        targetStatus
          ? `<text class="offscreen-marker__status" x="${labelX.toFixed(2)}" y="${(anchor.y + 20).toFixed(2)}" text-anchor="${labelAnchor}">${targetStatus}</text>`
          : ""
      }
    </g>
  `;
}

function renderResolutionPlaybackOverlay(camera: TacticalCamera, playbackEvent: ResolverEvent | null): string {
  if (!playbackEvent) {
    return "";
  }

  if (playbackEvent.type === "weapon_fired") {
    const mountPoint = worldToTacticalViewport(camera, playbackEvent.details.mountPosition);
    const targetPoint = worldToTacticalViewport(camera, playbackEvent.details.targetPosition);

    return `
      <g class="resolution-playback resolution-playback--shot">
        <circle class="resolution-playback__flash" cx="${mountPoint.x.toFixed(2)}" cy="${mountPoint.y.toFixed(2)}" r="12" />
        <line
          class="resolution-playback__shot-line"
          x1="${mountPoint.x.toFixed(2)}"
          y1="${mountPoint.y.toFixed(2)}"
          x2="${targetPoint.x.toFixed(2)}"
          y2="${targetPoint.y.toFixed(2)}"
        />
      </g>
    `;
  }

  if (playbackEvent.type === "hit_registered") {
    const impactPoint = worldToTacticalViewport(camera, playbackEvent.details.impactPoint);

    return `
      <g class="resolution-playback resolution-playback--impact">
        <circle class="resolution-playback__impact-ring" cx="${impactPoint.x.toFixed(2)}" cy="${impactPoint.y.toFixed(2)}" r="16" />
        <circle class="resolution-playback__impact-core" cx="${impactPoint.x.toFixed(2)}" cy="${impactPoint.y.toFixed(2)}" r="5" />
      </g>
    `;
  }

  if (playbackEvent.type === "ship_destroyed" || playbackEvent.type === "ship_disengaged") {
    const finalPoint = worldToTacticalViewport(camera, playbackEvent.details.finalPosition);
    const label = playbackEvent.type === "ship_destroyed" ? "destroyed" : "boundary disengage";

    return `
      <g class="resolution-playback resolution-playback--terminal">
        <circle class="resolution-playback__terminal-ring" cx="${finalPoint.x.toFixed(2)}" cy="${finalPoint.y.toFixed(2)}" r="26" />
        <text class="resolution-playback__terminal-label" x="${finalPoint.x.toFixed(2)}" y="${(finalPoint.y - 32).toFixed(2)}">${label}</text>
      </g>
    `;
  }

  return "";
}

function renderScaleBar(camera: TacticalCamera): string {
  const worldUnits = getTacticalCameraScaleBarWorldUnits(camera, TACTICAL_VIEWPORT.scaleBarTargetPx);

  if (worldUnits <= 0) {
    return "";
  }

  const pixelWidth = worldUnits / camera.world_units_per_px;
  const right = camera.drawable.max_x - 18;
  const left = right - pixelWidth;
  const baseline = camera.drawable.max_y - 16;

  return `
    <g class="tactical-scale-bar">
      <line class="tactical-scale-bar__line" x1="${left.toFixed(2)}" y1="${baseline.toFixed(2)}" x2="${right.toFixed(
        2
      )}" y2="${baseline.toFixed(2)}" />
      <line class="tactical-scale-bar__tick" x1="${left.toFixed(2)}" y1="${(baseline - 6).toFixed(2)}" x2="${left.toFixed(
        2
      )}" y2="${(baseline + 6).toFixed(2)}" />
      <line class="tactical-scale-bar__tick" x1="${right.toFixed(2)}" y1="${(baseline - 6).toFixed(2)}" x2="${right.toFixed(
        2
      )}" y2="${(baseline + 6).toFixed(2)}" />
      <text class="tactical-scale-bar__label" x="${((left + right) / 2).toFixed(2)}" y="${(baseline - 10).toFixed(2)}">
        ${formatDistance(worldUnits)}
      </text>
    </g>
  `;
}

function renderTacticalCameraControls(camera: TacticalCamera | null): string {
  const modeMarkup = TACTICAL_CAMERA_MODES.map((mode) => {
    const active = tacticalCameraSelection.mode_id === mode.id;

    return `<button class="camera-toggle ${active ? "camera-toggle--active" : ""}" data-camera-mode="${
      mode.id
    }">${mode.short_label}</button>`;
  }).join("");
  const zoomMarkup = TACTICAL_ZOOM_PRESETS.map((preset) => {
    const active = tacticalCameraSelection.zoom_preset_id === preset.id;

    return `<button class="camera-toggle ${active ? "camera-toggle--active" : ""}" data-camera-zoom="${
      preset.id
    }">${preset.short_label}</button>`;
  }).join("");

  return `
    <div class="camera-controls">
      <div class="camera-controls__group">
        <span class="camera-controls__label">View</span>
        <div class="camera-toggle-row">${modeMarkup}</div>
      </div>
      <div class="camera-controls__group">
        <span class="camera-controls__label">Zoom</span>
        <div class="camera-toggle-row">${zoomMarkup}</div>
      </div>
      ${
        camera
          ? `<div class="camera-controls__readout">${getTacticalCameraModeDefinition(camera.selection.mode_id).short_label} · ${
              getTacticalZoomPresetDefinition(camera.selection.zoom_preset_id).short_label
            }</div>`
          : ""
      }
    </div>
  `;
}

function renderTacticalViewport(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null,
  plotSummary: PlotDraftSummary | null,
  plotPreview: PlotPreview | null,
  selectedSystemContext: ReturnType<typeof getSelectedSystemContext>,
  camera: TacticalCamera | null,
  playbackEvent: ResolverEvent | null
): string {
  if (!sessionValue) {
    return "<p>Waiting for the session snapshot before rendering the tactical board.</p>";
  }

  if (!camera) {
    return "<p>The current battlefield boundary is not yet supported by the tactical viewport.</p>";
  }

  const focusedMountId = selectedSystemContext?.system.type === "weapon_mount" ? selectedSystemContext.system.id : null;
  const emphasizedCues = (focusedMountId === null
    ? plotPreview?.weapon_cues ?? []
    : plotPreview?.weapon_cues.filter((cue) => cue.mount_id === focusedMountId) ?? []
  ).filter((cue) => cue.target_ship_instance_id !== null);
  const armedCueByTargetShipId = new Map<ShipInstanceId, WeaponCue>();

  for (const cue of emphasizedCues) {
    if (!isArmedWeaponCue(cue) || cue.target_ship_instance_id === null) {
      continue;
    }

    armedCueByTargetShipId.set(cue.target_ship_instance_id, cue);
  }

  const targetedShipIds = new Set(armedCueByTargetShipId.keys());
  const viewpointShip = camera.viewpoint_ship_instance_id
    ? sessionValue.battle_state.ships[camera.viewpoint_ship_instance_id] ?? null
    : null;
  const visibleShips: string[] = [];
  const offscreenMarkers: string[] = [];

  for (const participant of sessionValue.battle_state.match_setup.participants) {
    const ship = sessionValue.battle_state.ships[participant.ship_instance_id];
    const shipConfig = sessionValue.battle_state.match_setup.ship_catalog[participant.ship_config_id];

    if (!ship || !shipConfig) {
      continue;
    }

    const isSelf = identityValue?.ship_instance_id === ship.ship_instance_id;
    const targetCue = armedCueByTargetShipId.get(ship.ship_instance_id) ?? null;
    const isTargeted = targetedShipIds.has(ship.ship_instance_id);
    const isTargetable = focusedMountId !== null && !isSelf;
    const playbackTone = getShipPlaybackTone(playbackEvent, ship.ship_instance_id);
    const visible = isWorldPointVisibleInTacticalCamera(camera, ship.pose.position, 34);

    if (visible) {
      visibleShips.push(
        renderShipGlyph(
          sessionValue,
          identityValue,
          camera,
          ship,
          shipConfig,
          participant.slot_id.toUpperCase(),
          targetCue,
          isTargeted,
          isTargetable,
          playbackTone
        )
      );
    } else {
      offscreenMarkers.push(
        renderOffscreenMarker(
          camera,
          viewpointShip,
          ship,
          participant.slot_id.toUpperCase(),
          targetCue,
          isTargeted,
          isTargetable,
          isSelf,
          playbackTone
        )
      );
    }
  }

  const overlay = renderPlotPreviewOverlay(sessionValue, camera, plotPreview, focusedMountId, plotSummary);
  const interactionHandles = renderPlotInteractionHandles(sessionValue, camera, plotSummary, plotPreview);
  const playbackOverlay = renderResolutionPlaybackOverlay(camera, playbackEvent);

  return `
    <div class="tactical-board">
      <svg
        viewBox="0 0 ${TACTICAL_VIEWPORT.width} ${TACTICAL_VIEWPORT.height}"
        aria-label="Tactical viewport"
        data-tactical-viewport
      >
        <defs>
          <clipPath id="tactical-plot-clip">
            <rect
              x="${camera.drawable.min_x}"
              y="${camera.drawable.min_y}"
              width="${camera.drawable.width}"
              height="${camera.drawable.height}"
              rx="18"
            />
          </clipPath>
        </defs>
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
        <g clip-path="url(#tactical-plot-clip)">
          ${overlay}
          ${visibleShips.join("")}
          ${playbackOverlay}
          ${interactionHandles}
        </g>
        ${offscreenMarkers.join("")}
        ${renderScaleBar(camera)}
      </svg>
    </div>
  `;
}

function renderActionStripControls(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null,
  plotSummary: PlotDraftSummary | null
): string {
  const claimableSlotStates = getClaimableSlotStates(sessionValue, identityValue);

  if (!identityValue || identityValue.role !== "player") {
    return `
      <section class="commit-strip commit-strip--spectator">
        <p class="action-strip__note">Player slots: ${sessionValue?.slot_states
          .map((slotState) => formatSlotConnectionLabel(sessionValue, slotState.slot_id))
          .join(" · ") || "awaiting session state"}. Additional sessions join as spectators.</p>
        <div class="commit-strip__actions">
          ${claimableSlotStates
            .map(
              (slotState) =>
                `<button class="action-button action-button--secondary" data-claim-slot="${slotState.slot_id}">Claim ${slotState.slot_id}</button>`
            )
            .join("")}
          ${health?.resetEnabled ? `<button class="action-button action-button--secondary" data-reset-session>Reset match</button>` : ""}
        </div>
      </section>
    `;
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
        ${claimableSlotStates
          .map(
            (slotState) =>
              `<button class="action-button action-button--secondary" data-claim-slot="${slotState.slot_id}">Claim ${slotState.slot_id}</button>`
          )
          .join("")}
        ${health?.resetEnabled ? `<button class="action-button action-button--secondary" data-reset-session>Reset match</button>` : ""}
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
  const camera = getTacticalCamera(sessionValue, plotPreview, displayed?.ship.ship_instance_id ?? null);
  const playbackEvent = getCurrentResolutionPlaybackEvent(sessionValue);
  const tacticalViewport = renderTacticalViewport(
    sessionValue,
    identity,
    plotSummary,
    plotPreview,
    selectedSystemContext,
    camera,
    playbackEvent
  );
  const schematicViewport = renderSchematicViewport(
    sessionValue,
    identity,
    plotSummary,
    selectedSystemContext,
    plotPreview,
    playbackEvent
  );
  const readoutStrip = renderReadoutStrip(sessionValue, identity);
  const actionStripControls = renderActionStripControls(sessionValue, identity, plotSummary);
  const footerStrip = renderFooterStrip(sessionValue, playbackEvent);
  const phaseLabel = getPhaseLabel(sessionValue, selectedSystemContext);
  const missionBarClass = `mission-bar${selectedSystemContext?.system.type === "weapon_mount" ? " mission-bar--aim" : ""}`;
  const cameraMode = camera ? getTacticalCameraModeDefinition(camera.selection.mode_id) : null;
  const cameraZoom = camera ? getTacticalZoomPresetDefinition(camera.selection.zoom_preset_id) : null;

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
        <span>Slots ${sessionValue?.slot_states.map((slotState) => formatSlotConnectionLabel(sessionValue, slotState.slot_id)).join(" · ") || "..."}</span>
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
              <h2>${cameraMode?.label ?? "Shared sensor plot"}</h2>
            </div>
            <div class="tactical-panel__header-right">
            <div class="tactical-panel__meta">
                <span>${selectedSystemContext?.system.type === "weapon_mount" ? "Aim mode overlays the selected mount only." : "Drag burn and end-heading handles directly on the plot."}</span>
                <span>${cameraZoom ? `Zoom ${cameraZoom.label}.` : ""} Dashed geometry is your current draft preview.</span>
            </div>
              ${renderTacticalCameraControls(camera)}
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

  document.querySelectorAll<SVGElement>("[data-plot-drag-handle]").forEach((element) => {
    element.addEventListener("pointerdown", (event) => {
      const handleId = element.getAttribute("data-plot-drag-handle") as TacticalDragHandleId | null;

      if (!handleId) {
        return;
      }

      event.preventDefault();
      activeTacticalDrag = {
        handle_id: handleId,
        pointer_id: event.pointerId
      };
      document.body.classList.add("is-plot-dragging");
      applyTacticalDrag(event.clientX, event.clientY);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-camera-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const modeId = button.dataset.cameraMode as TacticalCameraModeId | undefined;

      if (!modeId) {
        return;
      }

      tacticalCameraSelection = {
        ...tacticalCameraSelection,
        mode_id: modeId
      };
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-camera-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      const zoomPresetId = button.dataset.cameraZoom as TacticalZoomPresetId | undefined;

      if (!zoomPresetId) {
        return;
      }

      tacticalCameraSelection = {
        ...tacticalCameraSelection,
        zoom_preset_id: zoomPresetId
      };
      render();
    });
  });

  document.querySelector<HTMLButtonElement>("[data-reset-plot]")?.addEventListener("click", () => {
    if (!session || !identity || identity.role !== "player" || !identity.ship_instance_id) {
      return;
    }

    plotDraft = createPlotDraft(session.battle_state, identity.ship_instance_id);
    render();
  });

  document.querySelector<HTMLButtonElement>("[data-reset-session]")?.addEventListener("click", () => {
    void requestSessionReset();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-claim-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const slotId = button.dataset.claimSlot;

      if (!slotId) {
        return;
      }

      socket.send(
        JSON.stringify({
          type: "claim_slot",
          slot_id: slotId
        })
      );
      logMessage(`claim requested · ${slotId}`);
      render();
    });
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

async function requestSessionReset(): Promise<void> {
  const storedToken = readStoredValue(ADMIN_TOKEN_STORAGE_KEY);
  const adminToken = storedToken ?? window.prompt("Enter the host reset token");

  if (!adminToken) {
    return;
  }

  const response = await fetch("/api/session/reset", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sg2-admin-token": adminToken
    },
    body: JSON.stringify({ adminToken })
  });
  const payload = (await response.json()) as { ok: boolean; message?: string; turnNumber?: number };

  if (!response.ok || !payload.ok) {
    writeStoredValue(ADMIN_TOKEN_STORAGE_KEY, null);
    logMessage(payload.message ?? "session reset failed");
    render();
    return;
  }

  writeStoredValue(ADMIN_TOKEN_STORAGE_KEY, adminToken);
  logMessage(`session reset requested · turn ${payload.turnNumber ?? "?"}`);
  render();
}

function handleServerMessage(message: ServerToClientMessage): void {
  if (message.type === "hello") {
    identity = message.identity;
    session = message.session;
    writeStoredValue(RECONNECT_TOKEN_STORAGE_KEY, message.identity.reconnect_token);
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    syncResolutionPlayback(session);
    logMessage(
      `hello received · ${message.identity.role}${message.identity.slot_id ? ` · ${message.identity.slot_id}` : ""}`
    );
    render();
    return;
  }

  if (message.type === "session_reset") {
    clearResolutionPlayback();
    logMessage(`session reset · ${message.matchId} · turn ${message.turnNumber}`);
    render();
    return;
  }

  if (message.type === "session_state") {
    session = message.session;
    syncResolutionPlayback(session);
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
  const reconnectToken = readStoredValue(RECONNECT_TOKEN_STORAGE_KEY);
  const url = new URL(`${protocol}//${window.location.host}/ws`);

  if (reconnectToken) {
    url.searchParams.set("reconnectToken", reconnectToken);
  }

  socket = new WebSocket(url.toString());

  socket.addEventListener("open", () => {
    wsState = "connected";
    render();
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data) as ServerToClientMessage;
    handleServerMessage(message);
  });

  socket.addEventListener("close", (event) => {
    wsState = "closed";
    if (event.code !== 4001 && reconnectTimer === null) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        wsState = "connecting";
        render();
        connectWebSocket();
      }, 1000);
    }
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
