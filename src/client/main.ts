import "./style.css";
import {
  renderActionStripControls,
  renderBridgeShell,
  renderFooterStrip,
  renderMatchOutcomeBanner,
  renderReadoutStrip,
  renderTacticalCameraControls
} from "./bridge_shell_view.js";
import {
  applyResolutionPlaybackStepToBattleState,
  buildResolutionPlaybackState,
  getCurrentResolutionPlaybackStep,
  getResolutionKey,
  isResolutionFocusEvent,
  type ResolutionPlaybackState,
  type ResolutionPlaybackStep
} from "./resolution_playback.js";
import { renderSchematicPanel } from "./schematic_view.js";
import { renderTacticalBoard, TACTICAL_VIEWPORT } from "./tactical_view.js";
import {
  buildPlotPreview,
  buildTacticalCamera,
  buildPlotSubmissionFromDraft,
  clearPlotDraftWeaponIntent,
  createPlotDraft,
  createDefaultTacticalCameraSelection,
  getTacticalCameraModeDefinition,
  getTacticalZoomPresetDefinition,
  getShipConfig,
  getSystemStateAndEffects,
  setPlotDraftWeaponTarget,
  setPlotDraftDesiredEndHeading,
  setPlotDraftWorldThrust,
  summarizePlotDraft,
  TACTICAL_ZOOM_PRESETS,
  tacticalViewportToWorld,
  worldToTacticalViewport
} from "../shared/index.js";
import type { MatchSessionView, ResolverEvent, ServerToClientMessage, SessionIdentity } from "../shared/index.js";
import type {
  BattleState,
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
const LAST_PRESENTED_RESOLUTION_KEY_STORAGE_KEY = "sg2_last_presented_resolution_key";

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
let resolutionPlayback: ResolutionPlaybackState | null = null;
let resolutionPlaybackTimer: number | null = null;
let lastPresentedResolutionKey: string | null = readStoredValue(LAST_PRESENTED_RESOLUTION_KEY_STORAGE_KEY);
let hostToolsOpen = false;
// Keep discrete zoom support wired up, but hide the controls until tactical scale tuning resumes.
const SHOW_TACTICAL_ZOOM_CONTROLS = false;

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

type RectangleBoundary = Extract<BattleBoundary, { kind: "rectangle" }>;

const TACTICAL_PLOT_HANDLES = {
  thrustRadiusPx: 72,
  headingRadiusPx: 44,
  deadzonePx: 8
} as const;

function normalizeDegrees(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function capitalizeLabel(label: string): string {
  if (label.length === 0) {
    return label;
  }

  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function formatLinkStatusLabel(state: typeof wsState): string {
  switch (state) {
    case "connected":
      return "Link connected";
    case "connecting":
      return "Link connecting";
    case "closed":
      return "Link closed";
    case "error":
      return "Link error";
    default:
      return "Link offline";
  }
}

function hasLocalHostResetAccess(): boolean {
  if (!health?.resetEnabled) {
    return false;
  }

  if (readStoredValue(ADMIN_TOKEN_STORAGE_KEY)) {
    return true;
  }

  return (
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "::1"
  );
}

function getBridgeStationLabel(identityValue: SessionIdentity | null, shipName: string | null): string {
  if (!identityValue) {
    return "Awaiting bridge assignment";
  }

  if (identityValue.role === "player") {
    return shipName ? `Aboard ${shipName}` : "Player station";
  }

  return shipName ? `Observer view · ${shipName}` : "Observer view";
}

function formatBridgeMessage(message: string | undefined, identityValue: SessionIdentity | null): string {
  if (!message) {
    return identityValue?.role === "player" ? "Ship controls live." : "Spectator feed live.";
  }

  if (message.startsWith("hello received")) {
    return identityValue?.role === "player" ? "Bridge station assigned." : "Spectator feed connected.";
  }

  if (message.startsWith("submitted direct plot")) {
    return "Plot sent to host.";
  }

  if (message.startsWith("plot accepted")) {
    return "Plot accepted by host.";
  }

  if (message.startsWith("session updated")) {
    return "Turn state updated.";
  }

  if (message.startsWith("session reset requested")) {
    return "Reset request sent to host.";
  }

  if (message.startsWith("session reset")) {
    return "Match reset.";
  }

  if (message.startsWith("claim requested")) {
    return "Seat claim sent.";
  }

  if (message.includes("failed") || message.includes("error") || message.startsWith("plot rejected")) {
    return capitalizeLabel(message);
  }

  return identityValue?.role === "player" ? "Ship controls live." : "Spectator feed live.";
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

  const currentStep = getCurrentResolutionPlaybackStep(resolutionPlayback, session);

  if (!resolutionPlayback || !currentStep) {
    return;
  }

  resolutionPlaybackTimer = window.setTimeout(() => {
    if (!resolutionPlayback) {
      return;
    }

    if (resolutionPlayback.current_step_index >= resolutionPlayback.steps.length - 1) {
      resolutionPlayback = null;
      resolutionPlaybackTimer = null;
      render();
      return;
    }

    resolutionPlayback = {
      ...resolutionPlayback,
      current_step_index: resolutionPlayback.current_step_index + 1
    };
    queueResolutionPlaybackAdvance();
    render();
  }, currentStep.duration_ms);
}

function syncResolutionPlayback(
  sessionValue: MatchSessionView | null,
  previousBattleState: BattleState | null = null
): void {
  const key = getResolutionKey(sessionValue);

  if (!key || !sessionValue?.last_resolution) {
    if (sessionValue && !sessionValue.last_resolution) {
      lastPresentedResolutionKey = null;
      writeStoredValue(LAST_PRESENTED_RESOLUTION_KEY_STORAGE_KEY, null);
    }

    clearResolutionPlayback();
    return;
  }

  if (resolutionPlayback?.key === key || lastPresentedResolutionKey === key) {
    return;
  }

  const nextPlayback = buildResolutionPlaybackState({
    sessionValue,
    previousBattleState
  });

  if (!nextPlayback) {
    clearResolutionPlayback();
    return;
  }

  resolutionPlayback = nextPlayback;
  lastPresentedResolutionKey = key;
  writeStoredValue(LAST_PRESENTED_RESOLUTION_KEY_STORAGE_KEY, key);
  queueResolutionPlaybackAdvance();
}

function getCurrentResolutionPlaybackStepForSession(
  sessionValue: MatchSessionView | null
): ResolutionPlaybackStep | null {
  return getCurrentResolutionPlaybackStep(resolutionPlayback, sessionValue);
}

function getRecentResolutionEvents(sessionValue: MatchSessionView | null): ResolverEvent[] {
  return (
    sessionValue?.last_resolution?.events
      .filter((event) => isResolutionFocusEvent(event) && event.type !== "turn_ended")
      .slice(-4)
      .reverse() ?? []
  );
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

function getPlayerFacingContactLabel(
  sessionValue: MatchSessionView,
  identityValue: SessionIdentity | null,
  shipInstanceId: ShipInstanceId | null
): string {
  if (!shipInstanceId) {
    return "none";
  }

  if (identityValue?.role === "player") {
    return identityValue.ship_instance_id === shipInstanceId ? "you" : "contact";
  }

  return getShipSlotLabel(sessionValue, shipInstanceId).toLowerCase();
}

function formatShipContactLabel(
  sessionValue: MatchSessionView,
  identityValue: SessionIdentity | null,
  shipInstanceId: ShipInstanceId | null
): string {
  if (!shipInstanceId) {
    return "none";
  }

  return getPlayerFacingContactLabel(sessionValue, identityValue, shipInstanceId);
}

function getShipNarrationLabels(
  sessionValue: MatchSessionView,
  identityValue: SessionIdentity | null,
  shipInstanceId: ShipInstanceId | null
): {
  subject: string;
  object: string;
  possessive: string;
} {
  if (!shipInstanceId) {
    return {
      subject: "Unknown contact",
      object: "unknown contact",
      possessive: "Unknown contact"
    };
  }

  if (identityValue?.role === "player") {
    if (identityValue.ship_instance_id === shipInstanceId) {
      return {
        subject: "You",
        object: "you",
        possessive: "Your"
      };
    }

    return {
      subject: "Contact",
      object: "contact",
      possessive: "Contact"
    };
  }

  const slotLabel = capitalizeLabel(getShipSlotLabel(sessionValue, shipInstanceId).toLowerCase());

  return {
    subject: slotLabel,
    object: slotLabel.toLowerCase(),
    possessive: slotLabel.endsWith("s") ? `${slotLabel}'` : `${slotLabel}'s`
  };
}

function formatSystemDisplayLabel(
  sessionValue: MatchSessionView,
  shipInstanceId: ShipInstanceId | null,
  systemId: SystemId
): string {
  if (!shipInstanceId) {
    return systemId.replaceAll("_", " ");
  }

  const ship = sessionValue.battle_state.ships[shipInstanceId];

  if (!ship) {
    return systemId.replaceAll("_", " ");
  }

  const shipConfig = getShipConfig(sessionValue.battle_state, ship);
  const system = shipConfig.systems.find((candidate) => candidate.id === systemId);

  return (system?.render?.label ?? system?.render?.short_label ?? systemId.replaceAll("_", " ")).toLowerCase();
}

function formatResolutionEventSummary(
  sessionValue: MatchSessionView,
  identityValue: SessionIdentity | null,
  event: ResolverEvent
): string {
  let summary: string;

  switch (event.type) {
    case "weapon_fired": {
      const actor = getShipNarrationLabels(sessionValue, identityValue, event.actor ?? null);
      const target = getShipNarrationLabels(sessionValue, identityValue, event.target ?? null);
      summary = `${actor.subject} fired ${formatSystemDisplayLabel(
        sessionValue,
        event.actor ?? null,
        event.details.mountId
      )} at ${target.object} · ${event.details.chargePips}P`;
      break;
    }
    case "hit_registered": {
      const attacker = getShipNarrationLabels(sessionValue, identityValue, event.details.fromActor);
      const target = getShipNarrationLabels(sessionValue, identityValue, event.target ?? null);
      summary = `${attacker.subject} hit ${target.object}${
        event.details.impactSystemId
          ? ` · ${formatSystemDisplayLabel(sessionValue, event.target ?? null, event.details.impactSystemId)}`
          : ""
      }`;
      break;
    }
    case "subsystem_damaged": {
      const target = getShipNarrationLabels(sessionValue, identityValue, event.actor ?? null);
      summary = `${target.possessive} ${formatSystemDisplayLabel(
        sessionValue,
        event.actor ?? null,
        event.details.systemId
      )} ${event.details.newState.toLowerCase()}`;
      break;
    }
    case "ship_destroyed": {
      const target = getShipNarrationLabels(sessionValue, identityValue, event.target ?? null);
      summary = target.subject === "You" ? "You were destroyed" : `${target.subject} destroyed`;
      break;
    }
    case "ship_disengaged": {
      const target = getShipNarrationLabels(sessionValue, identityValue, event.target ?? null);
      summary = target.subject === "You" ? "You crossed the boundary" : `${target.subject} withdrew`;
      break;
    }
    case "turn_ended": {
      if (!event.details.winner) {
        summary = `Turn ${event.details.turnNumber - 1} resolved`;
        break;
      }

      const winner = getShipNarrationLabels(sessionValue, identityValue, event.details.winner);
      summary =
        winner.subject === "You"
          ? `Turn ${event.details.turnNumber - 1} resolved · victory`
          : winner.subject === "Contact"
            ? `Turn ${event.details.turnNumber - 1} resolved · defeat`
            : `Turn ${event.details.turnNumber - 1} resolved · ${winner.object} wins`;
      break;
    }
    default:
      summary = event.type;
      break;
  }

  return capitalizeLabel(summary);
}

function getResolutionEventDisplaySubTick(sessionValue: MatchSessionView, event: ResolverEvent): number {
  const totalSubTicks = sessionValue.battle_state.match_setup.rules.turn.sub_ticks;

  if (event.type === "turn_ended") {
    return totalSubTicks;
  }

  return Math.min(totalSubTicks, event.sub_tick + 1);
}

function getResolutionPlaybackMetaLabel(
  sessionValue: MatchSessionView | null,
  playbackStep: ResolutionPlaybackStep | null
): string {
  if (!sessionValue?.last_resolution || !playbackStep) {
    return sessionValue?.last_resolution
      ? `Turn ${sessionValue.last_resolution.resolved_from_turn_number} replay complete`
      : "Awaiting first exchange.";
  }

  if (playbackStep.focus_event && playbackStep.focus_event_index !== null) {
    return `Replay turn ${sessionValue.last_resolution.resolved_from_turn_number} · event ${
      playbackStep.focus_event_index + 1
    } of ${playbackStep.focus_event_count}`;
  }

  return `Replay turn ${sessionValue.last_resolution.resolved_from_turn_number} · motion ${playbackStep.display_sub_tick} of ${playbackStep.total_sub_ticks}`;
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

function getClaimSeatLabel(sessionValue: MatchSessionView | null, slotId: string): string {
  if (!sessionValue) {
    return "Take open seat";
  }

  const participant = sessionValue.battle_state.match_setup.participants.find((candidate) => candidate.slot_id === slotId);

  if (!participant) {
    return "Take open seat";
  }

  const ship = sessionValue.battle_state.ships[participant.ship_instance_id];

  if (!ship) {
    return "Take open seat";
  }

  return `Take ${getShipConfig(sessionValue.battle_state, ship).name}`;
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

function isMatchEnded(sessionValue: MatchSessionView | null): boolean {
  return sessionValue?.battle_state.outcome.end_reason !== null;
}

type MatchOutcomePresentation = {
  tone: "victory" | "defeat" | "neutral";
  headline: string;
  detail: string;
  reset_hint: string;
};

function getMatchOutcomePresentation(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null
): MatchOutcomePresentation | null {
  if (!sessionValue || sessionValue.battle_state.outcome.end_reason === null) {
    return null;
  }

  const { winner_ship_instance_id: winnerShipId, end_reason: endReason } = sessionValue.battle_state.outcome;
  const winnerLabel = winnerShipId ? capitalizeLabel(formatShipContactLabel(sessionValue, identityValue, winnerShipId)) : "No winner";
  const playerWon =
    identityValue?.role === "player" &&
    identityValue.ship_instance_id !== null &&
    identityValue.ship_instance_id === winnerShipId;
  const playerLost =
    identityValue?.role === "player" &&
    identityValue.ship_instance_id !== null &&
    winnerShipId !== null &&
    identityValue.ship_instance_id !== winnerShipId;
  const reasonLabel =
    endReason === "destroyed" ? "Kill confirmed. The duel ended in destruction." : "Boundary disengage ended the duel.";

  if (playerWon) {
    return {
      tone: "victory",
      headline: "Victory",
      detail: `You hold the field. ${reasonLabel}`,
      reset_hint: "Host can reset the match to start a new duel."
    };
  }

  if (playerLost) {
    return {
      tone: "defeat",
      headline: "Defeat",
      detail: `${winnerLabel} wins. ${reasonLabel}`,
      reset_hint: "Host can reset the match to start a new duel."
    };
  }

  return {
    tone: "neutral",
    headline: winnerShipId ? `${winnerLabel} wins` : "Match ended",
    detail: reasonLabel,
    reset_hint: "Host can reset the match to start a new duel."
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
    return "contact destroyed";
  }

  if (opponentShip?.status === "disengaged") {
    return "contact withdrew";
  }

  const opponentConnectionState = getSlotConnectionState(sessionValue, opponent.slot_id);

  if (opponentConnectionState === "reconnecting") {
    return "contact reconnecting";
  }

  if (opponentConnectionState === "open") {
    return "contact seat open";
  }

  if (sessionValue.pending_plot_ship_ids.includes(opponent.ship_instance_id)) {
    return "contact ready";
  }

  return "contact plotting";
}

function getPhaseLabel(
  sessionValue: MatchSessionView | null,
  selectedSystemContext: ReturnType<typeof getSelectedSystemContext>
): string {
  if (!sessionValue) {
    return "CONNECTING";
  }

  if (isMatchEnded(sessionValue)) {
    return "MATCH ENDED";
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

  if (isMatchEnded(sessionValue)) {
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
  const camera = getTacticalCamera(session, session.battle_state, plotPreview, displayed.ship.ship_instance_id);

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

  const pointerWorld = tacticalViewportToWorld(context.camera, pointer);

  if (activeTacticalDrag.handle_id === "thrust") {
    const shipAnchor = worldToTacticalViewport(context.camera, context.displayed.ship.pose.position);
    const delta = {
      x: pointer.x - shipAnchor.x,
      y: pointer.y - shipAnchor.y
    };
    const distance = Math.hypot(delta.x, delta.y);
    const scale = distance <= TACTICAL_PLOT_HANDLES.deadzonePx ? 0 : Math.min(1, distance / TACTICAL_PLOT_HANDLES.thrustRadiusPx);
    const worldDelta = {
      x: pointerWorld.x - context.displayed.ship.pose.position.x,
      y: pointerWorld.y - context.displayed.ship.pose.position.y
    };
    const worldDistance = Math.hypot(worldDelta.x, worldDelta.y);
    const direction = worldDistance > 0 ? { x: worldDelta.x / worldDistance, y: worldDelta.y / worldDistance } : { x: 0, y: 0 };

    updatePlotDraft((draft) =>
      setPlotDraftWorldThrust(context.sessionValue.battle_state, draft, {
        x: direction.x * scale,
        y: direction.y * scale
      })
    );

    return;
  }

  const delta = {
    x: pointerWorld.x - context.plotPreview.projected_pose.position.x,
    y: pointerWorld.y - context.plotPreview.projected_pose.position.y
  };
  const distance = Math.hypot(delta.x, delta.y) / context.camera.world_units_per_px;

  if (distance <= TACTICAL_PLOT_HANDLES.deadzonePx) {
    return;
  }

  const desiredHeadingDegrees = normalizeDegrees((Math.atan2(delta.x, delta.y) * 180) / Math.PI);

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
window.addEventListener("keydown", handleGlobalKeydown);

function getRectangleBoundary(sessionValue: MatchSessionView): RectangleBoundary | null {
  const boundary = sessionValue.battle_state.match_setup.battlefield.boundary;

  return boundary.kind === "rectangle" ? boundary : null;
}

function getTacticalCamera(
  sessionValue: MatchSessionView | null,
  battleStateValue: BattleState | null,
  plotPreview: PlotPreview | null,
  preferredShipInstanceId: ShipInstanceId | null
): TacticalCamera | null {
  if (!sessionValue || !battleStateValue) {
    return null;
  }

  const boundary = getRectangleBoundary(sessionValue);

  if (!boundary) {
    return null;
  }

  return buildTacticalCamera({
    state: battleStateValue,
    boundary,
    viewport: TACTICAL_VIEWPORT,
    selection: tacticalCameraSelection,
    preferred_ship_instance_id: preferredShipInstanceId,
    plot_preview: plotPreview
  });
}
function clearSelectedSystem(): void {
  if (selectedSystemId === null) {
    return;
  }

  selectedSystemId = null;
  render();
}

function resetCurrentPlotDraft(): void {
  if (!session || !identity || identity.role !== "player" || !identity.ship_instance_id) {
    return;
  }

  plotDraft = createPlotDraft(session.battle_state, identity.ship_instance_id);
  render();
}

function submitCurrentPlot(): void {
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
}

function shouldIgnoreGlobalHotkeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, select, textarea, button, [contenteditable='true']"));
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat || activeTacticalDrag) {
    return;
  }

  if (shouldIgnoreGlobalHotkeys(event.target)) {
    return;
  }

  if (event.key === "Escape") {
    if (selectedSystemId !== null) {
      event.preventDefault();
      clearSelectedSystem();
    }
    return;
  }

  if (!identity || identity.role !== "player" || isMatchEnded(session)) {
    return;
  }

  if (event.code === "KeyR") {
    event.preventDefault();
    resetCurrentPlotDraft();
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    submitCurrentPlot();
  }
}

function getReadoutStripPresentation(plotSummary: PlotDraftSummary | null): {
  turn_label: string;
  drive_label: string;
  railgun_label: string;
} | null {
  if (!plotSummary) {
    return null;
  }

  return {
    turn_label: `${formatSignedNumber(plotSummary.draft.heading_delta_degrees)}°`,
    drive_label: `${plotSummary.power.drive_pips}`,
    railgun_label: `${plotSummary.power.railgun_pips}`
  };
}

function getFooterStripPresentation(sessionValue: MatchSessionView | null, playbackEvent: ResolverEvent | null): {
  current_resolution_label: string;
  current_resolution_meta_label: string;
  current_resolution_progress_ratio: number | null;
  combat_feed_items: Array<{
    step_label: string;
    summary: string;
    is_active: boolean;
  }>;
  empty_combat_feed_label: string;
  link_status_label: string;
  bridge_message: string;
  show_host_tools: boolean;
  is_host_tools_open: boolean;
} {
  const playbackStep = getCurrentResolutionPlaybackStepForSession(sessionValue);
  const currentResolutionLabel =
    sessionValue && playbackEvent
      ? formatResolutionEventSummary(sessionValue, identity, playbackEvent)
      : sessionValue && playbackStep
        ? `Replaying turn ${sessionValue.last_resolution?.resolved_from_turn_number ?? "?"}`
      : sessionValue?.last_resolution
        ? `Turn ${sessionValue.last_resolution.resolved_from_turn_number} resolved`
        : "No turn resolved yet";
  const combatFeedItems = sessionValue?.last_resolution
    ? getRecentResolutionEvents(sessionValue).map((event) => ({
        step_label: `T${getResolutionEventDisplaySubTick(sessionValue, event).toString().padStart(2, "0")}`,
        summary: formatResolutionEventSummary(sessionValue, identity, event),
        is_active: playbackEvent === event
      }))
    : [];

  return {
    current_resolution_label: currentResolutionLabel,
    current_resolution_meta_label: getResolutionPlaybackMetaLabel(sessionValue, playbackStep),
    current_resolution_progress_ratio: playbackStep?.progress_ratio ?? null,
    combat_feed_items: combatFeedItems,
    empty_combat_feed_label:
      sessionValue?.last_resolution
        ? playbackStep
          ? "No weapon contacts. Movement replay only."
        : "No weapon contacts in the last exchange."
        : "Awaiting first exchange.",
    link_status_label: formatLinkStatusLabel(wsState),
    bridge_message: formatBridgeMessage(messages[0], identity),
    show_host_tools: hasLocalHostResetAccess(),
    is_host_tools_open: hostToolsOpen
  };
}

function getActionStripPresentation(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null,
  plotSummary: PlotDraftSummary | null,
  outcomePresentation: MatchOutcomePresentation | null
):
  | {
      kind: "waiting";
      note: string;
    }
  | {
      kind: "spectator";
      note: string;
      claim_actions: { slot_id: string; label: string }[];
    }
  | {
      kind: "ended";
      headline: string;
    }
  | {
      kind: "player";
      status_label: string;
      claim_actions: { slot_id: string; label: string }[];
    } {
  const claimActions = getClaimableSlotStates(sessionValue, identityValue).map((slotState) => ({
    slot_id: slotState.slot_id,
    label: getClaimSeatLabel(sessionValue, slotState.slot_id)
  }));

  if (!identityValue || identityValue.role !== "player") {
    return {
      kind: "spectator",
      note:
        claimActions.length > 0
          ? "Claim an open bridge seat to take command of a ship."
          : "All bridge seats are occupied. Additional sessions join as spectators.",
      claim_actions: claimActions
    };
  }

  if (isMatchEnded(sessionValue)) {
    return {
      kind: "ended",
      headline: outcomePresentation?.headline ?? "Match ended"
    };
  }

  if (!sessionValue || !plotSummary) {
    return {
      kind: "waiting",
      note: "Waiting for a playable ship and battle snapshot before enabling plot authoring."
    };
  }

  const isPending = sessionValue.pending_plot_ship_ids.includes(plotSummary.context.ship_instance_id);
  const playbackStep = getCurrentResolutionPlaybackStepForSession(sessionValue);
  const replaySuffix =
    sessionValue?.last_resolution && playbackStep
      ? ` · replaying turn ${sessionValue.last_resolution.resolved_from_turn_number}`
      : "";

  return {
    kind: "player",
    status_label: `Turn ${plotSummary.context.turn_number} · ${
      isPending ? "Plot submitted" : "Plot in progress"
    }${replaySuffix}`,
    claim_actions: claimActions
  };
}

function render(): void {
  const sessionValue = session;
  const displayed = getDisplayedShipContext(sessionValue, identity);
  const plotSummary = getPlayerPlotSummary(sessionValue, identity);
  const selectedSystemContext = getSelectedSystemContext(sessionValue, identity);
  const plotPreview = sessionValue && plotSummary ? buildPlotPreview(sessionValue.battle_state, plotSummary.draft) : null;
  const playbackStep = getCurrentResolutionPlaybackStepForSession(sessionValue);
  const tacticalBattleState =
    sessionValue && playbackStep
      ? applyResolutionPlaybackStepToBattleState(sessionValue.battle_state, playbackStep)
      : sessionValue?.battle_state ?? null;
  const camera = getTacticalCamera(
    sessionValue,
    sessionValue?.battle_state ?? null,
    plotPreview,
    displayed?.ship.ship_instance_id ?? null
  );
  const playbackEvent = playbackStep?.focus_event ?? null;
  const outcomePresentation = getMatchOutcomePresentation(sessionValue, identity);
  const focusedMountId = selectedSystemContext?.system.type === "weapon_mount" ? selectedSystemContext.system.id : null;
  const tacticalViewport = !sessionValue
    ? "<p>Waiting for the session snapshot before rendering the tactical board.</p>"
    : !camera
      ? "<p>The current battlefield boundary is not yet supported by the tactical viewport.</p>"
      : renderTacticalBoard({
          sessionValue,
          battleStateValue: tacticalBattleState ?? sessionValue.battle_state,
          identityValue: identity,
          plotSummary,
          plotPreview,
          focusedMountId,
          camera,
          playbackStep,
          playbackEvent
        });
  const schematicViewport = renderSchematicPanel({
    sessionValue,
    identityValue: identity,
    displayed,
    plotSummary,
    selectedSystemContext,
    plotPreview,
    playbackEvent,
    selectedSystemId,
    outcomePresentation,
    getContactLabel: (shipInstanceId) =>
      sessionValue ? getPlayerFacingContactLabel(sessionValue, identity, shipInstanceId) : "none"
  });
  const readoutStrip = renderReadoutStrip(getReadoutStripPresentation(plotSummary));
  const actionStripControls = renderActionStripControls(
    getActionStripPresentation(sessionValue, identity, plotSummary, outcomePresentation)
  );
  const outcomeBanner = renderMatchOutcomeBanner(outcomePresentation);
  const footerStrip = renderFooterStrip(getFooterStripPresentation(sessionValue, playbackEvent));
  const phaseLabel = getPhaseLabel(sessionValue, selectedSystemContext);
  const cameraMode = camera ? getTacticalCameraModeDefinition(camera.selection.mode_id) : null;
  const tacticalTitle = cameraMode?.id === "player_centered" ? "Ship Relative Scope" : cameraMode?.label ?? "Shared sensor plot";
  const tacticalHint =
    selectedSystemContext?.system.type === "weapon_mount"
      ? "Click contact to lock. Click again to clear."
      : sessionValue?.last_resolution && playbackStep
        ? `Resolution replay running · drag burn and heading to plot turn ${sessionValue.battle_state.turn_number}.`
        : "Drag burn and heading on the plot.";
  const stationLabel = getBridgeStationLabel(identity, displayed?.shipConfig.name ?? null);
  const situationalStatus =
    identity?.role === "player" ? capitalizeLabel(getOpponentStatusLabel(sessionValue, identity)) : "Spectator view";
  const linkStatusLabel = formatLinkStatusLabel(wsState);
  const cameraControls = SHOW_TACTICAL_ZOOM_CONTROLS
    ? renderTacticalCameraControls(
        TACTICAL_ZOOM_PRESETS.map((preset) => ({
          id: preset.id,
          short_label: preset.short_label,
          active: tacticalCameraSelection.zoom_preset_id === preset.id
        }))
      )
    : "";

  root.innerHTML = renderBridgeShell({
    phase_label: phaseLabel,
    turn_label: `Turn ${sessionValue?.battle_state.turn_number ?? "..."}`,
    station_label: stationLabel,
    situational_status: situationalStatus,
    link_status_label: linkStatusLabel,
    is_link_ok: wsState === "connected",
    is_aim_mode: selectedSystemContext?.system.type === "weapon_mount",
    schematic_viewport: schematicViewport,
    tactical_title: tacticalTitle,
    tactical_hint: tacticalHint,
    camera_controls: cameraControls,
    tactical_viewport: tacticalViewport,
    outcome_banner: outcomeBanner,
    readout_strip: readoutStrip,
    action_strip_controls: actionStripControls,
    footer_strip: footerStrip
  });

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
    clearSelectedSystem();
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
      const currentWeapon = plotSummary?.draft.weapons.find((weapon) => weapon.mount_id === selectedMountId);

      if (!sessionValue || !targetShipId || !selectedMountId) {
        return;
      }

      updatePlotDraft((draft) =>
        currentWeapon?.target_ship_instance_id === targetShipId
          ? clearPlotDraftWeaponIntent(sessionValue.battle_state, draft, selectedMountId)
          : setPlotDraftWeaponTarget(sessionValue.battle_state, draft, selectedMountId, targetShipId)
      );
    });
  });

  document.querySelector<HTMLButtonElement>("[data-clear-aim-target]")?.addEventListener("click", (event) => {
    const target = event.currentTarget as HTMLButtonElement;
    const mountId = target.dataset.clearAimTarget;

    if (!sessionValue || !mountId) {
      return;
    }

    updatePlotDraft((draft) => clearPlotDraftWeaponIntent(sessionValue.battle_state, draft, mountId));
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
    resetCurrentPlotDraft();
  });

  document.querySelector<HTMLButtonElement>("[data-reset-session]")?.addEventListener("click", () => {
    void requestSessionReset();
  });

  document.querySelector<HTMLDetailsElement>("[data-host-tools]")?.addEventListener("toggle", (event) => {
    hostToolsOpen = (event.currentTarget as HTMLDetailsElement).open;
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
    submitCurrentPlot();
  });
}

async function loadHealth(): Promise<void> {
  const response = await fetch("/api/health");
  health = (await response.json()) as HealthResponse;
  render();
}

async function requestSessionReset(): Promise<void> {
  if (!window.confirm("Reset the current match? This clears both crews' plots and the battle state.")) {
    return;
  }

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

  hostToolsOpen = false;
  writeStoredValue(ADMIN_TOKEN_STORAGE_KEY, adminToken);
  logMessage(`session reset requested · turn ${payload.turnNumber ?? "?"}`);
  render();
}

function handleServerMessage(message: ServerToClientMessage): void {
  if (message.type === "hello") {
    const previousBattleState = session?.battle_state ?? null;
    identity = message.identity;
    session = message.session;
    writeStoredValue(RECONNECT_TOKEN_STORAGE_KEY, message.identity.reconnect_token);
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    syncResolutionPlayback(session, previousBattleState);
    logMessage(
      `hello received · ${message.identity.role}${message.identity.slot_id ? ` · ${message.identity.slot_id}` : ""}`
    );
    render();
    return;
  }

  if (message.type === "session_reset") {
    plotDraft = null;
    selectedSystemId = null;
    hostToolsOpen = false;
    lastPresentedResolutionKey = null;
    writeStoredValue(LAST_PRESENTED_RESOLUTION_KEY_STORAGE_KEY, null);
    clearResolutionPlayback();
    logMessage(`session reset · ${message.matchId} · turn ${message.turnNumber}`);
    render();
    return;
  }

  if (message.type === "session_state") {
    const previousBattleState = session?.battle_state ?? null;
    session = message.session;
    syncResolutionPlayback(session, previousBattleState);
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
