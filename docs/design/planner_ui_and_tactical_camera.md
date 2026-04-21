# Planner UI and Tactical Camera — v0.1

> Created in this repository on 2026-04-21.
> This doc records the planner-control and tactical-camera decisions that sit beside the core combat contracts.

**Status:** decided (direction), working contract draft  
**Scope:** v0.1 planner UI, tactical camera, and player-facing terminology  
**Last updated:** 2026-04-21

## Summary

The planner UI should be data-driven, but it should not be folded into resolver rules or battle-state payloads. `MatchRulesConfig`, `ShipConfig`, `BattleState`, and `PlotSubmission` remain the combat contracts. A separate planner/UI data layer defines how those contracts are exposed to the player: control labels, widget types, step sizes, grouping, ordering, zoom presets, and other presentational affordances.

The tactical viewport should behave like a relative sensor scope rather than a tiny absolute map. In normal play, the player's ship stays centered, contacts are shown relative to it, zoom is chosen from discrete player-controlled levels, and off-screen contacts are represented with edge markers rather than continuous autoscaling.

## Decisions

1. **Planner controls are configurable from data.** Labels, units, widget types, increments, visibility, and grouping should come from a data file, not from hard-coded UI-only assumptions.
2. **Planner UI config is separate from resolver config.** Combat math does not need to know whether a value came from a slider, stepper, toggle, keyboard shortcut, or other widget.
3. **The tactical view is player-relative by default.** The ship being piloted anchors the tactical scope; the scope is not an absolute world map.
4. **Zoom is discrete and player-controlled.** No continuous auto-rescale during plotting or aim mode.
5. **Off-screen contacts stay represented.** If a contact is outside the current zoom window, the UI shows an edge marker with range and bearing rather than silently losing it.
6. **Boundary rules still exist in world space.** A relative camera does not remove disengagement or battlefield geometry from the simulation.
7. **`Lateral Burn` replaces `Beam Trim`.** The old term was too easy to misread as a weapon or optics adjustment rather than sideways translational thrust.

## Planner UI data layer

The planner UI should eventually load from its own config file, likely one per ruleset or ship family. The shape below is intentionally a companion contract, not a resolver input contract.

```typescript
type PlannerWidgetKind = "slider" | "stepper" | "toggle" | "select";

interface PlannerUiConfig {
  schema_version: "sg2/v0.1";
  id: string;
  terminology: {
    heading_delta_label: string;
    axial_thrust_label: string;
    lateral_thrust_label: string;
  };
  control_groups: PlannerControlGroup[];
  tactical_camera: TacticalCameraConfig;
}

interface PlannerControlGroup {
  id: string;
  label: string;
  order: number;
  controls: PlannerControl[];
}

interface PlannerControlBase {
  id: string;
  label: string;
  widget: PlannerWidgetKind;
  binding:
    | "heading_delta_degrees"
    | "thrust_input.axial_fraction"
    | "thrust_input.lateral_fraction"
    | `weapon.${string}.charge_pips`
    | `weapon.${string}.fire_intent`;
  help_text?: string;
  visible_when?: string;
}

interface PlannerSliderControl extends PlannerControlBase {
  widget: "slider";
  min: number;
  max: number;
  step: number;
  snap_points?: number[];
  units?: string;
}

interface PlannerStepperControl extends PlannerControlBase {
  widget: "stepper";
  values: number[];
  units?: string;
}

interface PlannerToggleControl extends PlannerControlBase {
  widget: "toggle";
}

interface PlannerSelectControl extends PlannerControlBase {
  widget: "select";
  options: Array<{ value: string; label: string }>;
}

type PlannerControl =
  | PlannerSliderControl
  | PlannerStepperControl
  | PlannerToggleControl
  | PlannerSelectControl;
```

### What belongs in planner UI data

- labels, units, and help text
- widget kind
- min / max / step
- snap points or enumerated choices
- control ordering and grouping
- default visibility and mode-specific visibility
- zoom presets and camera defaults

### What does not belong in planner UI data

- hit probability math
- damage rules
- turn cap math
- weapon timing rules
- arbitrary executable expressions
- battle-state authority or networking rules

The important seam is this: the planner UI config chooses how to present a control, but the shared plot-authoring logic still owns validation and normalization.

## Tactical camera policy

### Relative scope

The main tactical view should show the world relative to the player's ship. During plot phase and aim mode:

- the player's ship stays at the center of the tactical viewport
- enemy contacts are rendered at relative positions and velocities
- projected motion and shot overlays are drawn in the same relative frame

The simulation still runs in absolute world coordinates. The relative scope is a view transform, not a simulation change.

### Discrete zoom

The player should choose zoom from a small set of stable presets rather than by continuous frame-to-frame autoscaling.

Recommended v0.1 direction:

- default zoom preset: `medium`
- additional presets: `close` and `wide`
- zoom remains stable during the current plot / aim / execute cycle unless the player explicitly changes it

This preserves spatial legibility. If scale changes every time the target drifts slightly, the player loses the ability to build intuition about motion and range.

### Off-screen contacts

When a contact would leave the visible scope at the chosen zoom:

- show an edge marker on the viewport frame
- indicate bearing relative to the player's ship
- show current range to the contact
- keep the contact selectable when interaction mode makes that necessary

This is the preferred answer to "enemy drifted out of frame," not silent rescaling and not removing boundaries from the game.

### Battlefield boundary cues

If the match uses a disengagement boundary, the tactical UI should still expose it even in a player-centered scope. Good v0.1 cues include:

- boundary direction from the player ship
- distance to nearest boundary edge
- a boundary warning state when plotted motion would cross it

The camera should not pretend the boundary no longer exists just because the player ship is centered.

## Terminology

### `Turn`

Rotational command. Changes heading only.

### `Axial Burn`

Fore-aft translational thrust along the ship's longitudinal axis.

### `Lateral Burn`

Port-starboard translational thrust across the ship's beam. This replaces `Beam Trim` in the player-facing UI.

### `Viewport-up reference`

The tactical display still has an up direction on screen, but that is a display convention, not "north in space." Heading is a 0-360 degree value relative to that display reference.

## Deferred

- exact file location and loading rules for planner UI config
- whether zoom presets are numeric scale factors, named presets, or both
- whether execute phase keeps the player's chosen zoom or offers an optional replay-only fit mode
- exact off-screen marker art and interaction affordances
- whether a secondary mini-scope or inset radar is worth the additional chrome in v0.1

## Related docs

- `v0_1_data_contracts.md` — combat contracts that the planner UI edits and displays
- `ssd_layout.md` — structural UI layout and interaction model
- `ship_definition_format.md` — ship data that drives schematic rendering
