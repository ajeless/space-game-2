# v0.1 data contracts

**Status:** current  
**Audience:** contributors

> Created in this repository on 2026-04-21.
> This doc turns the existing v0.1 design direction into concrete config and runtime contract shapes.

**Scope:** v0.1 rules config, ship config, battle state, and plot submission
**Last updated:** 2026-04-21

## Summary

This document defines the canonical data shapes that the early implementation should target:

- `MatchRulesConfig`
- `ShipConfig`
- `BattleState`
- `PlotSubmission`

It resolves a few loose seams in the earlier docs without changing the core design direction:

- reusable ship definitions are distinct from in-battle ship instances
- starting pose belongs to the match setup, not the ship file
- plots include a deterministic translation plan, not only a desired end point
- battle state snapshots the rules config and ship catalog so resolver calls and replay artifacts are self-contained

## Findings from the current docs

Before naming the contracts, these are the gaps or contradictions worth fixing explicitly:

- `README.md` still described the minimal SSD as "two or three subsystems (reactor, one weapon, hull)", but the actual `v0.1` rules now assume four core systems: `drive`, `reactor`, `bridge`, and one `weapon_mount`, plus hull integrity.
- `ship_definition_format.md` placed `initial_heading_degrees` in the reusable ship file. That does not survive "two identical ships" cleanly because two copies of the same ship class may start a match at different headings or drift vectors.
- `resolver_design.md` allowed `turn_ended` at sub-tick `60`, while the generic event shape claimed `sub_tick` was only `0..59`.
- `resolver_design.md` called weapon damage `damageRolled`, but the current railgun design uses fixed charge-band damage rather than a roll.
- The rough plot shape used `desiredEndPosition`, which is not enough information to reproduce a within-turn trajectory. Once the resolver picks the best firing sub-tick inside the turn, the canonical plot has to describe the planned motion path, not only the ending pose.
- The docs used `shipId` loosely for both reusable ship definitions and actual in-battle participants. The contracts below separate `ship_config_id` from `ship_instance_id`.
- The disengagement boundary existed as a win condition, but it was not placed anywhere concrete in the data model.
- The tuning baseline implies fractional subsystem damage (`0.6` damage ratio against integer hull damage). The contracts below therefore treat runtime integrity as numeric, not integer-only.

## Contract principles

These rules drive the shapes below:

1. **Separate reusable config from match-instance state.** A ship file describes a ship class. A battle state describes a concrete copy of that ship in one match.
2. **Keep the resolver self-contained.** A `BattleState` snapshot carries the rules config and ship catalog used by the match so a replay or test case does not depend on ambient file lookups.
3. **Preserve clean seams for future extensions.** Cosmetic layout data is separate from physical data. Hit-resolution strategy is a discriminated object. System behavior is keyed by system `type`.
4. **Prefer canonical source values over cached derivations.** Runtime integrity is canonical. `operational / degraded / offline` labels are derived from integrity plus rules.
5. **Version top-level payloads.** Internet-playable peer-hosted builds need a cheap way to reject obviously incompatible JSON.
6. **Keep planner UI config out of core combat contracts.** Widget choice, labels, camera presets, and similar player-facing concerns belong in a companion planner/UI data layer, not in `MatchRulesConfig` or `BattleState`.

## Shared primitives and conventions

```typescript
type SchemaVersion = "sg2/v0.1";

type ShipConfigId = string;
type ShipInstanceId = string;
type SystemId = string;
type SlotId = string;

type Vector2 = { x: number; y: number };

type SubsystemState = "operational" | "degraded" | "offline";
type ShipStatus = "active" | "destroyed" | "disengaged";
```

### Coordinate and angle conventions

- **Ship-local hull coordinates** use the existing SSD convention:
  - origin at the geometric center of the hull
  - `x < 0` = port, `x > 0` = starboard
  - `y < 0` = bow, `y > 0` = aft
  - normalized hull units, usually around `-0.5 .. +0.5`
- **World coordinates** use a flat 2D tactical plane. The contract intentionally keeps field names generic (`position`, `velocity`) because turn duration is not fixed yet, so the public fiction-time unit naming for velocity is still deferred.
- **Angles** use `0` as ship-forward / viewport-up and increase clockwise. This matches the existing mount-bearing examples where `+90` means starboard.

## Companion UI data

This document intentionally does **not** define planner-widget or tactical-camera config. Those concerns are still meant to be data-driven, but they live in a companion UI layer rather than the resolver-facing combat contracts. See `planner_ui_and_tactical_camera.md`.

## Match rules config

The match rules config holds the global mechanics shared by all ships in a duel. Scenario geometry such as the disengagement boundary does **not** live here; it lives in `BattleState.match_setup.battlefield`.

