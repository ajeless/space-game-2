# v0.1 tuning baseline

> Created in this repository on 2026-04-21.
> This doc is the first-pass numeric baseline for `v0.1`. It is intended to be data-driven and easy to revise after playtesting.

**Status:** proposed starting values
**Scope:** v0.1 numeric rules and tuning constants
**Last updated:** 2026-04-21

## Purpose

The structural design docs now settle *what kinds of things exist* in `v0.1`:

- heading separate from drift
- integer reactor pips
- charge-scaled railgun
- exact hit percentage from solution quality
- hull plus subsystem integrity
- `operational / degraded / offline` subsystem states

This document settles the first-pass numbers behind those decisions.

These values are **not sacred**. They are intentionally chosen as a starting point that should produce readable tradeoffs and fast early playtests. The important commitment is that these values belong in data/config, not hard-coded in gameplay logic.

## Data-driven split

The tuning model should be split across three layers:

### Per-match rules config

Global values shared by all ships in a duel:

- turn structure
- hit-probability formula constants
- subsystem state thresholds
- local-hit radius and subsystem-damage ratio
- tie-break rules for "best legal shot"

These belong in a match/rules config file.

### Per-ship definition

Ship-specific numbers:

- hull integrity
- subsystem integrity
- mass
- max thrust
- max turn degrees per turn
- discretionary reactor pips
- weapon charge table
- baseline track quality

These belong in the ship JSON.

### Derived runtime state

Values computed from the rules config plus ship data:

- current available drive authority
- current best shot window
- current hit probability
- current subsystem state label

These belong in runtime state and event logs, not static data files.

## Baseline rules config

This is the starting global rules model for `v0.1`.

```json
{
  "turn": {
    "sub_ticks": 60,
    "best_shot_tiebreak": "earliest"
  },
  "damage": {
    "state_thresholds": {
      "operational_min_fraction": 0.67,
      "degraded_min_fraction": 0.34
    },
    "local_hit_radius_hull_units": 0.12,
    "subsystem_damage_ratio": 0.6
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
      "measurement_window_sub_ticks": 10
    }
  }
}
```

## Baseline ship numbers

These numbers align with the current `css_meridian` example ship and make the tradeoff structure concrete.

### Hull and subsystem integrity

```json
{
  "hull": { "max_integrity": 100 },
  "systems": {
    "forward_mount": { "max_integrity": 24 },
    "reactor": { "max_integrity": 32 },
    "bridge": { "max_integrity": 22 },
    "drive": { "max_integrity": 28 }
  }
}
```

### Maneuver and power

```json
{
  "dynamics": {
    "mass": 1000,
    "moment_of_inertia": 500,
    "initial_heading_degrees": 0,
    "max_turn_degrees_per_turn": 120
  },
  "reactor": {
    "discretionary_pips": 8
  },
  "drive": {
    "max_thrust": 1.8
  }
}
```

### Railgun charge table

```json
{
  "forward_mount": {
    "arc_degrees": 60,
    "bearing_degrees": 0,
    "baseline_track_quality": 0.70,
    "charge_table": [
      { "pips": 1, "max_range_km": 140, "damage": 8 },
      { "pips": 2, "max_range_km": 220, "damage": 12 },
      { "pips": 3, "max_range_km": 300, "damage": 15 }
    ]
  }
}
```

This means the default healthy ship has these meaningful headline choices:

- `7 drive / 1 gun`: maximum maneuvering with only a short-range threat
- `6 drive / 2 gun`: balanced threat band
- `5 drive / 3 gun`: strongest shot, visibly tighter maneuver envelope
- `8 drive / 0 gun`: pure reposition turn

That is a good `v0.1` starting tradeoff space.

## Movement baseline

The movement system should stay as physical as possible rather than introducing an arbitrary "drive pip table."

### Drive authority formula

At full reactor health:

```text
available_drive_fraction = drive_pips / discretionary_pips
available_thrust_this_turn = drive.max_thrust * available_drive_fraction
```

