import type { BattleState, PlotSubmission, ShipInstanceId } from "../../contracts.js";
import { resolveImpact } from "../combat.js";
import { sampleUnitInterval } from "../determinism.js";
import type { ResolverEvent } from "../types.js";
import type { SensingSnapshot } from "../types.js";

export interface EventsPhaseInput {
  state: BattleState;
  plotsByShip: Record<ShipInstanceId, PlotSubmission>;
  sensing: SensingSnapshot;
  seed: string;
  subTick: number;
}

export interface EventsPhaseOutput {
  state: BattleState;
  events: ResolverEvent[];
}

export function runEventsPhase(input: EventsPhaseInput): EventsPhaseOutput {
  void input.plotsByShip;
  const events: ResolverEvent[] = [];
  const subsystemDamageRatio = input.state.match_setup.rules.damage.local_hit_resolution.subsystem_damage_ratio;

  for (const reading of input.sensing.weapon_readings) {
    events.push({
      sub_tick: input.subTick,
      type: "weapon_fired",
      actor: reading.actor_ship_id,
      target: reading.target_ship_id,
      details: {
        mountId: reading.mount_id,
        mountPosition: reading.mount_position,
        targetPosition: reading.target_position,
        chargePips: reading.effective_charge_pips,
        hitProbability: reading.hit_probability,
        baseDamage: reading.base_damage
      }
    });

    const hitRoll = sampleUnitInterval(
      input.seed,
      input.subTick,
      reading.actor_ship_id,
      reading.target_ship_id,
      reading.mount_id
    );

    if (hitRoll > reading.hit_probability) {
      continue;
    }

    const target = input.state.ships[reading.target_ship_id];

    if (!target) {
      continue;
    }

    const impact = resolveImpact(input.state, target, reading.mount_position);

    events.push({
      sub_tick: input.subTick,
      type: "hit_registered",
      target: reading.target_ship_id,
      details:
        impact.impact_system_id !== undefined
          ? {
              fromActor: reading.actor_ship_id,
              impactPoint: impact.impact_point,
              impactSystemId: impact.impact_system_id,
              hullDamageApplied: reading.base_damage,
              subsystemDamageApplied: reading.base_damage * subsystemDamageRatio
            }
          : {
              fromActor: reading.actor_ship_id,
              impactPoint: impact.impact_point,
              hullDamageApplied: reading.base_damage
            }
    });
  }

  return {
    state: input.state,
    events
  };
}
