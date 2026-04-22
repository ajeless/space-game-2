import type { BattleBoundary, BattleState, ShipInstanceId, Vector2 } from "./contracts.js";
import type { PlotPreview } from "./plot_preview.js";

export type TacticalCameraModeId = "player_centered" | "duel_fit" | "world_fixed";
export type TacticalZoomPresetId = "close" | "medium" | "wide";

export interface TacticalCameraSelection {
  mode_id: TacticalCameraModeId;
  zoom_preset_id: TacticalZoomPresetId;
}

export interface TacticalCameraViewport {
  width: number;
  height: number;
  padding: number;
}

export interface TacticalCameraModeDefinition {
  id: TacticalCameraModeId;
  label: string;
  short_label: string;
}

export interface TacticalZoomPresetDefinition {
  id: TacticalZoomPresetId;
  label: string;
  short_label: string;
  player_centered_vertical_half_span_world: number;
  duel_fit_padding_factor: number;
  world_fixed_boundary_factor: number;
}

export interface TacticalCamera {
  selection: TacticalCameraSelection;
  viewpoint_ship_instance_id: ShipInstanceId | null;
  center_world: Vector2;
  view_rotation_degrees: number;
  world_units_per_px: number;
  drawable: {
    min_x: number;
    max_x: number;
    min_y: number;
    max_y: number;
    width: number;
    height: number;
    center_x: number;
    center_y: number;
  };
  visible_world_bounds: {
    min: Vector2;
    max: Vector2;
  };
}

type RectangleBoundary = Extract<BattleBoundary, { kind: "rectangle" }>;

const MIN_WORLD_UNITS_PER_PX = 0.05;

export const TACTICAL_CAMERA_MODES: TacticalCameraModeDefinition[] = [
  {
    id: "player_centered",
    label: "Player Centered",
    short_label: "Self Scope"
  },
  {
    id: "duel_fit",
    label: "Duel Fit",
    short_label: "Duel Fit"
  },
  {
    id: "world_fixed",
    label: "World Fixed",
    short_label: "World"
  }
];

export const TACTICAL_ZOOM_PRESETS: TacticalZoomPresetDefinition[] = [
  {
    id: "close",
    label: "Close",
    short_label: "Close",
    player_centered_vertical_half_span_world: 80,
    duel_fit_padding_factor: 1.1,
    world_fixed_boundary_factor: 0.55
  },
  {
    id: "medium",
    label: "Medium",
    short_label: "Medium",
    player_centered_vertical_half_span_world: 120,
    duel_fit_padding_factor: 1.3,
    world_fixed_boundary_factor: 0.78
  },
  {
    id: "wide",
    label: "Wide",
    short_label: "Wide",
    player_centered_vertical_half_span_world: 180,
    duel_fit_padding_factor: 1.6,
    world_fixed_boundary_factor: 1
  }
];

function getModeDefinition(modeId: TacticalCameraModeId): TacticalCameraModeDefinition {
  return TACTICAL_CAMERA_MODES.find((mode) => mode.id === modeId) ?? TACTICAL_CAMERA_MODES[0]!;
}

function getZoomDefinition(zoomPresetId: TacticalZoomPresetId): TacticalZoomPresetDefinition {
  return TACTICAL_ZOOM_PRESETS.find((preset) => preset.id === zoomPresetId) ?? TACTICAL_ZOOM_PRESETS[1]!;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeDegrees(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function getDrawable(viewport: TacticalCameraViewport): TacticalCamera["drawable"] {
  const width = viewport.width - viewport.padding * 2;
  const height = viewport.height - viewport.padding * 2;

  return {
    min_x: viewport.padding,
    max_x: viewport.width - viewport.padding,
    min_y: viewport.padding,
    max_y: viewport.height - viewport.padding,
    width,
    height,
    center_x: viewport.padding + width / 2,
    center_y: viewport.padding + height / 2
  };
}

function getViewpointShipId(state: BattleState, preferredShipInstanceId: ShipInstanceId | null): ShipInstanceId | null {
  if (preferredShipInstanceId && state.ships[preferredShipInstanceId]) {
    return preferredShipInstanceId;
  }

  return state.match_setup.participants[0]?.ship_instance_id ?? null;
}

function getRectangleBoundaryCenter(boundary: RectangleBoundary): Vector2 {
  return {
    x: (boundary.min.x + boundary.max.x) / 2,
    y: (boundary.min.y + boundary.max.y) / 2
  };
}

function getBoundsFromPoints(points: Vector2[]): { min: Vector2; max: Vector2 } | null {
  if (points.length === 0) {
    return null;
  }

  let minX = points[0]!.x;
  let maxX = points[0]!.x;
  let minY = points[0]!.y;
  let maxY = points[0]!.y;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY }
  };
}

