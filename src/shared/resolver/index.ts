// Resolver entry point: validates inputs, runs every sub-tick, appends the turn_ended event, and returns the next state.
// Depends on: shared validation, planned_shots, sub_tick runner, and resolver types. Consumed by: src/server/session.ts and tests.
// Invariant: resolve() never mutates its input; the returned next_state is a fresh structured clone.

import type { BattleState, PlotSubmission, ShipInstanceId } from "../contracts.js";
import { validateBattleState, validatePlotSubmission } from "../validation.js";
import { buildPlannedShots } from "./planned_shots.js";
import { runSubTick } from "./sub_tick.js";
import type { ResolveTurnInput, ResolveTurnOutput, ResolverEvent, TurnEndedEvent } from "./types.js";

function cloneBattleState(state: BattleState): BattleState {
  return structuredClone(state);
}

function getRequiredPlotShipIds(state: BattleState): ShipInstanceId[] {
  return state.match_setup.participants
    .map((participant) => participant.ship_instance_id)
    .filter((shipId) => {
      const ship = state.ships[shipId];
      return ship?.status === "active";
    })
    .sort();
}

function validatePlotsByShip(
  state: BattleState,
  plotsByShip: Record<ShipInstanceId, PlotSubmission>
): Record<ShipInstanceId, PlotSubmission> {
  const expectedShipIds = getRequiredPlotShipIds(state);
  const incomingShipIds = Object.keys(plotsByShip).sort();

  for (const shipId of expectedShipIds) {
    if (!incomingShipIds.includes(shipId)) {
      throw new Error(`Resolver missing plot for active ship '${shipId}'`);
    }
  }

  for (const shipId of incomingShipIds) {
    if (!expectedShipIds.includes(shipId)) {
      throw new Error(`Resolver received unexpected plot for ship '${shipId}'`);
    }
  }

  const validatedPlots: Record<ShipInstanceId, PlotSubmission> = {};

  for (const shipId of expectedShipIds) {
    const plot = plotsByShip[shipId];

    if (!plot) {
      throw new Error(`Resolver missing plot payload for ship '${shipId}'`);
    }

    validatedPlots[shipId] = validatePlotSubmission(plot, state);
  }

  return validatedPlots;
}

function makeTurnEndedEvent(state: BattleState): TurnEndedEvent {
  return {
    sub_tick: state.match_setup.rules.turn.sub_ticks,
    type: "turn_ended",
    details: {
      turnNumber: state.turn_number,
      winner: state.outcome.winner_ship_instance_id
    }
  };
}

function hydrateTerminalEventFinalPositions(state: BattleState, events: ResolverEvent[]): void {
  for (const event of events) {
    if ((event.type !== "ship_destroyed" && event.type !== "ship_disengaged") || !event.target) {
      continue;
    }

    const ship = state.ships[event.target];

    if (!ship) {
      continue;
    }

    event.details.finalPosition = { ...ship.pose.position };
  }
}

export function resolve(input: ResolveTurnInput): ResolveTurnOutput {
  const validatedState = validateBattleState(input.state);
  const validatedPlots = validatePlotsByShip(validatedState, input.plots_by_ship);
  const nextState = cloneBattleState(validatedState);
  const sortedShipIds = Object.keys(validatedPlots).sort();
  const plannedShots = buildPlannedShots(validatedState, validatedPlots, sortedShipIds);
  const context = {
    current_state: validatedState,
    next_state: nextState,
    plots_by_ship: validatedPlots,
    sorted_ship_ids: sortedShipIds,
    planned_shots: plannedShots,
    seed: input.seed
  };
  const events = [];

  for (let subTick = 0; subTick < nextState.match_setup.rules.turn.sub_ticks; subTick += 1) {
    const subTickResult = runSubTick(context, subTick);

    context.next_state = subTickResult.state;
    events.push(...subTickResult.events);
  }

  hydrateTerminalEventFinalPositions(context.next_state, events);
  context.next_state.turn_number += 1;
  events.push(makeTurnEndedEvent(context.next_state));

  return {
    next_state: context.next_state,
    events
  };
}

export * from "./types.js";
