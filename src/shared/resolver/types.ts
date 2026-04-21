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

export interface ResolverContext {
  current_state: BattleState;
  next_state: BattleState;
  plots_by_ship: Record<ShipInstanceId, PlotSubmission>;
  sorted_ship_ids: ShipInstanceId[];
  seed: string;
}

export interface SubTickResult {
  state: BattleState;
  events: ResolverEvent[];
}