For the baseline ship with `8` pips and `max_thrust = 1.8`:

| Drive pips | Drive fraction | Available thrust |
| --- | ---: | ---: |
| 0 | 0.000 | 0.000 |
| 1 | 0.125 | 0.225 |
| 2 | 0.250 | 0.450 |
| 3 | 0.375 | 0.675 |
| 4 | 0.500 | 0.900 |
| 5 | 0.625 | 1.125 |
| 6 | 0.750 | 1.350 |
| 7 | 0.875 | 1.575 |
| 8 | 1.000 | 1.800 |

The tactical reachable region and ghost projection should come from the resolver/planner using this actual available thrust, not from a separate hand-authored lookup table.

### Turning baseline

`max_turn_degrees_per_turn = 120` is the starting value for the `css_meridian`.

Rationale:

- generous enough to feel maneuverable
- still prevents effortless full reversals every turn
- keeps facing tactically meaningful because 180-degree reorientation is not free

Lighter ships can move above this later. Heavier ships can move below it later. The same field already supports that differentiation.

## Hit-probability baseline

The `v0.1` hit model should be exact but simple:

```text
hit_probability =
  clamp(
    baseline_track_quality
    * bridge_track_factor
    * mount_track_factor
    * range_factor
    * transverse_factor,
    min_probability,
    max_probability
  )
```

### Range factor

For a charged shot:

```text
range_ratio = range_km / charge.max_range_km
range_factor = clamp(1.05 - 0.40 * range_ratio, 0.65, 1.05)
```

This gives the following shape:

| Range ratio | Range factor |
| --- | ---: |
| 0.00 | 1.05 |
| 0.25 | 0.95 |
| 0.50 | 0.85 |
| 0.75 | 0.75 |
| 1.00 | 0.65 |

Any shot beyond `1.00` of the charged band is illegal and is not considered.

### Transverse factor

The motion term should be based on **local bearing sweep**, not hidden magic.

```text
bearing_sweep_deg =
  absolute change in target bearing across a 10-sub-tick window centered on the candidate shot

transverse_factor =
  clamp(1.0 - 0.50 * (bearing_sweep_deg / 40), 0.50, 1.0)
```

This gives the following shape:

| Bearing sweep over local window | Transverse factor |
| --- | ---: |
| 0° | 1.00 |
| 10° | 0.875 |
| 20° | 0.75 |
| 30° | 0.625 |
| 40° or more | 0.50 |

This preserves the hard-SF feel: targets cutting sharply across the line of fire are harder to hit than targets moving mostly toward or away from the shooter.

### Bridge and mount state factors

These are the starting tracking modifiers from subsystem condition:

| System state | Bridge track factor | Mount track factor |
| --- | ---: | ---: |
| Operational | 1.00 | 1.00 |
| Degraded | 0.85 | 0.85 |
| Offline | 0.60 | 0.00 |

If the mount is `offline`, the weapon cannot fire regardless of the formula.

### Sample hit probabilities

For a healthy ship and healthy mount with `baseline_track_quality = 0.70`:

| Situation | Calculation | Hit chance |
| --- | --- | ---: |
| Close range, low sweep | `0.70 * 1.05 * 1.00` | 73.5% |
| Mid range, moderate sweep | `0.70 * 0.85 * 0.75` | 44.6% |
| Max range, low sweep | `0.70 * 0.65 * 1.00` | 45.5% |
| Close range, degraded bridge | `0.70 * 1.05 * 1.00 * 0.85` | 62.5% |

Those numbers feel tactical without becoming either coin-flippy nonsense or near-certainty.

## Best-shot selection rule

For an authorized railgun shot, the resolver evaluates all legal candidate sub-ticks and chooses:

1. highest `hit_probability`
2. earliest sub-tick among ties

Because damage is fixed by committed charge, maximizing hit probability also maximizes expected damage in `v0.1`. No separate "style" rule is needed yet.

