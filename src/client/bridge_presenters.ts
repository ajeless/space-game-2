import {
  getShipConfig,
  getSystemStateAndEffects,
  type MatchSessionView,
  type PlotDraftSummary,
  type ResolverEvent,
  type SessionIdentity,
  type ShipConfig,
  type ShipInstanceId,
  type ShipRuntimeState,
  type ShipSystemConfig,
  type SystemId
} from "../shared/index.js";
import { isResolutionFocusEvent, type ResolutionPlaybackStep } from "./resolution_playback.js";

export type LinkState = "connecting" | "connected" | "closed" | "error";

export type DisplayedShipContext = {
  participant: MatchSessionView["battle_state"]["match_setup"]["participants"][number];
  ship: ShipRuntimeState;
  shipConfig: ShipConfig;
};

export type MatchOutcomePresentation = {
  tone: "victory" | "defeat" | "neutral";
  headline: string;
  detail: string;
  reset_hint: string;
};

export type ActionStripPresentation =
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
      controls_locked: boolean;
    };

export type FooterStripPresentation = {
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
};

export function capitalizeLabel(label: string): string {
  if (label.length === 0) {
    return label;
  }

  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function formatLinkStatusLabel(state: LinkState): string {
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

export function getBridgeStationLabel(
  identityValue: SessionIdentity | null,
  shipName: string | null
): string {
  if (!identityValue) {
    return "Awaiting bridge assignment";
  }

  if (identityValue.role === "player") {
    return shipName ? `Aboard ${shipName}` : "Player station";
  }

  return shipName ? `Observer view · ${shipName}` : "Observer view";
}

export function formatBridgeMessage(
  message: string | undefined,
  identityValue: SessionIdentity | null
): string {
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

function getRecentResolutionEvents(sessionValue: MatchSessionView | null): ResolverEvent[] {
  return (
    sessionValue?.last_resolution?.events
      .filter((event) => isResolutionFocusEvent(event) && event.type !== "turn_ended")
      .slice(-4)
      .reverse() ?? []
  );
}

function getShipSlotLabel(
  sessionValue: MatchSessionView,
  shipInstanceId: ShipInstanceId | null
): string {
  if (!shipInstanceId) {
    return "NONE";
  }

  const participant = sessionValue.battle_state.match_setup.participants.find(
    (candidate) => candidate.ship_instance_id === shipInstanceId
  );

  return participant ? participant.slot_id.toUpperCase() : shipInstanceId;
}

export function getPlayerFacingContactLabel(
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

export function formatResolutionEventSummary(
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

export function getResolutionEventDisplaySubTick(
  sessionValue: MatchSessionView,
  event: ResolverEvent
): number {
  const totalSubTicks = sessionValue.battle_state.match_setup.rules.turn.sub_ticks;

  if (event.type === "turn_ended") {
    return totalSubTicks;
  }

  return Math.min(totalSubTicks, event.sub_tick + 1);
}

export function getResolutionPlaybackMetaLabel(
  sessionValue: MatchSessionView | null,
  playbackStep: ResolutionPlaybackStep | null
): string {
  if (!sessionValue?.last_resolution || !playbackStep) {
    return sessionValue?.last_resolution
      ? `Turn ${sessionValue.last_resolution.resolved_from_turn_number} replay complete`
      : "Awaiting first exchange.";
  }

  if (playbackStep.kind === "preroll") {
    return `Replay turn ${sessionValue.last_resolution.resolved_from_turn_number} · resolving committed plots`;
  }

  if (playbackStep.kind === "settle") {
    return `Replay turn ${sessionValue.last_resolution.resolved_from_turn_number} · settling back onto the plot`;
  }

  if (playbackStep.focus_event && playbackStep.focus_event_index !== null) {
    if (playbackStep.exchange_event_count > 1 && playbackStep.exchange_event_index !== null) {
      return `Replay turn ${sessionValue.last_resolution.resolved_from_turn_number} · exchange T${playbackStep.display_sub_tick
        .toString()
        .padStart(2, "0")} · ${playbackStep.exchange_event_index + 1} of ${playbackStep.exchange_event_count}`;
    }

    return `Replay turn ${sessionValue.last_resolution.resolved_from_turn_number} · event ${
      playbackStep.focus_event_index + 1
    } of ${playbackStep.focus_event_count}`;
  }

  return `Replay turn ${sessionValue.last_resolution.resolved_from_turn_number} · motion ${playbackStep.display_sub_tick} of ${playbackStep.total_sub_ticks}`;
}

export function getDisplayedShipContext(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null
): DisplayedShipContext | null {
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

  const participant = sessionValue.battle_state.match_setup.participants.find(
    (candidate) => candidate.slot_id === slotId
  );

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

export function isMatchEnded(sessionValue: MatchSessionView | null): boolean {
  return sessionValue?.battle_state.outcome.end_reason !== null;
}

export function getMatchOutcomePresentation(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null
): MatchOutcomePresentation | null {
  if (!sessionValue || sessionValue.battle_state.outcome.end_reason === null) {
    return null;
  }

  const { winner_ship_instance_id: winnerShipId, end_reason: endReason } = sessionValue.battle_state.outcome;
  const winnerLabel = winnerShipId
    ? capitalizeLabel(formatShipContactLabel(sessionValue, identityValue, winnerShipId))
    : "No winner";
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

export function getOpponentStatusLabel(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null
): string {
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

export function getPhaseLabel(
  sessionValue: MatchSessionView | null,
  isAimMode: boolean
): string {
  if (!sessionValue) {
    return "CONNECTING";
  }

  if (isMatchEnded(sessionValue)) {
    return "MATCH ENDED";
  }

  if (isAimMode) {
    return "AIM MODE";
  }

  return "PLOT PHASE";
}

function formatSignedNumber(value: number, digits = 0): string {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

export function getReadoutStripPresentation(plotSummary: PlotDraftSummary | null): {
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

export function getFooterStripPresentation(input: {
  sessionValue: MatchSessionView | null;
  playbackStep: ResolutionPlaybackStep | null;
  playbackEvent: ResolverEvent | null;
  identityValue: SessionIdentity | null;
  wsState: LinkState;
  latestMessage: string | undefined;
  showHostTools: boolean;
  hostToolsOpen: boolean;
}): FooterStripPresentation {
  const {
    sessionValue,
    playbackStep,
    playbackEvent,
    identityValue,
    wsState,
    latestMessage,
    showHostTools,
    hostToolsOpen
  } = input;
  const currentResolutionLabel =
    sessionValue && playbackStep?.kind === "preroll"
      ? "Resolving committed plots"
      : sessionValue && playbackStep?.kind === "settle"
        ? "Replay settling back to plot"
      : sessionValue && playbackEvent
        ? formatResolutionEventSummary(sessionValue, identityValue, playbackEvent)
        : sessionValue && playbackStep
          ? `Replaying turn ${sessionValue.last_resolution?.resolved_from_turn_number ?? "?"}`
          : sessionValue?.last_resolution
            ? `Turn ${sessionValue.last_resolution.resolved_from_turn_number} replay complete`
            : "No turn resolved yet";
  const combatFeedItems = sessionValue?.last_resolution
    ? getRecentResolutionEvents(sessionValue).map((event) => ({
        step_label: `T${getResolutionEventDisplaySubTick(sessionValue, event).toString().padStart(2, "0")}`,
        summary: formatResolutionEventSummary(sessionValue, identityValue, event),
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
    bridge_message: formatBridgeMessage(latestMessage, identityValue),
    show_host_tools: showHostTools,
    is_host_tools_open: hostToolsOpen
  };
}

export function getActionStripPresentation(input: {
  sessionValue: MatchSessionView | null;
  identityValue: SessionIdentity | null;
  plotSummary: PlotDraftSummary | null;
  outcomePresentation: MatchOutcomePresentation | null;
  playbackStep: ResolutionPlaybackStep | null;
  plotLocked: boolean;
}): ActionStripPresentation {
  const { sessionValue, identityValue, plotSummary, outcomePresentation, playbackStep, plotLocked } = input;
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
  const replaySuffix =
    sessionValue.last_resolution && playbackStep?.kind === "preroll"
      ? ` · resolving turn ${sessionValue.last_resolution.resolved_from_turn_number}`
      : sessionValue.last_resolution && playbackStep
        ? ` · replaying turn ${sessionValue.last_resolution.resolved_from_turn_number}`
        : "";

  return {
    kind: "player",
    status_label: `Turn ${plotSummary.context.turn_number} · ${
      isPending ? "Plot submitted" : "Plot in progress"
    }${replaySuffix}`,
    claim_actions: claimActions,
    controls_locked: plotLocked
  };
}

export function getSelectedSystemPresentation(
  sessionValue: MatchSessionView | null,
  displayed: DisplayedShipContext | null,
  selectedSystemId: SystemId | null
):
  | {
      ship: ShipRuntimeState;
      system: ShipSystemConfig;
      integrity_percent: number;
      state_label: ReturnType<typeof getSystemStateAndEffects>["state_label"];
      effects: ReturnType<typeof getSystemStateAndEffects>["effects"];
    }
  | null {
  if (!sessionValue || !displayed || !selectedSystemId) {
    return null;
  }

  const system = displayed.shipConfig.systems.find((candidate) => candidate.id === selectedSystemId);
  const runtimeSystem = displayed.ship.systems[selectedSystemId];

  if (!system || !runtimeSystem) {
    return null;
  }

  const stateAndEffects = getSystemStateAndEffects(sessionValue.battle_state, displayed.ship, system.id);

  return {
    ship: displayed.ship,
    system,
    integrity_percent: (runtimeSystem.current_integrity / system.max_integrity) * 100,
    state_label: stateAndEffects.state_label,
    effects: stateAndEffects.effects
  };
}
