# Layout And Hit Model

**Audience:** developers, future contributors, future-you
**Status:** design-direction document
**Last updated:** 2026-04-21

## Why this doc exists

The ship data model has to satisfy four goals at the same time:

1. make `v0.1` easy to implement
2. keep the SSD honest as a representation of a real ship
3. preserve future ship-configuration and refit mechanics
4. allow hit resolution to get smarter later without schema churn

The core decision is simple:

- `physical_position` is canonical gameplay data
- `ssd_position` is an optional visual override
- hit resolution uses physical data only

Everything else follows from that.

## Core concepts

### `physical_position`

Where the system really is on the ship in hull-local coordinates.

Uses:

- local hit resolution
- future armor / compartment / adjacency logic
- future ship-design and refit mechanics
- default SSD placement

This is the field that changes when a player makes a *real* mechanical change to their ship.

### `ssd_position`

Optional UI/render anchor for the system on the Ship System Display.

Uses:

- visual legibility
- label spacing
- control overlap avoidance
- future stylistic variants of the same ship art

If omitted, the SSD should render the system at `physical_position`.

This is the field that changes when you want a *cosmetic* layout tweak without changing gameplay.

### `hit_profile`

Optional richer footprint for local-hit logic.

`v0.1` does not need custom per-system hit shapes, but the model should allow them later. Examples:

- circle
- ellipse
- polygon
- compartment reference

If `hit_profile` is absent, the `v0.1` resolver can treat the system as a point with a shared nearby-hit radius.

## Default behavior

The default case should stay simple.

```json
{
  "id": "reactor",
  "type": "reactor",
  "physical_position": { "x": 0, "y": 0.25 },
  "max_integrity": 32,
  "parameters": { "discretionary_pips": 8 }
}
```

This implies:

- the reactor is mechanically located at `(0, 0.25)`
- the SSD draws it there too
- if a hit lands near that point, the reactor may take local subsystem damage

That should be the common case in `v0.1`.

## Cosmetic override example

Sometimes the honest physical location is slightly awkward for UI layout. That is what `ssd_position` is for.

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

Effects:

- the bridge is still mechanically at `(0, -0.02)`
- local hit resolution still uses `(0, -0.02)`
- the SSD draws it slightly offset for readability

This is a cosmetic layout change, not a balance change.

## Mechanical refit example

If a later ship designer lets players move a mount to the port side, that is a mechanical edit.

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

Effects:

- the SSD should now draw the mount at the new port-side location by default
- the arc center and firing geometry change
- local hit vulnerability changes
- the ship is mechanically different

That is why `physical_position` must stay canonical.

## Future richer hit footprints

The simplest upgrade path for smarter damage resolution is:

1. `v0.1`: nearest system within shared radius
2. later: optional `hit_profile`
3. later still: compartments, armor zones, adjacency, blast propagation

Example:

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

This does not require replacing the schema. It only makes use of an optional field that the early resolver can ignore.

## Rules for contributors

If you are changing ship data or layout code, keep these rules in mind:

1. Never let cosmetic SSD edits silently change combat behavior.
2. Resolver code should read `physical_position`, not `ssd_position`.
3. Renderer code should default `ssd_position` to `physical_position`.
4. Future tooling should distinguish between:
   - cosmetic layout edit
   - mechanical configuration edit
5. New subsystem types should fit into the same model instead of creating a one-off layout system.

## Recommended data direction

For ship systems, the long-term shape should move toward:

```json
{
  "id": "reactor",
  "type": "reactor",
  "physical_position": { "x": 0, "y": 0.25 },
  "ssd_position": { "x": 0, "y": 0.25 },
  "hit_profile": {
    "shape": "circle",
    "radius": 0.08
  },
  "max_integrity": 32,
  "parameters": {
    "discretionary_pips": 8
  },
  "render": {
    "label": "REACTOR"
  }
}
```

`v0.1` does not need every field populated. The important thing is to keep the seam lines clean from the start.

## Related docs

- [Ship definition format](../design/ship_definition_format.md)
- [Resolver design](../design/resolver_design.md)
- [SSD layout](../design/ssd_layout.md)
