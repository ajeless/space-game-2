// Resolver-facing type declarations: ResolverEvent union, sub-tick snapshots, planned-shot descriptors, and phase I/O shapes.
// Depends on: shared contracts. Consumed by: resolver/index.ts, resolver/sub_tick.ts, every phase module, and network.ts.
// Invariant: adding or renaming a ResolverEvent variant is a wire-breaking change — network.ts re-exports it.

import type { BattleState, PlotSubmission, ShipInstanceId, SystemId, Vector2 } from "../contracts.js";

export interface ResolverEventBase<TType extends string, TDetails> {
  sub_tick: number;
  type: TType;
  actor?: ShipInstanceId;
  target?: ShipInstanceId;
  details: TDetails;
}

export type PlotCommittedEvent = ResolverEventBase<
  "plot_committed",
  {
    plot: PlotSubmission;
  }
>;

export type ThrustAppliedEvent = ResolverEventBase<
  "thrust_applied",
  {
    thrustVector: Vector2;
    resultingVelocity: Vector2;
    resultingPosition: Vector2;
    resultingHeadingDegrees: number;
  }
>;

export type WeaponFiredEvent = ResolverEventBase<
  "weapon_fired",
  {
    mountId: SystemId;
    mountPosition: Vector2;
    targetPosition: Vector2;
    chargePips: number;
    hitProbability: number;
    baseDamage: number;
  }
>;

export type HitRegisteredEvent = ResolverEventBase<
  "hit_registered",
  {
    fromActor: ShipInstanceId;
    impactPoint: Vector2;
    impactSystemId?: SystemId;
    hullDamageApplied: number;
    subsystemDamageApplied?: number;
  }
>;

export type SubsystemDamagedEvent = ResolverEventBase<
  "subsystem_damaged",
  {
    systemId: SystemId;
    previousState: "operational" | "degraded" | "offline";
    newState: "operational" | "degraded" | "offline";
    previousIntegrity: number;
    newIntegrity: number;
  }
>;

export type ShipDestroyedEvent = ResolverEventBase<
  "ship_destroyed",
  {
    causeActor: ShipInstanceId;
    finalPosition: Vector2;
  }
>;

export type ShipDisengagedEvent = ResolverEventBase<
  "ship_disengaged",
  {
    finalPosition: Vector2;
  }
>;

export type TurnEndedEvent = ResolverEventBase<
  "turn_ended",
  {
    turnNumber: number;
    winner: ShipInstanceId | null;
  }
>;

export type ResolverEvent =
  | PlotCommittedEvent
  | ThrustAppliedEvent
  | WeaponFiredEvent
  | HitRegisteredEvent
  | SubsystemDamagedEvent
  | ShipDestroyedEvent
  | ShipDisengagedEvent
  | TurnEndedEvent;

export interface ResolveTurnInput {
  state: BattleState;
  plots_by_ship: Record<ShipInstanceId, PlotSubmission>;
  seed: string;
}

export interface ResolveTurnOutput {
  next_state: BattleState;
  events: ResolverEvent[];
}

export interface PlannedWeaponShot {
  actor_ship_id: ShipInstanceId;
  target_ship_id: ShipInstanceId;
  mount_id: SystemId;
  fire_sub_tick: number;
  predicted_bearing_sweep_degrees: number;
  predicted_hit_probability: number;
}

export interface SensedWeaponReading {
  actor_ship_id: ShipInstanceId;
  target_ship_id: ShipInstanceId;
  mount_id: SystemId;
  sub_tick: number;
  effective_charge_pips: number;
  base_damage: number;
  hit_probability: number;
  mount_position: Vector2;
  target_position: Vector2;
}

export interface SensingSnapshot {
  weapon_readings: SensedWeaponReading[];
}

export interface ResolverContext {
  current_state: BattleState;
  next_state: BattleState;
  plots_by_ship: Record<ShipInstanceId, PlotSubmission>;
  sorted_ship_ids: ShipInstanceId[];
  planned_shots: Record<string, PlannedWeaponShot>;
  seed: string;
}

export interface SubTickResult {
  state: BattleState;
  events: ResolverEvent[];
}
