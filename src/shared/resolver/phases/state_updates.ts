import type { BattleState, PlotSubmission, ShipInstanceId } from "../../contracts.js";
import type { ResolverEvent } from "../types.js";

export interface StateUpdatesPhaseInput {
  state: BattleState;
  plotsByShip: Record<ShipInstanceId, PlotSubmission>;
  events: ResolverEvent[];
  subTick: number;
}

export function runStateUpdatesPhase(input: StateUpdatesPhaseInput): BattleState {
  void input.plotsByShip;
  void input.events;
  void input.subTick;

  return input.state;
}