function getDuelFitPoints(state: BattleState, plotPreview: PlotPreview | null): Vector2[] {
  const points: Vector2[] = [];

  for (const participant of state.match_setup.participants) {
    const ship = state.ships[participant.ship_instance_id];

    if (!ship || ship.status !== "active") {
      continue;
    }

    points.push({ ...ship.pose.position });
  }

  if (plotPreview) {
    for (const sample of plotPreview.projected_path) {
      points.push({ ...sample.position });
    }

    points.push({ ...plotPreview.projected_pose.position });

    for (const cue of plotPreview.weapon_cues) {
      points.push({ ...cue.mount_position });

      if (cue.target_position) {
        points.push({ ...cue.target_position });
      }
    }
  }

  return points;
}

function getWorldUnitsPerPxForExtents(
  halfSpanX: number,
  halfSpanY: number,
  drawable: TacticalCamera["drawable"]
): number {
  return Math.max(halfSpanX / (drawable.width / 2), halfSpanY / (drawable.height / 2), MIN_WORLD_UNITS_PER_PX);
}

export function createDefaultTacticalCameraSelection(): TacticalCameraSelection {
  return {
    mode_id: "player_centered",
    zoom_preset_id: "medium"
  };
}

export function getTacticalCameraModeDefinition(modeId: TacticalCameraModeId): TacticalCameraModeDefinition {
  return getModeDefinition(modeId);
}

export function getTacticalZoomPresetDefinition(zoomPresetId: TacticalZoomPresetId): TacticalZoomPresetDefinition {
  return getZoomDefinition(zoomPresetId);
}

export function buildTacticalCamera(params: {
  state: BattleState;
  boundary: RectangleBoundary;
  viewport: TacticalCameraViewport;
  selection: TacticalCameraSelection;
  preferred_ship_instance_id: ShipInstanceId | null;
  plot_preview: PlotPreview | null;
}): TacticalCamera {
  const { state, boundary, viewport, selection, preferred_ship_instance_id: preferredShipId, plot_preview: plotPreview } =
    params;
  const drawable = getDrawable(viewport);
  const zoom = getZoomDefinition(selection.zoom_preset_id);
  const viewpointShipId = getViewpointShipId(state, preferredShipId);
  const viewpointShip = viewpointShipId ? state.ships[viewpointShipId] : null;
  const viewRotationDegrees = selection.mode_id === "player_centered" && viewpointShip ? viewpointShip.pose.heading_degrees : 0;
  let centerWorld = getRectangleBoundaryCenter(boundary);
  let worldUnitsPerPx = MIN_WORLD_UNITS_PER_PX;

  if (selection.mode_id === "player_centered" && viewpointShip) {
    centerWorld = { ...viewpointShip.pose.position };
    worldUnitsPerPx = zoom.player_centered_vertical_half_span_world / (drawable.height / 2);
  } else if (selection.mode_id === "duel_fit") {
    const points = getDuelFitPoints(state, plotPreview);
    const bounds = getBoundsFromPoints(points);

    if (bounds) {
      centerWorld = {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2
      };
      const halfSpanX = Math.max(40, ((bounds.max.x - bounds.min.x) / 2) * zoom.duel_fit_padding_factor);
      const halfSpanY = Math.max(40, ((bounds.max.y - bounds.min.y) / 2) * zoom.duel_fit_padding_factor);

      worldUnitsPerPx = getWorldUnitsPerPxForExtents(halfSpanX, halfSpanY, drawable);
    }
  } else {
    const halfSpanX = ((boundary.max.x - boundary.min.x) / 2) * zoom.world_fixed_boundary_factor;
    const halfSpanY = ((boundary.max.y - boundary.min.y) / 2) * zoom.world_fixed_boundary_factor;

    centerWorld = getRectangleBoundaryCenter(boundary);
    worldUnitsPerPx = getWorldUnitsPerPxForExtents(halfSpanX, halfSpanY, drawable);
  }

  const visibleHalfWidth = worldUnitsPerPx * (drawable.width / 2);
  const visibleHalfHeight = worldUnitsPerPx * (drawable.height / 2);

  return {
    selection,
    viewpoint_ship_instance_id: viewpointShipId,
    center_world: centerWorld,
    view_rotation_degrees: viewRotationDegrees,
    world_units_per_px: worldUnitsPerPx,
    drawable,
    visible_world_bounds: {
      min: {
        x: centerWorld.x - visibleHalfWidth,
        y: centerWorld.y - visibleHalfHeight
      },
      max: {
        x: centerWorld.x + visibleHalfWidth,
        y: centerWorld.y + visibleHalfHeight
      }
    }
  };
}

