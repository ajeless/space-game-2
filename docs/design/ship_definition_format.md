# Ship definition format — v0.1

**Status:** current  
**Audience:** contributors

> Imported from `ajeless/docs/sg/space_game_2/design/ship_definition_format.md` on 2026-04-21.
> This copy is now maintained in this repository.

**Scope:** v0.1 vertical slice
**Last updated:** 2026-04-21

## Summary

Ships are defined in JSON files, loaded at startup. The v0.1 format supports hull silhouette, systems with positional metadata, and the parameters needed for the resolver and the SSD renderer. It explicitly supports heading as a state separate from drift, integer-pip power budgeting, charge-scaled railgun behavior, and per-subsystem integrity. It also treats **physical system position** as the canonical gameplay data, with an optional separate **SSD render position** for future visual/layout flexibility. The format is minimal at v0.1 but extensible; fields are added to the schema as later slices introduce new mechanics.

## Why data-driven

The resolver and the UI know nothing about specific ships. They read ship definitions and operate on whatever the files describe. This has three practical consequences worth naming because they shape later decisions:

- **Iteration speed.** Ship balance — reactor pips, hull integrity, subsystem durability, charge bands — is a tuning activity, not a coding activity. Change a value in a JSON file, reload, retry. No rebuild.
- **"Two identical ships" and "two different ships" are architecturally the same.** The v0.1 scope (two identical ships) is achieved by loading one ship definition twice. No special case.
- **Future ship-designer features are not blocked.** A GUI for building new ships, whenever that becomes scope, produces JSON that conforms to the same format.

At v0.1, the game ships with exactly one ship definition file. That's the v0.1 scope. The format supporting multiple ships isn't speculative flexibility — it's the cheapest way to build the one ship, because every parameter has to live somewhere anyway.

## The format

Ships are JSON files with a top-level object. The shape:

```json
{
  "schema_version": "sg2/v0.1",
  "id": "css_meridian",
  "name": "CSS Meridian",
  "class": "frigate",
  "hull": { ... },
  "systems": [ ... ],
  "dynamics": { ... },
  "power": { ... }
}
```

Each top-level field has a specific purpose, discussed below.

### `id` — machine-readable identifier

Used internally to reference the ship (in replay events, in save files, in other ship definitions that might later reference it). Stable across versions. Lowercase, underscores, no spaces.

### `name` and `class` — display strings

Shown in the UI. Human-readable. May be localized later.

### `hull` — the ship's silhouette and structural properties

```json
"hull": {
  "silhouette": [
    { "x": 0, "y": -0.5 },
    { "x": 0.15, "y": -0.35 },
    { "x": 0.2, "y": 0.1 },
    { "x": 0.18, "y": 0.35 },
    { "x": 0.3, "y": 0.5 },
    { "x": 0, "y": 0.6 }
  ],
  "max_integrity": 100
}
```

**`silhouette`** is a closed polygon defined by points in ship-local coordinates. The ship's local origin is the geometric center of the hull. The Y axis runs from bow (negative) to aft (positive). The X axis runs port (negative) to starboard (positive). Coordinates are normalized: roughly `-0.5` to `+0.5` along the long axis. Only half the silhouette needs to be specified if we decide hulls are symmetric — the renderer can mirror it. (Mirroring is a v0.1 decision to make; current lean is to require the full polygon to allow asymmetric ships later without schema change.)

**`max_integrity`** is the ship's total hull durability. Hull condition during play is tracked as current integrity versus this maximum. When hull integrity reaches zero, the ship is destroyed.

### `systems` — the ship's subsystems, placed on the hull

```json
"systems": [
  {
    "id": "drive",
    "type": "drive",
    "physical_position": { "x": 0, "y": 0.45 },
    "max_integrity": 28,
    "parameters": { "max_thrust": 1.8 }
  },
  {
    "id": "reactor",
    "type": "reactor",
    "physical_position": { "x": 0, "y": 0.25 },
    "max_integrity": 32,
    "parameters": { "discretionary_pips": 8 }
  },
  {
    "id": "bridge",
    "type": "bridge",
    "physical_position": { "x": 0, "y": 0 },
    "max_integrity": 22,
    "parameters": {}
  },
  {
    "id": "forward_mount",
    "type": "weapon_mount",
    "physical_position": { "x": 0, "y": -0.4 },
    "max_integrity": 24,
    "parameters": {
      "arc_degrees": 60,
      "bearing_degrees": 0,
      "baseline_track_quality": 0.7,
      "charge_table": [
        { "pips": 1, "max_range_km": 140, "damage": 8 },
        { "pips": 2, "max_range_km": 220, "damage": 12 },
        { "pips": 3, "max_range_km": 300, "damage": 15 }
      ]
    }
  }
]
```