## Damage baseline

### Local subsystem-hit rule

Every successful hit:

- always applies hull damage
- checks for the nearest subsystem within `local_hit_radius_hull_units = 0.12`
- if a nearby subsystem exists, also applies subsystem damage

Subsystem damage on a local hit is:

```text
subsystem_damage = hull_damage * subsystem_damage_ratio
```

With `subsystem_damage_ratio = 0.6`, the baseline railgun does:

| Charge pips | Hull damage | Subsystem damage on local hit |
| --- | ---: | ---: |
| 1 | 8 | 4.8 |
| 2 | 12 | 7.2 |
| 3 | 15 | 9.0 |

This is deliberate:

- a strong direct hit can degrade a lighter subsystem in one shot
- heavier systems usually need repeated punishment
- local placement matters immediately, but hull integrity still matters every time

### State thresholds

Subsystem state is derived from remaining integrity fraction:

| Remaining integrity fraction | State |
| --- | --- |
| `>= 0.67` | Operational |
| `>= 0.34` and `< 0.67` | Degraded |
| `< 0.34` | Offline |

This yields intuitive outcomes with the baseline integrity numbers:

- a `3`-pip local hit on the `forward_mount` (`24` max) pushes it to `62.5%`, which is `degraded`
- the same hit on the `reactor` (`32` max) leaves it at `71.9%`, still `operational`

That feels right for the first slice.

## Subsystem penalties

These are the recommended first-pass penalties for each core subsystem.

### Drive

| State | Effect |
| --- | --- |
| Operational | 100% of allocated drive authority |
| Degraded | 55% of allocated drive authority |
| Offline | 0% drive authority |

### Reactor

| State | Effect |
| --- | --- |
| Operational | full discretionary pips |
| Degraded | `floor(base_pips * 0.625)` |
| Offline | `0` discretionary pips |

For the baseline `8`-pip reactor:

- `Operational` = `8`
- `Degraded` = `5`
- `Offline` = `0`

### Bridge

| State | Effect |
| --- | --- |
| Operational | full turn cap, full track quality |
| Degraded | `turn_cap * 0.75`, `bridge_track_factor = 0.85` |
| Offline | `turn_cap * 0.50`, `bridge_track_factor = 0.60` |

This keeps bridge hits severe without making them instant mission kills in `v0.1`.

### Weapon mount

| State | Effect |
| --- | --- |
| Operational | full charge table, full track quality |
| Degraded | effective charge reduced by `1` pip minimum, `mount_track_factor = 0.85` |
| Offline | cannot fire |

Examples:

- committed `3`-pip shot on degraded mount behaves as `2`-pip shot
- committed `1`-pip shot on degraded mount remains `1`-pip shot but takes the track penalty

This makes mount damage palpable immediately without needing ammo jams, cooling delays, or richer failure modes yet.

## Why these numbers are a good first pass

They create visible, teachable tradeoffs:

- The reactor budget is small enough that every pip matters.
- The railgun has three meaningful charge bands instead of a continuous blur.
- Turning is generous, but not enough to erase facing.
- Exact hit percentages remain readable because the formula is shallow.
- Subsystem damage matters early without overshadowing hull damage completely.

Most importantly, the model is **easy to tune by editing data**:

- change charge bands in ship data
- change turn rate in ship data
- change integrity or subsystem durability in ship data
- change hit-curve constants in rules config
- change state thresholds in rules config

That is the right posture for early vertical-slice work.

## Recommended next step

After this document, the next planning task should be to turn these numbers into the actual data contracts:

- match rules config shape
- ship JSON shape
- battle-state shape
- plot submission shape

At that point the first implementation pass can be strongly data-driven from day one.

## Related docs

- `resolver_design.md` — structural resolver behavior
- `ship_definition_format.md` — where per-ship numeric data lives
- `ssd_layout.md` — how the player sees these numbers