```typescript
interface MatchRulesConfig {
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
    effects_by_system_type: Record<string, {
      operational: Record<string, number | boolean | string>;
      degraded: Record<string, number | boolean | string>;
      offline: Record<string, number | boolean | string>;
    }>;
  };
  victory: {
    hull_destroyed_at_or_below: number;
    boundary_disengage_enabled: boolean;
  };
}
```

### v0.1 recognized effect keys

The `effects_by_system_type` object stays open-ended so new subsystem types can be added later without changing the envelope. `v0.1` recognizes these keys:

- `drive_authority_factor`
- `discretionary_pips_factor`
- `discretionary_pips_override`
- `rounding`
- `turn_cap_factor`
- `track_quality_factor`
- `charge_penalty_pips`
- `firing_enabled`

### v0.1 baseline shape

The tuning baseline implies this concrete structure:

```json
{
  "schema_version": "sg2/v0.1",
  "id": "default_duel_v0_1",
  "name": "Default Duel v0.1",
  "turn": {
    "sub_ticks": 60,
    "duration_seconds": 120
  },
  "fire_control": {
    "timing_policy": "best_legal_shot",
    "tie_break": "earliest"
  },
  "hit_probability": {
    "min_probability": 0.05,
    "max_probability": 0.95,
    "range_factor": {
      "max_factor": 1.05,
      "min_factor": 0.65,
      "slope": 0.40
    },
    "transverse_factor": {
      "max_factor": 1.0,
      "min_factor": 0.50,
      "reference_bearing_sweep_deg": 40,
      "measurement_window_sub_ticks": 10,
      "edge_mode": "clamp"
    }
  },
  "damage": {
    "subsystem_state_thresholds": {
      "operational_min_fraction": 0.67,
      "degraded_min_fraction": 0.34
    },
    "local_hit_resolution": {
      "kind": "nearest_system_within_radius",
      "radius_hull_units": 0.12,
      "subsystem_damage_ratio": 0.6
    },
    "effects_by_system_type": {
      "drive": {
        "operational": { "drive_authority_factor": 1.0 },
        "degraded": { "drive_authority_factor": 0.55 },
        "offline": { "drive_authority_factor": 0.0 }
      },
      "reactor": {
        "operational": {
          "discretionary_pips_factor": 1.0,
          "rounding": "floor"
        },
        "degraded": {
          "discretionary_pips_factor": 0.625,
          "rounding": "floor"
        },
        "offline": {
          "discretionary_pips_override": 0
        }
      },
      "bridge": {
        "operational": {
          "turn_cap_factor": 1.0,
          "track_quality_factor": 1.0
        },
        "degraded": {
          "turn_cap_factor": 0.75,
          "track_quality_factor": 0.85
        },
        "offline": {
          "turn_cap_factor": 0.50,
          "track_quality_factor": 0.60
        }
      },
      "weapon_mount": {
        "operational": {
          "track_quality_factor": 1.0,
          "charge_penalty_pips": 0,
          "firing_enabled": true
        },
        "degraded": {
          "track_quality_factor": 0.85,
          "charge_penalty_pips": 1,
          "firing_enabled": true
        },
        "offline": {
          "track_quality_factor": 0.0,
          "charge_penalty_pips": 0,
          "firing_enabled": false
        }
      }
    }
  },
  "victory": {
    "hull_destroyed_at_or_below": 0,
    "boundary_disengage_enabled": true
  }
}
```

## Ship config

The ship config remains a reusable JSON file. It does **not** contain battle-instance pose or scenario placement.

```typescript
interface ShipConfig {
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

interface BaseSystemConfig {
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

type HitProfile =
  | { shape: "circle"; radius: number }
  | { shape: "ellipse"; radius_x: number; radius_y: number }
  | { shape: "polygon"; points: Vector2[] };

interface DriveSystemConfig extends BaseSystemConfig {
  type: "drive";
  parameters: {
    max_thrust: number;
  };
}

interface ReactorSystemConfig extends BaseSystemConfig {
  type: "reactor";
  parameters: {
    discretionary_pips: number;
  };
}

interface BridgeSystemConfig extends BaseSystemConfig {
  type: "bridge";
  parameters: Record<string, never>;
}

interface WeaponMountSystemConfig extends BaseSystemConfig {
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

type ShipSystemConfig =
  | DriveSystemConfig
  | ReactorSystemConfig
  | BridgeSystemConfig
  | WeaponMountSystemConfig;
```

### Notes

- `physical_position` is canonical combat data.
- `ssd_position` is optional render-only override.
- `hit_profile` is optional and ignored by the simplest `v0.1` local-hit rule, but it is the intended seam for smarter hit resolution later.
- `render` is optional cosmetic metadata. It exists so SSD appearance can change later without polluting combat fields.
- `moment_of_inertia` is explicitly future-facing. The `v0.1` resolver can ignore it while still allowing later rotational-physics work without reshaping the file.
- `power.discretionary_allocation_ids` is descriptive metadata for the plot UI. The authoritative reactor pip budget still comes from the reactor subsystem.

