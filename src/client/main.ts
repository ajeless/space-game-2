// Browser entry point: owns client state, renders the bridge shell, and wires network and input.
// Depends on: every other file in src/client/ plus shared contracts. Consumed by: Vite bundler via index.html.
// Invariant: every state change that should be visible must be followed by render() before the handler returns.

import "./style.css";
import {
  renderActionStripControls,
  renderBridgeShell,
  renderFooterStrip,
  renderMatchOutcomeBanner,
  renderReadoutStrip,
  renderTacticalCameraControls
} from "./bridge_shell_view.js";
import { connectBridgeWebSocket, type BridgeConnection } from "./bridge_connection.js";
import { createGlobalHotkeyHandler } from "./bridge_hotkeys.js";
import {
  applyResolutionPlaybackStepToBattleState,
  buildResolutionPlaybackState,
  getCurrentResolutionPlaybackStep,
  getResolutionKey,
  type ResolutionPlaybackState,
  type ResolutionPlaybackStep
} from "./resolution_playback.js";
import {
  ADMIN_TOKEN_STORAGE_KEY,
  getStoredResolutionPlaybackSource,
  LAST_COMPLETED_RESOLUTION_KEY_STORAGE_KEY,
  RECONNECT_TOKEN_STORAGE_KEY,
  writeStoredResolutionPlaybackSource,
  readStoredValue,
  writeStoredValue
} from "./bridge_storage.js";
import {
  bindRenderedBridgeControls,
  type TacticalDragHandleId
} from "./bridge_dom_bindings.js";
import {
  getPlotLockState,
  isPlotInteractionLocked,
  reconcileOptimisticSubmittedPlot,
  type BridgeLinkState,
  type OptimisticSubmittedPlot,
  type PlotLockState
} from "./bridge_plot_lock.js";
import {
  capitalizeLabel,
  formatLinkStatusLabel,
  getActionStripPresentation,
  getBridgeStationLabel,
  getDisplayedShipContext,
  getFooterStripPresentation,
  getMatchOutcomePresentation,
  getOpponentStatusLabel,
  getPhaseLabel,
  getPlayerFacingContactLabel,
  getReadoutStripPresentation,
  getSelectedSystemPresentation,
  isMatchEnded
} from "./bridge_presenters.js";
import { renderSchematicPanel } from "./schematic_view.js";
import { TACTICAL_VIEWPORT, SHOW_TACTICAL_ZOOM_CONTROLS } from "./bridge_ui_config.js";
import {
  getDraggedHeadingDegrees,
  getResolutionPlaybackCamera,
  getSvgViewportPoint,
  getThrustDragWorldVector
} from "./tactical_math.js";
import { renderTacticalBoard } from "./tactical_view.js";
import {
  buildPlotPreview,
  buildTacticalCamera,
  buildPlotSubmissionFromDraft,
  createPlotDraft,
  createDefaultTacticalCameraSelection,
  getTacticalCameraModeDefinition,
  setPlotDraftDesiredEndHeading,
  setPlotDraftWorldThrust,
  summarizePlotDraft,
  TACTICAL_ZOOM_PRESETS,
  tacticalViewportToWorld,
  worldToTacticalViewport
} from "../shared/index.js";
import type { MatchSessionView, ServerToClientMessage, SessionIdentity } from "../shared/index.js";
import type {
  BattleState,
  BattleBoundary,
  PlotDraft,
  PlotDraftSummary,
  PlotPreview,
  ShipInstanceId,
  SystemId,
  TacticalCamera,
  TacticalCameraSelection,
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

let health: HealthResponse | null = null;
let wsState: BridgeLinkState = "connecting";
let identity: SessionIdentity | null = null;
let session: MatchSessionView | null = null;
let connection: BridgeConnection | null = null;
let plotDraft: PlotDraft | null = null;
let selectedSystemId: SystemId | null = null;
let tacticalCameraSelection: TacticalCameraSelection = createDefaultTacticalCameraSelection();
const messages: string[] = [];
type ActiveTacticalDrag = {
  handle_id: TacticalDragHandleId;
  pointer_id: number;
};
let activeTacticalDrag: ActiveTacticalDrag | null = null;
let resolutionPlayback: ResolutionPlaybackState | null = null;
let resolutionPlaybackTimer: number | null = null;
let lastCompletedResolutionKey: string | null = readStoredValue(LAST_COMPLETED_RESOLUTION_KEY_STORAGE_KEY);
let hostToolsOpen = false;
let optimisticSubmittedPlot: OptimisticSubmittedPlot | null = null;

function logMessage(message: string): void {
  messages.unshift(message);
  messages.splice(8);
}

type RectangleBoundary = Extract<BattleBoundary, { kind: "rectangle" }>;

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

function clearOptimisticSubmittedPlot(): void {
  optimisticSubmittedPlot = null;
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
      lastCompletedResolutionKey = resolutionPlayback.key;
      writeStoredValue(LAST_COMPLETED_RESOLUTION_KEY_STORAGE_KEY, resolutionPlayback.key);
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
      lastCompletedResolutionKey = null;
      writeStoredValue(LAST_COMPLETED_RESOLUTION_KEY_STORAGE_KEY, null);
      writeStoredResolutionPlaybackSource(null, null);
    }

    clearResolutionPlayback();
    return;
  }

  const isPreviousBattleStateUsable =
    previousBattleState?.match_setup.match_id === sessionValue.battle_state.match_setup.match_id &&
    previousBattleState.turn_number === sessionValue.last_resolution.resolved_from_turn_number;

  if (isPreviousBattleStateUsable && previousBattleState) {
    writeStoredResolutionPlaybackSource(key, previousBattleState);
  }

  if (resolutionPlayback?.key === key || lastCompletedResolutionKey === key) {
    return;
  }

  const nextPlayback = buildResolutionPlaybackState({
    sessionValue,
    previousBattleState: isPreviousBattleStateUsable && previousBattleState ? previousBattleState : getStoredResolutionPlaybackSource(key)
  });

  if (!nextPlayback) {
    clearResolutionPlayback();
    return;
  }

  resolutionPlayback = nextPlayback;
  queueResolutionPlaybackAdvance();
}

