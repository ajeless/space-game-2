import type { BattleState, PlotSubmission, ShipInstanceId } from "../../contracts.js";

export interface SensingPhaseInput {
  state: BattleState;
  plotsByShip: Record<ShipInstanceId, PlotSubmission>;
  subTick: number;
}

export function runSensingPhase(input: SensingPhaseInput): BattleState {
  void input.plotsByShip;
  void input.subTick;

  return input.state;
}
