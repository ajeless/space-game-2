import type { BattleState, PlotSubmission, ShipInstanceId } from "../../contracts.js";
import type { ResolverEvent } from "../types.js";

export interface EventsPhaseInput {
  state: BattleState;
  plotsByShip: Record<ShipInstanceId, PlotSubmission>;
  subTick: number;
}

export interface EventsPhaseOutput {
  state: BattleState;
  events: ResolverEvent[];
}

export function runEventsPhase(input: EventsPhaseInput): EventsPhaseOutput {
  void input.plotsByShip;
  void input.subTick;

  return {
    state: input.state,
    events: []
  };
}
