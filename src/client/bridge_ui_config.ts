// UI layout constants for the schematic viewport, tactical viewport, plot handles, and optional zoom controls toggle.
// Depends on: nothing. Consumed by: tactical_view, tactical_math, schematic_view, and src/client/main.ts.

export const SCHEMATIC_VIEWPORT = {
  width: 420,
  height: 620,
  centerX: 210,
  centerY: 262,
  scalePx: 208,
  hitWidth: 108,
  hitHeight: 38,
  bodyWidth: 76,
  bodyHeight: 28
} as const;

export const TACTICAL_VIEWPORT = {
  width: 960,
  height: 860,
  padding: 20,
  hullScalePx: 44,
  headingVectorLengthPx: 28,
  markerInsetPx: 22,
  scaleBarTargetPx: 112
} as const;

export const TACTICAL_PLOT_HANDLES = {
  thrustRadiusPx: 72,
  headingRadiusPx: 44,
  deadzonePx: 8
} as const;

// Keep zoom presets wired up in code, but ship the bridge on one stable tactical scale for now.
export const SHOW_TACTICAL_ZOOM_CONTROLS = false;
