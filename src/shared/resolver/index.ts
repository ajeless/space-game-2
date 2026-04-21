import type { BattleState, PlotSubmission, ShipInstanceId } from "../contracts.js";
import { validateBattleState, validatePlotSubmission } from "../validation.js";
import { runSubTick } from "./sub_tick.js";
import type { ResolveTurnInput, ResolveTurnOutput, TurnEndedEvent } from "./types.js";

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

export function resolve(input: ResolveTurnInput): ResolveTurnOutput {
  const validatedState = validateBattleState(input.state);
  const validatedPlots = validatePlotsByShip(validatedState, input.plots_by_ship);
  const nextState = cloneBattleState(validatedState);
  const sortedShipIds = Object.keys(validatedPlots).sort();
  const context = {
    current_state: validatedState,
    next_state: nextState,
    plots_by_ship: validatedPlots,
    sorted_ship_ids: sortedShipIds,
    seed: input.seed
  };
  const events = [];

  for (let subTick = 0; subTick < nextState.match_setup.rules.turn.sub_ticks; subTick += 1) {
    const subTickResult = runSubTick(context, subTick);

    context.next_state = subTickResult.state;
    events.push(...subTickResult.events);
  }

  context.next_state.turn_number += 1;
  events.push(makeTurnEndedEvent(context.next_state));

  return {
    next_state: context.next_state,
    events
  };
}

export * from "./types.js";
