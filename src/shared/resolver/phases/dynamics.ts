import type { BattleState, PlotSubmission, ShipInstanceId, ShipRuntimeState, Vector2 } from "../../contracts.js";
import type { ResolverEvent, ThrustAppliedEvent } from "../types.js";
import { advanceShipDynamics } from "../motion.js";

export interface DynamicsPhaseInput {
  state: BattleState;
  plotsByShip: Record<ShipInstanceId, PlotSubmission>;
  sortedShipIds: ShipInstanceId[];
  subTick: number;
}

export interface DynamicsPhaseOutput {
  state: BattleState;
  events: ResolverEvent[];
}

function makeThrustAppliedEvent(subTick: number, ship: ShipRuntimeState, appliedThrust: Vector2): ThrustAppliedEvent {
  return {
    sub_tick: subTick,
    type: "thrust_applied",
    actor: ship.ship_instance_id,
    details: {
      thrustVector: appliedThrust,
      resultingVelocity: { ...ship.pose.velocity },
      resultingPosition: { ...ship.pose.position },
      resultingHeadingDegrees: ship.pose.heading_degrees
    }
  };
}

export function runDynamicsPhase(input: DynamicsPhaseInput): DynamicsPhaseOutput {
  const { state, plotsByShip, sortedShipIds, subTick } = input;
  const events: ResolverEvent[] = [];

  for (const shipId of sortedShipIds) {
    const ship = state.ships[shipId];
    const plot = plotsByShip[shipId];

    if (!ship || !plot || ship.status !== "active") {
      continue;
    }

    const { applied_thrust: appliedThrust } = advanceShipDynamics(state, ship, plot, subTick);

    if (appliedThrust.x !== 0 || appliedThrust.y !== 0) {
      events.push(makeThrustAppliedEvent(subTick, ship, appliedThrust));
    }
  }

  return {
    state,
    events
  };
}
