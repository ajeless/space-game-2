// Sensing phase: for each planned weapon shot, evaluates the sub-tick opportunity and builds the events-phase snapshot.
// Depends on: resolver combat and shared planned-shot types. Consumed by: resolver/sub_tick.ts.

import type { BattleState, PlotSubmission, ShipInstanceId } from "../../contracts.js";
import { evaluateWeaponOpportunity } from "../combat.js";
import type { PlannedWeaponShot, SensingSnapshot } from "../types.js";

export interface SensingPhaseInput {
  state: BattleState;
  plotsByShip: Record<ShipInstanceId, PlotSubmission>;
  plannedShots: Record<string, PlannedWeaponShot>;
  subTick: number;
}

export interface SensingPhaseOutput {
  state: BattleState;
  snapshot: SensingSnapshot;
}

function comparePlannedShots(left: PlannedWeaponShot, right: PlannedWeaponShot): number {
  return (
    left.actor_ship_id.localeCompare(right.actor_ship_id) ||
    left.mount_id.localeCompare(right.mount_id) ||
    left.target_ship_id.localeCompare(right.target_ship_id)
  );
}

export function runSensingPhase(input: SensingPhaseInput): SensingPhaseOutput {
  const readings: SensingSnapshot["weapon_readings"] = [];

  for (const plannedShot of Object.values(input.plannedShots).sort(comparePlannedShots)) {
    if (plannedShot.fire_sub_tick !== input.subTick) {
      continue;
    }

    const shooter = input.state.ships[plannedShot.actor_ship_id];
    const target = input.state.ships[plannedShot.target_ship_id];
    const plot = input.plotsByShip[plannedShot.actor_ship_id];

    if (!shooter || !target || !plot || shooter.status !== "active" || target.status !== "active") {
      continue;
    }

    const weapon = plot.weapons.find((candidate) => candidate.mount_id === plannedShot.mount_id);

    if (!weapon) {
      continue;
    }

    const opportunity = evaluateWeaponOpportunity(
      input.state,
      shooter,
      target,
      plannedShot.mount_id,
      weapon.charge_pips,
      plannedShot.predicted_bearing_sweep_degrees
    );

    if (!opportunity) {
      continue;
    }

    readings.push({
      actor_ship_id: plannedShot.actor_ship_id,
      target_ship_id: plannedShot.target_ship_id,
      mount_id: plannedShot.mount_id,
      sub_tick: input.subTick,
      effective_charge_pips: opportunity.effective_charge_pips,
      base_damage: opportunity.base_damage,
      hit_probability: opportunity.hit_probability,
      mount_position: opportunity.mount_position,
      target_position: opportunity.target_position
    });
  }

  return {
    state: input.state,
    snapshot: {
      weapon_readings: readings
    }
  };
}
