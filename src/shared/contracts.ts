// Canonical type contracts for the battle state, ship configs, plot submissions, and resolver events.
// Depends on: nothing. Consumed by: every other file in src/shared/ plus both client and server.
// Invariant: any change to these shapes must also update validation.ts and the schema version.

export const SCHEMA_VERSION = "sg2/v0.1" as const;

export type SchemaVersion = typeof SCHEMA_VERSION;
export type ShipConfigId = string;
export type ShipInstanceId = string;
export type SystemId = string;
export type SlotId = string;
export type ShipStatus = "active" | "destroyed" | "disengaged";
export type SubsystemState = "operational" | "degraded" | "offline";

export type Vector2 = {
  x: number;
  y: number;
};

export type HitProfile =
  | { shape: "circle"; radius: number }
  | { shape: "ellipse"; radius_x: number; radius_y: number }
  | { shape: "polygon"; points: Vector2[] };

export type SystemEffectValues = Record<string, number | boolean | string>;

export interface MatchRulesConfig {
  schema_version: SchemaVersion;
  id: string;
  name: string;
  turn: {
    sub_ticks: number;
    duration_seconds: number;
  };
  fire_control: {
    timing_policy: "best_legal_shot";
    tie_break: "earliest";
  };
  hit_probability: {
    min_probability: number;
    max_probability: number;
    range_factor: {
      max_factor: number;
      min_factor: number;
      slope: number;
    };
    transverse_factor: {
      max_factor: number;
      min_factor: number;
      reference_bearing_sweep_deg: number;
      measurement_window_sub_ticks: number;
      edge_mode: "clamp";
    };
  };
  damage: {
    subsystem_state_thresholds: {
      operational_min_fraction: number;
      degraded_min_fraction: number;
    };
    local_hit_resolution: {
      kind: "nearest_system_within_radius";
      radius_hull_units: number;
      subsystem_damage_ratio: number;
    };
    effects_by_system_type: Record<
      string,
      {
        operational: SystemEffectValues;
        degraded: SystemEffectValues;
        offline: SystemEffectValues;
      }
    >;
  };
  victory: {
    hull_destroyed_at_or_below: number;
    boundary_disengage_enabled: boolean;
  };
}

export interface BaseSystemConfig {
  id: SystemId;
  type: string;
  physical_position: Vector2;
  ssd_position?: Vector2;
  hit_profile?: HitProfile;
  max_integrity: number;
  render?: {
    label?: string;
    short_label?: string;
    style_role?: string;
  };
}

export interface DriveSystemConfig extends BaseSystemConfig {
  type: "drive";
  parameters: {
    max_thrust: number;
  };
}

export interface ReactorSystemConfig extends BaseSystemConfig {
  type: "reactor";
  parameters: {
    discretionary_pips: number;
  };
}

export interface BridgeSystemConfig extends BaseSystemConfig {
  type: "bridge";
  parameters: Record<string, never>;
}

export interface WeaponMountSystemConfig extends BaseSystemConfig {
  type: "weapon_mount";
  parameters: {
    arc_degrees: number;
    bearing_degrees: number;
    baseline_track_quality: number;
    charge_table: Array<{
      pips: number;
      max_range_km: number;
      damage: number;
    }>;
  };
}

export type ShipSystemConfig =
  | DriveSystemConfig
  | ReactorSystemConfig
  | BridgeSystemConfig
  | WeaponMountSystemConfig;

export interface ShipConfig {
  schema_version: SchemaVersion;
  id: ShipConfigId;
  name: string;
  class: string;
  hull: {
    silhouette: Vector2[];
    max_integrity: number;
  };
  dynamics: {
    mass: number;
    max_turn_degrees_per_turn: number;
    moment_of_inertia?: number;
  };
  power: {
    discretionary_allocation_ids: string[];
  };
  systems: ShipSystemConfig[];
}

export type BattleBoundary = {
  kind: "rectangle";
  min: Vector2;
  max: Vector2;
};

export interface ParticipantSetup {
  slot_id: SlotId;
  ship_instance_id: ShipInstanceId;
  ship_config_id: ShipConfigId;
}

export interface ShipRuntimeState {
  ship_instance_id: ShipInstanceId;
  ship_config_id: ShipConfigId;
  slot_id: SlotId;
  status: ShipStatus;
  pose: {
    position: Vector2;
    velocity: Vector2;
    heading_degrees: number;
  };
  hull: {
    current_integrity: number;
  };
  systems: Record<
    SystemId,
    {
      current_integrity: number;
    }
  >;
}

export interface BattleState {
  schema_version: SchemaVersion;
  match_setup: {
    match_id: string;
    seed_root: string;
    rules: MatchRulesConfig;
    ship_catalog: Record<ShipConfigId, ShipConfig>;
    participants: ParticipantSetup[];
    battlefield: {
      boundary: BattleBoundary;
    };
  };
  turn_number: number;
  ships: Record<ShipInstanceId, ShipRuntimeState>;
  outcome: {
    winner_ship_instance_id: ShipInstanceId | null;
    end_reason: "destroyed" | "boundary_disengage" | null;
  };
}

export interface PiecewiseLinearTranslationPlan {
  kind: "piecewise_linear";
  frame: "world";
  knots: Array<{
    t: number;
    thrust_fraction: Vector2;
  }>;
}

export interface PlotWeaponCommitment {
  mount_id: SystemId;
  target_ship_instance_id: ShipInstanceId;
  fire_mode: "hold" | "best_shot_this_turn";
  charge_pips: number;
}

export interface PlotSubmission {
  schema_version: SchemaVersion;
  match_id: string;
  turn_number: number;
  ship_instance_id: ShipInstanceId;
  power: {
    drive_pips: number;
    railgun_pips: number;
  };
  maneuver: {
    desired_end_heading_degrees: number;
    translation_plan: PiecewiseLinearTranslationPlan;
  };
  weapons: PlotWeaponCommitment[];
}
