import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPlotPreview,
  buildTacticalCamera,
  createDefaultTacticalCameraSelection,
  createPlotDraft,
  isWorldPointVisibleInTacticalCamera,
  tacticalViewportToWorld,
  validateBattleState
} from "../src/shared/index.js";
import { worldToTacticalViewport } from "../src/shared/tactical_camera.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function readBattleStateFixture() {
  return validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
}

const viewport = {
  width: 960,
  height: 560,
  padding: 36
} as const;

describe("tactical camera", () => {
  it("defaults to a player-centered medium scope around the displayed ship", async () => {
    const state = await readBattleStateFixture();
    const camera = buildTacticalCamera({
      state,
      boundary: state.match_setup.battlefield.boundary,
      viewport,
      selection: createDefaultTacticalCameraSelection(),
      preferred_ship_instance_id: "alpha_ship",
      plot_preview: null
    });

    expect(camera.center_world).toEqual(state.ships.alpha_ship!.pose.position);
    expect(isWorldPointVisibleInTacticalCamera(camera, state.ships.alpha_ship!.pose.position)).toBe(true);
    expect(isWorldPointVisibleInTacticalCamera(camera, state.ships.bravo_ship!.pose.position, 34)).toBe(false);
  });

  it("can widen the player-centered scope enough to bring the opponent onto the board", async () => {
    const state = await readBattleStateFixture();
    const selection = createDefaultTacticalCameraSelection();
    selection.zoom_preset_id = "wide";

    const camera = buildTacticalCamera({
      state,
      boundary: state.match_setup.battlefield.boundary,
      viewport,
      selection,
      preferred_ship_instance_id: "alpha_ship",
      plot_preview: null
    });

    expect(isWorldPointVisibleInTacticalCamera(camera, state.ships.bravo_ship!.pose.position, 34)).toBe(true);
  });

  it("keeps the piloted ship facing up for either player in the default player-centered scope", async () => {
    const state = await readBattleStateFixture();
    const alphaCamera = buildTacticalCamera({
      state,
      boundary: state.match_setup.battlefield.boundary,
      viewport,
      selection: createDefaultTacticalCameraSelection(),
      preferred_ship_instance_id: "alpha_ship",
      plot_preview: null
    });
    const bravoCamera = buildTacticalCamera({
      state,
      boundary: state.match_setup.battlefield.boundary,
      viewport,
      selection: createDefaultTacticalCameraSelection(),
      preferred_ship_instance_id: "bravo_ship",
      plot_preview: null
    });

    const alphaSelf = worldToTacticalViewport(alphaCamera, state.ships.alpha_ship!.pose.position);
    const alphaAhead = worldToTacticalViewport(alphaCamera, {
      x: state.ships.alpha_ship!.pose.position.x,
      y: state.ships.alpha_ship!.pose.position.y + 40
    });
    const bravoSelf = worldToTacticalViewport(bravoCamera, state.ships.bravo_ship!.pose.position);
    const bravoAhead = worldToTacticalViewport(bravoCamera, {
      x: state.ships.bravo_ship!.pose.position.x,
      y: state.ships.bravo_ship!.pose.position.y - 40
    });

    expect(alphaSelf.x).toBeCloseTo(alphaCamera.drawable.center_x, 6);
    expect(alphaSelf.y).toBeCloseTo(alphaCamera.drawable.center_y, 6);
    expect(alphaAhead.y).toBeLessThan(alphaSelf.y);
    expect(bravoSelf.x).toBeCloseTo(bravoCamera.drawable.center_x, 6);
    expect(bravoSelf.y).toBeCloseTo(bravoCamera.drawable.center_y, 6);
    expect(bravoAhead.y).toBeLessThan(bravoSelf.y);
  });

  it("round-trips viewport coordinates through the rotated player-centered camera transform", async () => {
    const state = await readBattleStateFixture();
    const camera = buildTacticalCamera({
      state,
      boundary: state.match_setup.battlefield.boundary,
      viewport,
      selection: createDefaultTacticalCameraSelection(),
      preferred_ship_instance_id: "bravo_ship",
      plot_preview: null
    });
    const projected = worldToTacticalViewport(camera, state.ships.alpha_ship!.pose.position);
    const roundTripped = tacticalViewportToWorld(camera, projected);

    expect(roundTripped.x).toBeCloseTo(state.ships.alpha_ship!.pose.position.x, 6);
    expect(roundTripped.y).toBeCloseTo(state.ships.alpha_ship!.pose.position.y, 6);
  });

  it("supports duel-fit mode for keeping both ships and the plotted motion in frame", async () => {
    const state = await readBattleStateFixture();
    const draft = createPlotDraft(state, "alpha_ship");

    draft.heading_delta_degrees = 20;
    draft.thrust_input = {
      lateral_fraction: 0.2,
      axial_fraction: 0.7
    };

    const preview = buildPlotPreview(state, draft);
    const camera = buildTacticalCamera({
      state,
      boundary: state.match_setup.battlefield.boundary,
      viewport,
      selection: {
        mode_id: "duel_fit",
        zoom_preset_id: "medium"
      },
      preferred_ship_instance_id: "alpha_ship",
      plot_preview: preview
    });

    expect(isWorldPointVisibleInTacticalCamera(camera, state.ships.alpha_ship!.pose.position, 34)).toBe(true);
    expect(isWorldPointVisibleInTacticalCamera(camera, state.ships.bravo_ship!.pose.position, 34)).toBe(true);
    expect(isWorldPointVisibleInTacticalCamera(camera, preview.projected_pose.position, 34)).toBe(true);
  });
});
