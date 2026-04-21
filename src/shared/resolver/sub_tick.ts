import { runDynamicsPhase } from "./phases/dynamics.js";
import { runEventsPhase } from "./phases/events.js";
import { runIntentPhase } from "./phases/intent.js";
import { runLoggingPhase } from "./phases/logging.js";
import { runSensingPhase } from "./phases/sensing.js";
import { runStateUpdatesPhase } from "./phases/state_updates.js";
import type { ResolverContext, ResolverEvent, SubTickResult } from "./types.js";

export function runSubTick(context: ResolverContext, subTick: number): SubTickResult {
  const intentEvents = runIntentPhase(context, subTick);
  const dynamicsOutput = runDynamicsPhase({
    state: context.next_state,
    plotsByShip: context.plots_by_ship,
    sortedShipIds: context.sorted_ship_ids,
    subTick
  });
  let state = dynamicsOutput.state;

  state = runSensingPhase({
    state,
    plotsByShip: context.plots_by_ship,
    subTick
  });

  const eventsPhaseOutput = runEventsPhase({
    state,
    plotsByShip: context.plots_by_ship,
    subTick
  });

  state = runStateUpdatesPhase({
    state: eventsPhaseOutput.state,
    plotsByShip: context.plots_by_ship,
    events: eventsPhaseOutput.events,
    subTick
  });

  const newEvents: ResolverEvent[] = [...intentEvents, ...dynamicsOutput.events, ...eventsPhaseOutput.events];

  return {
    state,
    events: runLoggingPhase(newEvents)
  };
}