function rotateWorldVectorToView(camera: TacticalCamera, vector: Vector2): Vector2 {
  const radians = (camera.view_rotation_degrees * Math.PI) / 180;
  const starboard = {
    x: Math.cos(radians),
    y: -Math.sin(radians)
  };
  const forward = {
    x: Math.sin(radians),
    y: Math.cos(radians)
  };

  return {
    x: vector.x * starboard.x + vector.y * starboard.y,
    y: vector.x * forward.x + vector.y * forward.y
  };
}

function rotateViewVectorToWorld(camera: TacticalCamera, vector: Vector2): Vector2 {
  const radians = (camera.view_rotation_degrees * Math.PI) / 180;
  const starboard = {
    x: Math.cos(radians),
    y: -Math.sin(radians)
  };
  const forward = {
    x: Math.sin(radians),
    y: Math.cos(radians)
  };

  return {
    x: forward.x * vector.y + starboard.x * vector.x,
    y: forward.y * vector.y + starboard.y * vector.x
  };
}

export function worldToTacticalViewport(camera: TacticalCamera, point: Vector2): Vector2 {
  const relative = rotateWorldVectorToView(camera, {
    x: point.x - camera.center_world.x,
    y: point.y - camera.center_world.y
  });

  return {
    x: camera.drawable.center_x + relative.x / camera.world_units_per_px,
    y: camera.drawable.center_y - relative.y / camera.world_units_per_px
  };
}

export function tacticalViewportToWorld(camera: TacticalCamera, point: Vector2): Vector2 {
  const relative = {
    x: (point.x - camera.drawable.center_x) * camera.world_units_per_px,
    y: (camera.drawable.center_y - point.y) * camera.world_units_per_px
  };
  const worldDelta = rotateViewVectorToWorld(camera, relative);

  return {
    x: camera.center_world.x + worldDelta.x,
    y: camera.center_world.y + worldDelta.y
  };
}

export function getHeadingDegreesInTacticalCamera(camera: TacticalCamera, headingDegrees: number): number {
  return normalizeDegrees(headingDegrees - camera.view_rotation_degrees);
}

export function isWorldPointVisibleInTacticalCamera(
  camera: TacticalCamera,
  point: Vector2,
  insetPx = 0
): boolean {
  const projected = worldToTacticalViewport(camera, point);

  return (
    projected.x >= camera.drawable.min_x + insetPx &&
    projected.x <= camera.drawable.max_x - insetPx &&
    projected.y >= camera.drawable.min_y + insetPx &&
    projected.y <= camera.drawable.max_y - insetPx
  );
}

export function clampWorldPointToTacticalViewportEdge(
  camera: TacticalCamera,
  point: Vector2,
  insetPx = 0
): Vector2 {
  const projected = worldToTacticalViewport(camera, point);

  return {
    x: clamp(projected.x, camera.drawable.min_x + insetPx, camera.drawable.max_x - insetPx),
    y: clamp(projected.y, camera.drawable.min_y + insetPx, camera.drawable.max_y - insetPx)
  };
}

export function getTacticalCameraScaleBarWorldUnits(camera: TacticalCamera, targetPx = 110): number {
  const targetWorldUnits = camera.world_units_per_px * targetPx;

  if (targetWorldUnits <= 0) {
    return 0;
  }

  const exponent = Math.floor(Math.log10(targetWorldUnits));
  const magnitude = 10 ** exponent;
  const normalized = targetWorldUnits / magnitude;
  const step =
    normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;

  return step * magnitude;
}
