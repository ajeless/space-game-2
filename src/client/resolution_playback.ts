import type {
  BattleState,
  MatchSessionView,
  ResolverEvent,
  ShipInstanceId,
  ThrustAppliedEvent
} from "../shared/index.js";

const MOTION_STEP_DURATION_MS = 84;
const EVENT_STEP_DURATION_MS = 840;
const CAMERA_SETTLE_STEP_DURATION_MS = 160;
const CAMERA_SETTLE_STEP_COUNT = 6;
const FINAL_STEP_DURATION_MS = 2200;

type ShipPoseMap = Record<
  ShipInstanceId,
  BattleState["ships"][ShipInstanceId]["pose"]
>;

export type ResolutionPlaybackStep = {
  kind: "motion" | "event" | "settle";
  duration_ms: number;
  display_sub_tick: number;
  total_sub_ticks: number;
  ship_poses: ShipPoseMap;
  focus_event: ResolverEvent | null;
  focus_event_index: number | null;
  focus_event_count: number;
  camera_transition_ratio: number;
  progress_ratio: number;
};

export type ResolutionPlaybackState = {
  key: string;
  resolved_from_turn_number: number;
  current_step_index: number;
  steps: ResolutionPlaybackStep[];
};

function cloneShipPoses(state: BattleState): ShipPoseMap {
  return Object.fromEntries(
    Object.values(state.ships).map((ship) => [ship.ship_instance_id, structuredClone(ship.pose)])
  ) as ShipPoseMap;
}

function cloneShipPoseMap(value: ShipPoseMap): ShipPoseMap {
  return Object.fromEntries(
    Object.entries(value).map(([shipId, pose]) => [shipId, structuredClone(pose)])
  ) as ShipPoseMap;
}

function isThrustAppliedEvent(event: ResolverEvent): event is ThrustAppliedEvent {
  return event.type === "thrust_applied" && Boolean(event.actor);
}

export function isResolutionFocusEvent(event: ResolverEvent): boolean {
  return (
    event.type === "weapon_fired" ||
    event.type === "hit_registered" ||
    event.type === "subsystem_damaged" ||
    event.type === "ship_destroyed" ||
    event.type === "ship_disengaged" ||
    event.type === "turn_ended"
  );
}

export function getResolutionKey(sessionValue: MatchSessionView | null): string | null {
  if (!sessionValue?.last_resolution) {
    return null;
  }

  return `${sessionValue.battle_state.match_setup.match_id}:${sessionValue.last_resolution.resolved_from_turn_number}:${sessionValue.last_resolution.event_count}`;
}

function getDisplaySubTick(event: ResolverEvent, totalSubTicks: number): number {
  if (event.type === "turn_ended") {
    return totalSubTicks;
  }

  return Math.min(totalSubTicks, event.sub_tick + 1);
}