function getCurrentResolutionPlaybackStepForSession(
  sessionValue: MatchSessionView | null
): ResolutionPlaybackStep | null {
  return getCurrentResolutionPlaybackStep(resolutionPlayback, sessionValue);
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

function getCurrentPlotLockState(
  sessionValue: MatchSessionView | null = session,
  identityValue: SessionIdentity | null = identity,
  playbackStep: ResolutionPlaybackStep | null = getCurrentResolutionPlaybackStepForSession(sessionValue),
  linkState: BridgeLinkState = wsState
): PlotLockState | null {
  return getPlotLockState({
    sessionValue,
    identityValue,
    playbackStep,
    linkState,
    optimisticSubmittedPlot
  });
}

function getCurrentPlotInteractionLocked(
  sessionValue: MatchSessionView | null = session,
  identityValue: SessionIdentity | null = identity,
  playbackStep: ResolutionPlaybackStep | null = getCurrentResolutionPlaybackStepForSession(sessionValue),
  linkState: BridgeLinkState = wsState
): boolean {
  return isPlotInteractionLocked({
    sessionValue,
    identityValue,
    playbackStep,
    linkState,
    optimisticSubmittedPlot
  });
}

function getTacticalPointerPoint(clientX: number, clientY: number): Vector2 | null {
  const svg = root.querySelector<SVGSVGElement>("[data-tactical-viewport]");

  if (!svg) {
    return null;
  }

  return getSvgViewportPoint(svg.getBoundingClientRect(), clientX, clientY);
}

function getSelectedSystemContext(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null
): ReturnType<typeof getSelectedSystemPresentation> {
  if (!sessionValue || !selectedSystemId) {
    return null;
  }

  const displayed = getDisplayedShipContext(sessionValue, identityValue);

  if (!displayed) {
    selectedSystemId = null;
    return null;
  }

  const presentation = getSelectedSystemPresentation(sessionValue, displayed, selectedSystemId);

  if (!presentation) {
    selectedSystemId = null;
    return null;
  }

  return presentation;
}

function updatePlotDraft(mutator: (draft: PlotDraft) => PlotDraft): void {
  if (!session) {
    return;
  }

  if (getCurrentPlotInteractionLocked(session, identity)) {
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

  if (getCurrentPlotInteractionLocked(session, identity)) {
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
    const thrustVector = getThrustDragWorldVector({
      shipAnchor,
      shipPosition: context.displayed.ship.pose.position,
      pointer,
      pointerWorld
    });

    updatePlotDraft((draft) =>
      setPlotDraftWorldThrust(context.sessionValue.battle_state, draft, thrustVector)
    );

    return;
  }

  const desiredHeadingDegrees = getDraggedHeadingDegrees({
    pointerWorld,
    projectedPosition: context.plotPreview.projected_pose.position,
    worldUnitsPerPx: context.camera.world_units_per_px
  });

  if (desiredHeadingDegrees === null) {
    return;
  }

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
window.addEventListener(
  "keydown",
  createGlobalHotkeyHandler({
    hasActiveTacticalDrag: () => activeTacticalDrag !== null,
    hasSelectedSystem: () => selectedSystemId !== null,
    canSubmitPlot: () =>
      identity !== null &&
      identity.role === "player" &&
      !isMatchEnded(session) &&
      !getCurrentPlotInteractionLocked(session, identity),
    onClearSelectedSystem: clearSelectedSystem,
    onResetPlotDraft: resetCurrentPlotDraft,
    onSubmitPlot: submitCurrentPlot
  })
);

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

  if (getCurrentPlotInteractionLocked(session, identity)) {
    return;
  }

  plotDraft = createPlotDraft(session.battle_state, identity.ship_instance_id);
  render();
}

function submitCurrentPlot(): void {
  if (!connection || !connection.isOpen() || !session) {
    return;
  }

  if (getCurrentPlotInteractionLocked(session, identity)) {
    return;
  }

  try {
    const summary = getPlayerPlotSummary(session, identity);

    if (!summary) {
      throw new Error("No playable ship is assigned to this client");
    }

    const plot = buildPlotSubmissionFromDraft(session.battle_state, summary.draft);

    connection.send({
      type: "submit_plot",
      plot
    });
    optimisticSubmittedPlot = {
      ship_instance_id: plot.ship_instance_id,
      turn_number: plot.turn_number
    };
    logMessage(`submitted direct plot for ${plot.ship_instance_id} on turn ${plot.turn_number}`);
    render();
  } catch (error) {
    logMessage(error instanceof Error ? error.message : "failed to build plot");
    render();
  }
}

function toggleSelectedSystem(systemId: SystemId): void {
  if (getCurrentPlotInteractionLocked(session, identity)) {
    return;
  }

  selectedSystemId = selectedSystemId === systemId ? null : systemId;
  render();
}

function render(): void {
  const sessionValue = session;
  const playbackStep = getCurrentResolutionPlaybackStepForSession(sessionValue);

  optimisticSubmittedPlot = reconcileOptimisticSubmittedPlot({
    optimisticSubmittedPlot,
    sessionValue,
    identityValue: identity,
    playbackStep
  });

  const plotLockState = getCurrentPlotLockState(sessionValue, identity, playbackStep, wsState);
  const displayed = getDisplayedShipContext(sessionValue, identity);
  const plotSummary = getPlayerPlotSummary(sessionValue, identity);
  const selectedSystemContext = getSelectedSystemContext(sessionValue, identity);
  const isAimMode = !plotLockState && selectedSystemContext?.system.type === "weapon_mount";
  const plotPreview = sessionValue && plotSummary ? buildPlotPreview(sessionValue.battle_state, plotSummary.draft) : null;
  const tacticalBattleState =
    sessionValue && playbackStep
      ? applyResolutionPlaybackStepToBattleState(sessionValue.battle_state, playbackStep)
      : sessionValue?.battle_state ?? null;
  const baseCamera = getTacticalCamera(
    sessionValue,
    sessionValue?.battle_state ?? null,
    plotPreview,
    displayed?.ship.ship_instance_id ?? null
  );
  const camera = getResolutionPlaybackCamera({
    camera: baseCamera,
    playbackState: resolutionPlayback,
    playbackStep,
    preferredShipInstanceId: displayed?.ship.ship_instance_id ?? null
  });
  const playbackEvent = playbackStep?.focus_event ?? null;
  const outcomePresentation = getMatchOutcomePresentation(sessionValue, identity);
  const focusedMountId = isAimMode ? selectedSystemContext.system.id : null;
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
          plotLocked: plotLockState !== null,
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
    plotLockState,
    playbackEvent,
    selectedSystemId,
    outcomePresentation,
    getContactLabel: (shipInstanceId) =>
      sessionValue ? getPlayerFacingContactLabel(sessionValue, identity, shipInstanceId) : "none"
  });
  const readoutStrip = renderReadoutStrip(getReadoutStripPresentation(plotSummary));
  const actionStripControls = renderActionStripControls(
    getActionStripPresentation({
      sessionValue,
      identityValue: identity,
      plotSummary,
      outcomePresentation,
      playbackStep,
      plotLocked: plotLockState !== null,
      wsState
    })
  );
  const outcomeBanner = renderMatchOutcomeBanner(outcomePresentation);
  const footerStrip = renderFooterStrip(
    getFooterStripPresentation({
      sessionValue,
      playbackStep,
      playbackEvent,
      identityValue: identity,
      wsState,
      latestMessage: messages[0],
      showHostTools: hasLocalHostResetAccess(),
      hostToolsOpen
    })
  );
  const phaseLabel = getPhaseLabel(sessionValue, isAimMode);
  const cameraMode = camera ? getTacticalCameraModeDefinition(camera.selection.mode_id) : null;
  const tacticalTitle = cameraMode?.id === "player_centered" ? "Ship Relative Scope" : cameraMode?.label ?? "Shared sensor plot";
  const tacticalHint =
    isAimMode
      ? "Click contact to lock. Click again to clear."
      : plotLockState?.reason === "link"
        ? "Bridge link down. Plot controls pause until the host session reconnects."
      : plotLockState?.reason === "submitted"
        ? "Orders committed. Plotting stays locked until the replay for this exchange finishes."
      : sessionValue?.last_resolution && playbackStep?.kind === "preroll"
        ? `Turn ${sessionValue.last_resolution.resolved_from_turn_number} resolved on the host. Scope cueing replay while you plot turn ${sessionValue.battle_state.turn_number}.`
      : sessionValue?.last_resolution && playbackStep
        ? "Resolution replay running. Plot controls unlock when the replay finishes."
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
    is_aim_mode: isAimMode,
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

  bindRenderedBridgeControls({
    root,
    sessionValue,
    plotSummary,
    selectedMountId: focusedMountId,
    onUpdatePlotDraft: updatePlotDraft,
    onToggleSystemSelection: toggleSelectedSystem,
    onClearSystemSelection: clearSelectedSystem,
    onStartTacticalDrag: (handleId, pointerId, clientX, clientY) => {
      if (getCurrentPlotInteractionLocked(session, identity)) {
        return;
      }

      activeTacticalDrag = {
        handle_id: handleId,
        pointer_id: pointerId
      };
      document.body.classList.add("is-plot-dragging");
      applyTacticalDrag(clientX, clientY);
    },
    onSetCameraZoom: (zoomPresetId) => {
      tacticalCameraSelection = {
        ...tacticalCameraSelection,
        zoom_preset_id: zoomPresetId
      };
      render();
    },
    onResetPlot: resetCurrentPlotDraft,
    onResetSession: requestSessionReset,
    onSetHostToolsOpen: (isOpen) => {
      hostToolsOpen = isOpen;
    },
    onClaimSlot: (slotId) => {
      if (!connection || !connection.isOpen()) {
        return;
      }

      connection.send({
        type: "claim_slot",
        slot_id: slotId
      });
      logMessage(`claim requested · ${slotId}`);
      render();
    },
    onSubmitPlot: submitCurrentPlot
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
    connection?.cancelPendingReconnect();
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
    clearOptimisticSubmittedPlot();
    lastCompletedResolutionKey = null;
    writeStoredValue(LAST_COMPLETED_RESOLUTION_KEY_STORAGE_KEY, null);
    writeStoredResolutionPlaybackSource(null, null);
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
    clearOptimisticSubmittedPlot();
    logMessage(message.message);
    render();
  }
}

render();
void loadHealth();
connection = connectBridgeWebSocket({
  getReconnectToken: () => readStoredValue(RECONNECT_TOKEN_STORAGE_KEY),
  onLinkStateChange: (state) => {
    wsState = state;
    render();
  },
  onServerMessage: handleServerMessage,
  onLogMessage: logMessage
});