Every system has five required fields:

- **`id`** — unique within the ship. Referenced by replay events ("hit registered on system X") and by ship config files.
- **`type`** — the kind of system. Determines which resolver logic applies and how the UI renders it. v0.1 types: `drive`, `reactor`, `bridge`, `weapon_mount`. Additional types (shields, sensors, damage_control, point_defense, etc.) are added as later slices introduce them.
- **`physical_position`** — ship-local coordinates for the system's actual location inside or on the ship. This is the canonical gameplay position. The resolver uses this to determine which system gets hit when damage lands in a specific region of the hull.
- **`max_integrity`** — the subsystem's internal durability pool. During play, the current subsystem integrity is tracked against this maximum.
- **`parameters`** — a type-specific object. Its shape depends on `type`. Validated by the resolver when the ship loads.

Two additional fields are part of the forward direction, though not required on every v0.1 system:

- **`ssd_position`** *(optional)* — where the system is drawn on the SSD. If omitted, it defaults to `physical_position`.
- **`hit_profile`** *(optional)* — the system's local damage footprint for richer hit resolution later. If omitted, the v0.1 resolver treats the system like a point target with a shared nearby-hit radius.

The `parameters` object is deliberately open-ended. New system types introduce new parameter shapes without breaking the top-level schema. Unknown parameters are ignored by the resolver (with a warning logged), which means adding a field is backward-compatible.

#### Why `physical_position` and `ssd_position` are separate concepts

The ship schematic should usually tell the truth about where things really are on the ship. That means the default behavior is simple:

```json
{
  "id": "reactor",
  "type": "reactor",
  "physical_position": { "x": 0, "y": 0.25 },
  "max_integrity": 32,
  "parameters": { "discretionary_pips": 8 }
}
```

In this default case, the renderer places the reactor on the SSD at the same coordinates the resolver uses for hit logic.

But the *concepts* still need to be separate:

- A future UI may need a small cosmetic layout override so labels and controls remain legible.
- A future ship designer may let players make real mechanical changes to where systems are physically located.
- Hit resolution should always key off physical data, not cosmetic layout tweaks.

So the model is:

- `physical_position` is canonical.
- `ssd_position` is optional.
- if `ssd_position` is absent, the SSD uses `physical_position`.

That gives the project a painless upgrade path without complicating the default case.

#### Example: cosmetic override without gameplay change

```json
{
  "id": "bridge",
  "type": "bridge",
  "physical_position": { "x": 0, "y": -0.02 },
  "ssd_position": { "x": 0.03, "y": -0.02 },
  "max_integrity": 22,
  "parameters": {}
}
```

Here the bridge is *drawn* slightly off-center for legibility, but the resolver still uses the canonical `physical_position`.

#### Example: real ship-configuration change

```json
{
  "id": "port_mount",
  "type": "weapon_mount",
  "physical_position": { "x": -0.18, "y": -0.18 },
  "max_integrity": 24,
  "parameters": {
    "arc_degrees": 80,
    "bearing_degrees": -35,
    "baseline_track_quality": 0.68,
    "charge_table": [
      { "pips": 1, "max_range_km": 140, "damage": 8 },
      { "pips": 2, "max_range_km": 220, "damage": 12 },
      { "pips": 3, "max_range_km": 300, "damage": 15 }
    ]
  }
}
```

This is a real mechanical refit. The mount's SSD position follows the new physical position by default, and hit resolution changes with it.

#### Example: future richer hit footprint

```json
{
  "id": "reactor",
  "type": "reactor",
  "physical_position": { "x": 0, "y": 0.25 },
  "max_integrity": 32,
  "hit_profile": {
    "shape": "circle",
    "radius": 0.08
  },
  "parameters": { "discretionary_pips": 8 }
}
```

`v0.1` does not require per-system custom hit profiles, but this is the intended future seam. It lets the resolver get smarter about what counts as "a hit near the reactor" without changing the whole schema.

#### Integrity and player-facing condition

Subsystem durability is stored internally as absolute values (`current_integrity` against `max_integrity`). The SSD does not need to expose those raw numbers directly; it can present a normalized `0-100%` condition plus a coarse status label such as `Operational`, `Degraded`, or `Offline`.