export function buildResolutionPlaybackState(input: {
  sessionValue: MatchSessionView | null;
  previousBattleState: BattleState | null;
}): ResolutionPlaybackState | null {
  const { sessionValue, previousBattleState } = input;
  const key = getResolutionKey(sessionValue);

  if (!key || !sessionValue?.last_resolution || !previousBattleState) {
    return null;
  }

  if (previousBattleState.match_setup.match_id !== sessionValue.battle_state.match_setup.match_id) {
    return null;
  }

  if (previousBattleState.turn_number !== sessionValue.last_resolution.resolved_from_turn_number) {
    return null;
  }

  const totalSubTicks = sessionValue.battle_state.match_setup.rules.turn.sub_ticks;
  const thrustEventsBySubTick = new Map<number, ThrustAppliedEvent[]>();

  for (const event of sessionValue.last_resolution.events) {
    if (!isThrustAppliedEvent(event)) {
      continue;
    }

    const eventsAtTick = thrustEventsBySubTick.get(event.sub_tick) ?? [];
    eventsAtTick.push(event);
    thrustEventsBySubTick.set(event.sub_tick, eventsAtTick);
  }

  const shipPosesByFrame: ShipPoseMap[] = [cloneShipPoses(previousBattleState)];

  for (let subTick = 0; subTick < totalSubTicks; subTick += 1) {
    const nextPoses = cloneShipPoseMap(shipPosesByFrame[subTick] ?? shipPosesByFrame.at(-1) ?? cloneShipPoses(previousBattleState));

    for (const event of thrustEventsBySubTick.get(subTick) ?? []) {
      if (!event.actor) {
        continue;
      }

      nextPoses[event.actor] = {
        position: structuredClone(event.details.resultingPosition),
        velocity: structuredClone(event.details.resultingVelocity),
        heading_degrees: event.details.resultingHeadingDegrees
      };
    }

    shipPosesByFrame.push(nextPoses);
  }

  const focusEvents = sessionValue.last_resolution.events.filter(isResolutionFocusEvent);
  const focusEventsByDisplaySubTick = new Map<number, ResolverEvent[]>();

  for (const event of focusEvents) {
    const displaySubTick = getDisplaySubTick(event, totalSubTicks);
    const eventsAtStep = focusEventsByDisplaySubTick.get(displaySubTick) ?? [];
    eventsAtStep.push(event);
    focusEventsByDisplaySubTick.set(displaySubTick, eventsAtStep);
  }

  const steps: ResolutionPlaybackStep[] = [
    {
      kind: "motion",
      duration_ms: MOTION_STEP_DURATION_MS,
      display_sub_tick: 0,
      total_sub_ticks: totalSubTicks,
      ship_poses: shipPosesByFrame[0] ?? cloneShipPoses(previousBattleState),
      focus_event: null,
      focus_event_index: null,
      focus_event_count: focusEvents.length,
      camera_transition_ratio: 0,
      progress_ratio: 0
    }
  ];
  let focusEventIndex = 0;
  const deferredFinalEvents: ResolverEvent[] = [];

  for (let displaySubTick = 1; displaySubTick <= totalSubTicks; displaySubTick += 1) {
    const focusEventsAtStep = focusEventsByDisplaySubTick.get(displaySubTick) ?? [];
    const deferredTurnEndedEvents =
      displaySubTick === totalSubTicks
        ? focusEventsAtStep.filter((event) => event.type === "turn_ended")
        : [];
    const immediateFocusEvents =
      displaySubTick === totalSubTicks
        ? focusEventsAtStep.filter((event) => event.type !== "turn_ended")
        : focusEventsAtStep;

    steps.push({
      kind: "motion",
      duration_ms:
        displaySubTick === totalSubTicks &&
        immediateFocusEvents.length === 0 &&
        deferredTurnEndedEvents.length === 0
          ? FINAL_STEP_DURATION_MS
          : MOTION_STEP_DURATION_MS,
      display_sub_tick: displaySubTick,
      total_sub_ticks: totalSubTicks,
      ship_poses:
        shipPosesByFrame[displaySubTick] ?? shipPosesByFrame.at(-1) ?? cloneShipPoses(previousBattleState),
      focus_event: null,
      focus_event_index: null,
      focus_event_count: focusEvents.length,
      camera_transition_ratio: 0,
      progress_ratio: displaySubTick / totalSubTicks
    });

    for (const event of immediateFocusEvents) {
      const isFinalEvent = displaySubTick === totalSubTicks && focusEventIndex === focusEvents.length - 1;

      steps.push({
        kind: "event",
        duration_ms: isFinalEvent ? FINAL_STEP_DURATION_MS : EVENT_STEP_DURATION_MS,
        display_sub_tick: displaySubTick,
        total_sub_ticks: totalSubTicks,
        ship_poses:
          shipPosesByFrame[displaySubTick] ?? shipPosesByFrame.at(-1) ?? cloneShipPoses(previousBattleState),
        focus_event: event,
        focus_event_index: focusEventIndex,
        focus_event_count: focusEvents.length,
        camera_transition_ratio: 0,
        progress_ratio: displaySubTick / totalSubTicks
      });
      focusEventIndex += 1;
    }

    deferredFinalEvents.push(...deferredTurnEndedEvents);
  }

  const finalShipPoses =
    shipPosesByFrame.at(-1) ?? shipPosesByFrame[totalSubTicks] ?? cloneShipPoses(previousBattleState);

  for (let settleIndex = 0; settleIndex < CAMERA_SETTLE_STEP_COUNT; settleIndex += 1) {
    steps.push({
      kind: "settle",
      duration_ms: CAMERA_SETTLE_STEP_DURATION_MS,
      display_sub_tick: totalSubTicks,
      total_sub_ticks: totalSubTicks,
      ship_poses: cloneShipPoseMap(finalShipPoses),
      focus_event: null,
      focus_event_index: null,
      focus_event_count: focusEvents.length,
      camera_transition_ratio: (settleIndex + 1) / CAMERA_SETTLE_STEP_COUNT,
      progress_ratio: 1
    });
  }

  for (const event of deferredFinalEvents) {
    const isFinalEvent = focusEventIndex === focusEvents.length - 1;

    steps.push({
      kind: "event",
      duration_ms: isFinalEvent ? FINAL_STEP_DURATION_MS : EVENT_STEP_DURATION_MS,
      display_sub_tick: totalSubTicks,
      total_sub_ticks: totalSubTicks,
      ship_poses: cloneShipPoseMap(finalShipPoses),
      focus_event: event,
      focus_event_index: focusEventIndex,
      focus_event_count: focusEvents.length,
      camera_transition_ratio: 1,
      progress_ratio: 1
    });
    focusEventIndex += 1;
  }

  const progressDenominator = Math.max(1, steps.length - 1);
  const finalizedSteps = steps.map((step, index) => ({
    ...step,
    progress_ratio: index / progressDenominator
  }));

  return {
    key,
    resolved_from_turn_number: sessionValue.last_resolution.resolved_from_turn_number,
    current_step_index: 0,
    steps: finalizedSteps
  };
}

export function getCurrentResolutionPlaybackStep(
  playbackState: ResolutionPlaybackState | null,
  sessionValue: MatchSessionView | null
): ResolutionPlaybackStep | null {
  if (!playbackState || playbackState.key !== getResolutionKey(sessionValue)) {
    return null;
  }

  return playbackState.steps[playbackState.current_step_index] ?? null;
}

export function applyResolutionPlaybackStepToBattleState(
  state: BattleState,
  playbackStep: ResolutionPlaybackStep | null
): BattleState {
  if (!playbackStep) {
    return state;
  }

  const nextState = structuredClone(state);

  for (const [shipId, pose] of Object.entries(playbackStep.ship_poses)) {
    if (!nextState.ships[shipId]) {
      continue;
    }

    nextState.ships[shipId].pose = structuredClone(pose);
  }

  return nextState;
}
