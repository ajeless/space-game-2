# SSD Layout

> Structural description of the shipped bridge shell, not an aspirational wireframe.

**Status:** shipped `v0.2` shell structure  
**Scope:** player-facing panel ownership and interaction layout  
**Last updated:** 2026-04-24

## Summary

The current bridge shell is a five-part layout:

1. mission bar across the top
2. schematic panel on the left
3. tactical panel on the right
4. action strip under the main play surface
5. footer strip for replay/feed/link state

The shell is intentionally stable and desktop-oriented. `v0.2` cleaned up clarity and workflow around this structure; it did not replace the shell with a new bridge model.

## Mission bar

The top bar communicates:

- current phase label
- turn number
- current station label
- situational status
- link status

`AIM MODE` is the main special state surfaced here. There is no countdown timer and no replay transport UI in the shipped bar.

## Left panel: schematic and control deck

The left panel owns ship identity, local system interaction, and plot authoring support.

### Schematic viewport

- hull silhouette and system placement come from ship data
- the heading compass stays in the schematic, while the schematic itself stays upright
- system buttons are the main local interaction surface
- weapon mounts are selectable and enter aim mode

### Control deck

The control deck below the viewport owns:

- `Turn`, `Axial Trim`, and `Lateral Trim`
- `Station Keep`
- selected-system detail
- selected-mount charge and target controls
- plot-lock notes during submit/replay/link-down states

Non-weapon systems are currently read-only detail panels.

## Right panel: tactical view

The right panel owns relative situational awareness and direct tactical plotting.

- player-relative, bow-up camera
- tactical drag handles for burn and heading
- projected ghost pose and path
- weapon arc and target overlays during aim mode
- off-screen contact markers
- scale bar

The shipped build keeps zoom controls hidden even though shared camera presets still exist under the hood.

## Action strip

The action strip sits below the two main panels.

### Readouts

- current turn
- drive allocation
- railgun allocation

### Actions

- `Reset Plot`
- `Submit Plot`
- claim-seat controls when the browser is acting as a spectator/reclaimer

During match end, this strip switches to post-duel status instead of live plot actions.

## Footer strip

The footer strip owns fast-changing match state that does not deserve primary panel space:

- current resolution summary
- replay progress bar when active
- combat feed
- bridge link message
- host tools entry point when reset access is available

## Outcome banner

When the duel ends, a dedicated outcome banner appears between the main panels and the action strip. The banner communicates victory/defeat plus the host reset expectation without replacing the rest of the shell.

## Deferred

- major visual/art-direction overhaul
- replay transport controls or replay-specific workspace changes
- responsive/mobile shell redesign
- dedicated host/admin workspace
- station-specific alternate views