## Battle state

The battle state is the canonical resolver state at a turn boundary. It snapshots the immutable match setup needed to reproduce the battle without external lookups.

```typescript
interface BattleState {
  schema_version: SchemaVersion;
  match_setup: {
    match_id: string;
    seed_root: string;
    rules: MatchRulesConfig;
    ship_catalog: Record<ShipConfigId, ShipConfig>;
    participants: Array<{
      slot_id: SlotId;
      ship_instance_id: ShipInstanceId;
      ship_config_id: ShipConfigId;
    }>;
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

type BattleBoundary = {
  kind: "rectangle";
  min: Vector2;
  max: Vector2;
};

interface ShipRuntimeState {
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
  systems: Record<SystemId, {
    current_integrity: number;
  }>;
}
```

### Notes

- `turn_number` is the turn about to be plotted / resolved next.
- `seed_root` is match-scoped seed material. The per-turn seed can be derived as `hash(seed_root, turn_number)`.
- Starting pose now lives here naturally: the initial `BattleState.ships[*].pose` is the scenario start.
- `BattleState` stores canonical integrity values, not cached subsystem labels. `operational / degraded / offline` is derived from `current_integrity`, the ship config, and the rules config.
- The boundary shape lives in `battlefield`, not in the rules config, because different scenarios may reuse the same rules with different map sizes.

## Plot submission

The plot submission is the player's authoritative per-turn commitment. It must be specific enough to reconstruct motion across the turn, not only at the endpoint.

```typescript
interface PlotSubmission {
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
  weapons: Array<{
    mount_id: SystemId;
    target_ship_instance_id: ShipInstanceId;
    fire_mode: "hold" | "best_shot_this_turn";
    charge_pips: number;
  }>;
}

interface PiecewiseLinearTranslationPlan {
  kind: "piecewise_linear";
  frame: "world";
  knots: Array<{
    t: number;
    thrust_fraction: Vector2;
  }>;
}
```

### Validation rules

- `drive_pips`, `railgun_pips`, and `charge_pips` are non-negative integers.
- All discretionary reactor pips must be assigned every turn:
  - `drive_pips + railgun_pips == available_reactor_pips_for_this_ship`
- For `v0.1`, reserved railgun charge must map cleanly onto mounts:
  - `sum(weapons[*].charge_pips) == railgun_pips`
- `weapons[*].mount_id` must be unique within the plot.
- `translation_plan.knots` must:
  - be sorted by ascending `t`
  - begin at `t = 0`
  - end at `t = 1`
  - contain finite numeric vectors
- The planner and resolver interpret `thrust_fraction` as normalized drive intent. Actual applied thrust is the validated plan scaled by the ship's available drive authority for that turn.

### Why `translation_plan` looks like this

`desiredEndPosition` was too lossy for the current design. The execute phase, shot-window preview, and best-shot timing rule all depend on the path through the turn. A piecewise-linear plan is still compact JSON, maps naturally to draggable planner handles, and leaves clean extension seams:

- add new `kind` values later if a richer maneuver model is earned
- add new `frame` values later if ship-local thrust planning becomes gameplay
- keep the existing envelope and validation story intact

The `v0.1` recommendation is to keep `frame = "world"` for simplicity. If later slices want thrust relative to ship-local axes or actual thruster hardpoints, that should arrive as a new validated maneuver mode rather than a quiet reinterpretation of the existing one.

## Resolver input and output

With the contracts above, the resolver can stay conceptually simple:

```typescript
interface ResolveTurnInput {
  state: BattleState;
  plots_by_ship: Record<ShipInstanceId, PlotSubmission>;
  seed: string;
}

interface ResolveTurnOutput {
  next_state: BattleState;
  events: unknown[];
}
```

The important point is not the exact wrapper name. It is that the resolver input is now self-contained:

- battle state snapshot
- rules config snapshot
- ship catalog snapshot
- plot submissions keyed by ship instance
- deterministic seed

That is the right posture for tests, replays, and future offline / AI use.

## Validation priorities across contracts

These checks are worth treating as hard errors:

- every `ship_instance_id` in `participants`, `ships`, and incoming plots lines up
- every `ship_config_id` referenced by a participant exists in `ship_catalog`
- every runtime `systems` record matches the configured system ids for that ship config exactly
- every plot targets the current `turn_number`
- every plot references an existing active ship instance
- every mount referenced by `weapons[*].mount_id` exists on that ship and is a `weapon_mount`

## Related docs

- `resolver_design.md` — the pure turn resolver that consumes these shapes
- `ship_definition_format.md` — the reusable ship-file design this contract narrows
- `v0_1_tuning_baseline.md` — the numeric defaults these fields carry
- `ssd_layout.md` — the planner and SSD UI that author and consume these values
