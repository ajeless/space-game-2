import { describe, expect, it } from "vitest";
import { getDraggedHeadingDegrees, getResolutionPlaybackCamera, getThrustDragWorldVector } from "../src/client/tactical_math.js";
import type { ResolutionPlaybackState, ResolutionPlaybackStep } from "../src/client/resolution_playback.js";
import type { TacticalCamera } from "../src/shared/index.js";

function makeCamera(): TacticalCamera {
  return {
    selection: {
      mode_id: "player_centered",
      zoom_preset_id: "medium"
    },
    viewpoint_ship_instance_id: "alpha_ship",
    center_world: { x: 0, y: 0 },
    view_rotation_degrees: 0,
    world_units_per_px: 1,
    drawable: {
      min_x: 20,
      max_x: 940,
      min_y: 20,
      max_y: 840,
      width: 920,
      height: 820,
      center_x: 480,
      center_y: 430
    },
    visible_world_bounds: {
      min: { x: -460, y: -410 },
      max: { x: 460, y: 410 }
    }
  };
}

function makePlaybackStep(overrides: Partial<ResolutionPlaybackStep> = {}): ResolutionPlaybackStep {
  return {
    kind: "motion",
    duration_ms: 100,
    display_sub_tick: 4,
    total_sub_ticks: 60,
    ship_poses: {
      alpha_ship: {
        position: { x: 50, y: 25 },
        velocity: { x: 0, y: 0 },
        heading_degrees: 270
      }
    },
    focus_event: null,
    focus_event_index: null,
    focus_event_count: 0,
    exchange_event_index: null,
    exchange_event_count: 0,
    camera_transition_ratio: 0.5,
    progress_ratio: 0.5,
    ...overrides
  };
}

function makePlaybackState(step: ResolutionPlaybackStep): ResolutionPlaybackState {
  return {
    key: "test-resolution",
    resolved_from_turn_number: 1,
    current_step_index: 1,
    steps: [
      {
        ...step,
        ship_poses: {
          alpha_ship: {
            position: { x: 0, y: 0 },
            velocity: { x: 0, y: 0 },
            heading_degrees: 0
          }
        }
      },
      step,
      {
        ...step,
        ship_poses: {
          alpha_ship: {
            position: { x: 100, y: 50 },
            velocity: { x: 0, y: 0 },
            heading_degrees: 180
          }
        }
      }
    ]
  };
}

describe("tactical math helpers", () => {
  it("keeps thrust in the deadzone at zero", () => {
    expect(
      getThrustDragWorldVector({
        shipAnchor: { x: 200, y: 200 },
        shipPosition: { x: 0, y: 0 },
        pointer: { x: 204, y: 205 },
        pointerWorld: { x: 6, y: 8 }
      })
    ).toEqual({ x: 0, y: 0 });
  });

  it("clamps thrust drag magnitude while preserving the world-space direction", () => {
    expect(
      getThrustDragWorldVector({
        shipAnchor: { x: 0, y: 0 },
        shipPosition: { x: 0, y: 0 },
        pointer: { x: 200, y: 0 },
        pointerWorld: { x: 3, y: 4 }
      })
    ).toEqual({
      x: 0.6,
      y: 0.8
    });
  });

  it("ignores heading drags inside the deadzone and normalizes the resulting bearing", () => {
    expect(
      getDraggedHeadingDegrees({
        pointerWorld: { x: 0.01, y: 0.01 },
        projectedPosition: { x: 0, y: 0 },
        worldUnitsPerPx: 1
      })
    ).toBeNull();

    expect(
      getDraggedHeadingDegrees({
        pointerWorld: { x: -20, y: 0 },
        projectedPosition: { x: 0, y: 0 },
        worldUnitsPerPx: 1
      })
    ).toBe(270);
  });

  it("interpolates the replay camera toward the settled ship position for player-centered playback", () => {
    const playbackStep = makePlaybackStep();
    const camera = getResolutionPlaybackCamera({
      camera: makeCamera(),
      playbackState: makePlaybackState(playbackStep),
      playbackStep,
      preferredShipInstanceId: "alpha_ship"
    });

    expect(camera?.center_world).toEqual({ x: 50, y: 25 });
    expect(camera?.view_rotation_degrees).toBe(270);
    expect(camera?.visible_world_bounds).toEqual({
      min: { x: -410, y: -385 },
      max: { x: 510, y: 435 }
    });
  });
});
