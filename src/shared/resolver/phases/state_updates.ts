import type { BattleState, PlotSubmission, ShipInstanceId } from "../../contracts.js";
import { getSubsystemStateLabel } from "../combat.js";
import type { ResolverEvent } from "../types.js";

export interface StateUpdatesPhaseInput {
  state: BattleState;
  plotsByShip: Record<ShipInstanceId, PlotSubmission>;
  events: ResolverEvent[];
  subTick: number;
}

export interface StateUpdatesPhaseOutput {
  state: BattleState;
  events: ResolverEvent[];
}

export function runStateUpdatesPhase(input: StateUpdatesPhaseInput): StateUpdatesPhaseOutput {
  void input.plotsByShip;
  void input.subTick;
  const consequenceEvents: ResolverEvent[] = [];
  const destructionThreshold = input.state.match_setup.rules.victory.hull_destroyed_at_or_below;
  const destroyedBy = new Map<ShipInstanceId, ShipInstanceId>();

  for (const event of input.events) {
    if (event.type !== "hit_registered" || !event.target) {
      continue;
    }

    const targetShip = input.state.ships[event.target];

    if (!targetShip) {
      continue;
    }

    const previousHullIntegrity = targetShip.hull.current_integrity;
    targetShip.hull.current_integrity = Math.max(0, previousHullIntegrity - event.details.hullDamageApplied);

    if (
      !destroyedBy.has(targetShip.ship_instance_id) &&
      previousHullIntegrity > destructionThreshold &&
      targetShip.hull.current_integrity <= destructionThreshold
    ) {
      destroyedBy.set(targetShip.ship_instance_id, event.details.fromActor);
    }

    if (event.details.impactSystemId && event.details.subsystemDamageApplied !== undefined) {
      const runtimeSystem = targetShip.systems[event.details.impactSystemId];

      if (!runtimeSystem) {
        continue;
      }

      const previousIntegrity = runtimeSystem.current_integrity;
      const previousState = getSubsystemStateLabel(input.state, targetShip, event.details.impactSystemId);
      runtimeSystem.current_integrity = Math.max(0, previousIntegrity - event.details.subsystemDamageApplied);
      const newState = getSubsystemStateLabel(input.state, targetShip, event.details.impactSystemId);

      if (previousState !== newState) {
        consequenceEvents.push({
          sub_tick: input.subTick,
          type: "subsystem_damaged",
          actor: targetShip.ship_instance_id,
          details: {
            systemId: event.details.impactSystemId,
            previousState,
            newState,
            previousIntegrity,
            newIntegrity: runtimeSystem.current_integrity
          }
        });
      }
    }
  }

  for (const targetShipId of [...destroyedBy.keys()].sort()) {
    const targetShip = input.state.ships[targetShipId];

    if (!targetShip || targetShip.status === "destroyed") {
      continue;
    }

    targetShip.status = "destroyed";
    consequenceEvents.push({
      sub_tick: input.subTick,
      type: "ship_destroyed",
      target: targetShip.ship_instance_id,
      details: {
        causeActor: destroyedBy.get(targetShipId)!,
        finalPosition: { ...targetShip.pose.position }
      }
    });
  }

  if (destroyedBy.size > 0) {
    const activeShipIds = input.state.match_setup.participants
      .map((participant) => participant.ship_instance_id)
      .filter((shipId) => input.state.ships[shipId]?.status === "active");

    input.state.outcome.end_reason = "destroyed";
    input.state.outcome.winner_ship_instance_id = activeShipIds.length === 1 ? activeShipIds[0]! : null;
  }

  return {
    state: input.state,
    events: consequenceEvents
  };
}