This separation is deliberate. It lets one ship have a much tougher reactor than another while still presenting a clear condition readout to the player. It also preserves the future direction where player-designed ships can devote more volume, mass, armor, or redundancy to specific systems without changing the UI model.

#### Parameters by type at v0.1

- **`drive`**: `max_thrust` (scalar, in whatever units the dynamics use).
- **`reactor`**: `discretionary_pips` (integer pips allocated each turn between drive and railgun reservation). Later slices add `peak_output_mw`, `heat_capacity`, `cooling_rate`, etc., if the game earns a richer energy model.
- **`bridge`**: no parameters at v0.1. Later slices add crew capacity, sensor integration, etc. Kept in the schema so the UI can render it.
- **`weapon_mount`**: `arc_degrees` (firing cone width), `bearing_degrees` (center direction relative to ship's forward, 0 = bow, 90 = starboard, etc.), `baseline_track_quality` (the mount's default fire-control quality term), and `charge_table` (the committed-charge bands that map pip allocation to effective range and damage).

### `dynamics` — physical properties relevant to movement

```json
"dynamics": {
  "mass": 1000,
  "moment_of_inertia": 500,
  "max_turn_degrees_per_turn": 120
}
```

```json
"power": {
  "discretionary_allocation_ids": ["drive", "railgun"]
}
```

Properties governing how the ship responds to thrust and external forces. `mass` determines the cost of changing the ship's drift vector. `max_turn_degrees_per_turn` is the generous v0.1 kinematic turn limit that caps how far the ship may reorient during a turn. Starting pose is intentionally **not** part of the reusable ship definition: initial position, initial drift, and initial heading belong to the match setup / battle state because two instances of the same ship may start a scenario differently.

At v0.1, heading change is *not* part of the explicit reactor-pip budget. The cost-bearing maneuvering problem is translational, not rotational. `moment_of_inertia` is preserved as a forward-looking field for richer rotational physics later, but the v0.1 resolver uses the ship's turn-rate cap rather than full torque simulation.

### `power` — the player-managed allocation model

The v0.1 power model is intentionally coarse. The reactor exposes integer pips, and every pip must be assigned during plotting. The current allocatable sinks are `drive` and `railgun`. This top-level block is descriptive metadata for the planner / UI; the authoritative pip budget still lives on the reactor subsystem.

## Coordinate system conventions

Two coordinate concepts live in the ship file, and they share the same conventions:

- **Origin:** geometric center of the hull.
- **Y axis:** bow (negative) to aft (positive).
- **X axis:** port (negative) to starboard (positive).
- **Units:** normalized, roughly `-0.5` to `+0.5` along the ship's long dimension. The actual physical size of the ship in world coordinates is a separate concern (a `scale` field may be added later if ship size matters mechanically; v0.1 assumes one scale).

This matches the Expanse-style "rocket stack" orientation we committed to in the SSD design: bow at the top of the schematic, aft at the bottom, systems placed along the vertical axis with weapons distributed laterally.

At v0.1:

- `physical_position` always uses this coordinate system.
- `ssd_position`, when present, also uses this coordinate system unless a future UI-specific transform layer is introduced.

## Validation

Ship files are validated at load time. Failures are loud — the game refuses to start if a ship file is malformed. Validation checks at v0.1:

- Required fields present.
- `silhouette` is a valid closed polygon with at least 3 points.
- `hull.max_integrity` is positive.
- All system `id`s are unique within the ship.
- All `max_integrity` values are positive.
- All `physical_position` values are finite and sensible.
- All system `physical_position`s are inside the silhouette (a warning if outside — not an error, since weapon mounts legitimately protrude).
- All system `type`s are known.
- Type-specific parameters are valid for their type.
- `charge_table` entries are valid, ordered by pip count, and monotonic in pip count.
- `ssd_position`, if present, is finite.
- `hit_profile`, if present, is valid for its declared shape.

Validation logic lives in a single module imported by both server and client. Shared validation means a client can refuse to render a ship the server would reject.

## Example: the v0.1 ship

The ship that ships with v0.1 — the one used for the two-identical-ship duel — is specified in full here as a concrete reference. Not a commitment to specific numbers; these are starting points for tuning.

