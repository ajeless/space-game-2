# Planner UI And Tactical Camera

> Shipped planner/control behavior and the seams that keep it separate from resolver contracts.

**Status:** shipped `v0.2` presentation behavior  
**Scope:** client-side plotting controls, tactical camera behavior, and current config ownership  
**Last updated:** 2026-04-24

## Summary

The duel still uses the `v0.1` combat contracts, but the player does not interact with those contracts directly. The browser client exposes them through a bridge shell:

- tactical drag handles for burn and heading
- SSD trim sliders and a `Station Keep` shortcut
- SSD aim mode for weapon intent and charge selection
- a player-relative tactical scope with replay-aware camera settling

These are client concerns, not resolver rules. The important seam remains intact: the shared plot-authoring and preview logic own the actual authored values, while the browser client owns widgets, layout, and presentation tuning.

## Current shipped planner behavior

### Movement authoring

- Drag the thrust handle on the tactical scope to author world-space burn.
- Drag the heading handle on the projected ghost to set end-of-turn heading.
- Use the SSD `Turn`, `Axial Trim`, and `Lateral Trim` sliders for fine adjustment.
- Use `Station Keep` to null out drift with the current ship state.

### Weapon authoring

- Select a weapon mount on the SSD to enter `AIM MODE`.
- Click a tactical contact to assign or clear target lock for the selected mount.
- Set charge from the selected mount panel.
- Use `Clear Target` or `Esc` to stand the mount down or leave the panel.

### Plot lock behavior

- Once a plot is submitted, plotting stays locked until the replay for that exchange finishes.
- Replay lock and host-link loss both surface explicit notes in the SSD control deck.
- Non-weapon systems remain read-only in the shipped duel build.

## Current shipped camera behavior

- The tactical scope is player-relative and bow-up.
- The piloted ship stays centered on screen during normal plotting.
- Off-screen contacts stay visible through edge markers rather than camera autoscaling.
- A scale bar stays visible on the tactical scope.
- During replay, the player-centered camera eases from the resolved exchange back onto the live plotting frame instead of snapping abruptly.

## Current config seams

These files are the relevant sources of truth:

- `src/shared/tactical_camera.ts`
  Owns camera modes, zoom-preset math, and world-to-viewport transforms.
- `src/shared/plot_authoring.ts` and `src/shared/plot_preview.ts`
  Own authored plot normalization and preview logic.
- `src/client/bridge_ui_config.ts`
  Owns the current shipped schematic/tactical viewport sizes and tactical drag-handle radii.
- `src/client/bridge_dom_bindings.ts`
  Owns the mapping between rendered controls and plot-authoring mutations.

The current build does **not** load planner config from an external JSON file. The shipped seam is local code config, not resolver data.

## Zoom status

Discrete zoom presets still exist in shared camera code, but the shipped bridge hides the zoom controls and runs on one stable player-facing scale. That keeps the tactical picture steady while leaving a clear seam for later work if zoom control earns its place again.

## Deferred

- external planner/UI config files, if multiple rulesets or ship families ever need them
- replay-only camera modes or replay transport controls
- a decision on whether SSD trim sliders remain permanent, shrink, or disappear
- alternative tactical views or station-specific workspaces
