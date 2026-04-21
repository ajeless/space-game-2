import type { BattleState, PlotSubmission, ShipInstanceId } from "../../contracts.js";

export interface DynamicsPhaseInput {
  state: BattleState;
  plotsByShip: Record<ShipInstanceId, PlotSubmission>;
  subTick: number;
}

export function runDynamicsPhase(input: DynamicsPhaseInput): BattleState {
  void input.plotsByShip;
  void input.subTick;

  return input.state;
}