```json
{
  "schema_version": "sg2/v0.1",
  "id": "css_meridian",
  "name": "CSS Meridian",
  "class": "frigate",
  "hull": {
    "silhouette": [
      { "x": 0, "y": -0.5 },
      { "x": 0.15, "y": -0.35 },
      { "x": 0.18, "y": 0.1 },
      { "x": 0.14, "y": 0.3 },
      { "x": 0.3, "y": 0.42 },
      { "x": 0.2, "y": 0.55 },
      { "x": 0, "y": 0.6 },
      { "x": -0.2, "y": 0.55 },
      { "x": -0.3, "y": 0.42 },
      { "x": -0.14, "y": 0.3 },
      { "x": -0.18, "y": 0.1 },
      { "x": -0.15, "y": -0.35 }
    ],
    "max_integrity": 100
  },
  "systems": [
    {
      "id": "forward_mount",
      "type": "weapon_mount",
      "physical_position": { "x": 0, "y": -0.35 },
      "max_integrity": 24,
      "parameters": {
        "arc_degrees": 60,
        "bearing_degrees": 0,
        "baseline_track_quality": 0.7,
        "charge_table": [
          { "pips": 1, "max_range_km": 140, "damage": 8 },
          { "pips": 2, "max_range_km": 220, "damage": 12 },
          { "pips": 3, "max_range_km": 300, "damage": 15 }
        ]
      }
    },
    {
      "id": "reactor",
      "type": "reactor",
      "physical_position": { "x": 0, "y": 0.15 },
      "max_integrity": 32,
      "parameters": { "discretionary_pips": 8 }
    },
    {
      "id": "bridge",
      "type": "bridge",
      "physical_position": { "x": 0, "y": -0.05 },
      "max_integrity": 22,
      "parameters": {}
    },
    {
      "id": "drive",
      "type": "drive",
      "physical_position": { "x": 0, "y": 0.45 },
      "max_integrity": 28,
      "parameters": { "max_thrust": 1.8 }
    }
  ],
  "dynamics": {
    "mass": 1000,
    "moment_of_inertia": 500,
    "max_turn_degrees_per_turn": 120
  },
  "power": {
    "discretionary_allocation_ids": ["drive", "railgun"]
  }
}
```

The numbers here are unverified starting points — they'll change as playtesting reveals what makes for a fun duel. The *shape* of the data is what this doc commits to.

## Not decided / deferred

- **Asymmetric hulls.** The current format allows asymmetry but v0.1 doesn't exercise it. Future non-human or custom-design ships might.
- **Exact subsystem thresholds and penalties.** The v0.1 model is numeric integrity plus coarse behavior states (`operational`, `degraded`, `offline`), but the precise thresholds and penalties are tuning work.
- **Multi-tier weapon mounts.** The `weapon_mount` type at v0.1 is generic. Future slices may distinguish between direct-fire, kinetic, seeker, and beam mounts with different parameter shapes — likely as separate `type` values rather than parameters on a common type.
- **Armor zones.** v0.1 treats the hull as a single hit-point pool. Later slices may introduce per-zone armor that modifies incoming damage based on where a hit lands.
- **Crew.** No crew modeling at v0.1. The continuity-of-humanity principle is a setting commitment that will express as mechanics later.
- **Construction-derived durability.** The principle is preserved that future player-designed ships may make systems tougher by allocating more volume, mass, armor, or redundancy to them. The designer mechanics for that are deferred.
- **Fully player-editable internal layouts.** The schema direction supports them: move `physical_position` for real mechanical changes, use `ssd_position` only for cosmetic overrides. The actual designer workflow and constraints are deferred.
- **Ship scale / physical size.** v0.1 uses normalized coordinates and assumes one scale. Future multi-ship-class work will need a physical-size convention.
- **Ship identity metadata.** Faction, tech tier, cost, description — deferred until there are multiple ships worth distinguishing.
- **Visual styling.** Hull color, trim details, engine glow color — these are visual-identity decisions, not data-model decisions. Handled in a separate style layer when visual polish becomes scope.

## Upgrade paths preserved

This format does not block any of the following:

- **Multiple ship types.** Already supported — each ship is a separate file.
- **A ship designer.** GUI produces JSON conforming to this schema.
- **Ship variants / refits.** Base ship plus modifier files, merged at load time.
- **Per-faction ship variants.** Faction metadata as a top-level field, once factions exist.
- **Animated systems.** An optional `animation` block per system, added when execute-phase rendering needs it.
- **Subsystem dependencies.** An optional `depends_on` field per system, allowing e.g. a weapon to require a functioning reactor.

## Related docs

- `stack_decision.md` — confirms JSON and TypeScript as the format and language context.
- `resolver_design.md` — the module that consumes these files and runs the simulation.
- `v0_1_data_contracts.md` — the canonical v0.1 config and runtime shapes built on this file format.
- `ssd_layout.md` — the renderer that visualizes ships based on this data.
