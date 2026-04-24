// Client-only math for translating pointer events into world-space plot updates and for centring the replay camera.
// Depends on: shared TacticalCamera/Vector2 types, bridge_ui_config viewport constants, resolution_playback state. Consumed by: src/client/main.ts and tactical_view.
// Invariant: functions are pure and must not read the DOM directly; pass in bounds/positions explicitly.

import type { ShipInstanceId, TacticalCamera, Vector2 } from "../shared/index.js";
import { TACTICAL_PLOT_HANDLES, TACTICAL_VIEWPORT } from "./bridge_ui_config.js";
import type { ResolutionPlaybackState, ResolutionPlaybackStep } from "./resolution_playback.js";

export function normalizeDegrees(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function getSvgViewportPoint(
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  clientX: number,
  clientY: number
): Vector2 {
  return {
    x: ((clientX - bounds.left) / bounds.width) * TACTICAL_VIEWPORT.width,
    y: ((clientY - bounds.top) / bounds.height) * TACTICAL_VIEWPORT.height
  };
}

export function getThrustDragWorldVector(input: {
  shipAnchor: Vector2;
  shipPosition: Vector2;
  pointer: Vector2;
  pointerWorld: Vector2;
}): Vector2 {
  const delta = {
    x: input.pointer.x - input.shipAnchor.x,
    y: input.pointer.y - input.shipAnchor.y
  };
  const distance = Math.hypot(delta.x, delta.y);
  const scale =
    distance <= TACTICAL_PLOT_HANDLES.deadzonePx ? 0 : Math.min(1, distance / TACTICAL_PLOT_HANDLES.thrustRadiusPx);
  const worldDelta = {
    x: input.pointerWorld.x - input.shipPosition.x,
    y: input.pointerWorld.y - input.shipPosition.y
  };
  const worldDistance = Math.hypot(worldDelta.x, worldDelta.y);
  const direction =
    worldDistance > 0 ? { x: worldDelta.x / worldDistance, y: worldDelta.y / worldDistance } : { x: 0, y: 0 };

  return {
    x: direction.x * scale,
    y: direction.y * scale
  };
}

export function getDraggedHeadingDegrees(input: {
  pointerWorld: Vector2;
  projectedPosition: Vector2;
  worldUnitsPerPx: number;
}): number | null {
  const delta = {
    x: input.pointerWorld.x - input.projectedPosition.x,
    y: input.pointerWorld.y - input.projectedPosition.y
  };
  const distance = Math.hypot(delta.x, delta.y) / input.worldUnitsPerPx;

  if (distance <= TACTICAL_PLOT_HANDLES.deadzonePx) {
    return null;
  }

  return normalizeDegrees((Math.atan2(delta.x, delta.y) * 180) / Math.PI);
}

function smoothstep(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));

  return clamped * clamped * (3 - 2 * clamped);
}

function withTacticalCameraView(
  camera: TacticalCamera,
  centerWorld: Vector2,
  viewRotationDegrees: number
): TacticalCamera {
  const visibleHalfWidth = camera.world_units_per_px * (camera.drawable.width / 2);
  const visibleHalfHeight = camera.world_units_per_px * (camera.drawable.height / 2);

  return {
    ...camera,
    center_world: centerWorld,
    view_rotation_degrees: normalizeDegrees(viewRotationDegrees),
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

export function getResolutionPlaybackCamera(input: {
  camera: TacticalCamera | null;
  playbackState: ResolutionPlaybackState | null;
  playbackStep: ResolutionPlaybackStep | null;
  preferredShipInstanceId: ShipInstanceId | null;
}): TacticalCamera | null {
  const { camera, playbackState, playbackStep, preferredShipInstanceId } = input;

  if (!camera || !playbackState || !playbackStep || camera.selection.mode_id !== "player_centered") {
    return camera;
  }

  const viewpointShipId = preferredShipInstanceId ?? camera.viewpoint_ship_instance_id;

  if (!viewpointShipId) {
    return camera;
  }

  const initialPose = playbackState.steps[0]?.ship_poses[viewpointShipId];
  const finalPose = playbackState.steps.at(-1)?.ship_poses[viewpointShipId];

  if (!initialPose || !finalPose) {
    return camera;
  }

  const transitionRatio = smoothstep(playbackStep.camera_transition_ratio);
  const currentPose = playbackStep.ship_poses[viewpointShipId] ?? finalPose;

  return withTacticalCameraView(
    camera,
    {
      x: initialPose.position.x + (finalPose.position.x - initialPose.position.x) * transitionRatio,
      y: initialPose.position.y + (finalPose.position.y - initialPose.position.y) * transitionRatio
    },
    currentPose.heading_degrees
  );
}
