import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPlotPreview,
  createPlotDraft,
  resolve,
  validateBattleState,
  validatePlotSubmission
} from "../src/shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function readBattleStateFixture(relativePath = "fixtures/battle_states/default_duel_turn_1.json") {
  return validateBattleState(await readJson(relativePath));
}

describe("plot preview", () => {
  it("projects a full-turn path and final pose from the authored draft", async () => {
    const state = await readBattleStateFixture();
    const draft = createPlotDraft(state, "alpha_ship");

    draft.heading_delta_degrees = 30;
    draft.thrust_input = {
      lateral_fraction: 0.1,
      axial_fraction: 0.7
    };

    const preview = buildPlotPreview(state, draft);

    expect(preview.projected_path).toHaveLength(state.match_setup.rules.turn.sub_ticks + 1);
    expect(preview.projected_path[0]?.position).toEqual({ x: -120, y: 0 });
    expect(preview.projected_pose.heading_degrees).toBeCloseTo(30, 10);
    expect(preview.projected_pose.position.y).toBeGreaterThan(state.ships.alpha_ship!.pose.position.y);
    expect(preview.projected_pose.position.x).toBeGreaterThan(state.ships.alpha_ship!.pose.position.x);
  });

  it("keeps an unarmed mount cue available for passive arc rendering without forcing a target", async () => {
    const state = await readBattleStateFixture();
    const preview = buildPlotPreview(state, createPlotDraft(state, "alpha_ship"));

    expect(preview.weapon_cues).toHaveLength(1);
    expect(preview.weapon_cues[0]).toMatchObject({
      mount_id: "forward_mount",
      target_ship_instance_id: null,
      charge_pips: 0,
      target_position: null,
      predicted_hit_probability: null
    });
    expect(preview.weapon_cues[0]?.arc_visual_range_km).toBeGreaterThan(0);
  });

  it("builds targeting cues for charged mounts against the selected target", async () => {
    const state = await readBattleStateFixture();
    const draft = createPlotDraft(state, "alpha_ship");

    state.ships.alpha_ship!.pose.position = { x: 0, y: -90 };
    state.ships.alpha_ship!.pose.heading_degrees = 0;
    state.ships.bravo_ship!.pose.position = { x: 0, y: 0 };
    state.ships.bravo_ship!.pose.heading_degrees = 180;
    draft.weapons[0] = {
      ...draft.weapons[0]!,
      charge_pips: 2,
      target_ship_instance_id: "bravo_ship"
    };

    const preview = buildPlotPreview(state, draft);

    expect(preview.weapon_cues).toHaveLength(1);
    expect(preview.weapon_cues[0]).toMatchObject({
      mount_id: "forward_mount",
      target_ship_instance_id: "bravo_ship",
      charge_pips: 2,
      effective_charge_pips: 2,
      max_range_km: 220,
      arc_visual_range_km: 220,
      target_in_arc: true,
      target_in_range: true
    });
    expect(preview.weapon_cues[0]?.predicted_hit_probability).not.toBeNull();
    expect(preview.weapon_cues[0]?.best_fire_sub_tick).not.toBeNull();
  });

  it("reflects degraded-mount charge penalties after the close-action opening exchange", async () => {
    const state = await readBattleStateFixture("fixtures/battle_states/close_action_duel_turn_1.json");
    const alphaPlot = validatePlotSubmission(await readJson("fixtures/plots/close_action_alpha_turn_1.json"), state);
    const bravoPlot = validatePlotSubmission(await readJson("fixtures/plots/close_action_bravo_turn_1.json"), state);
    const resolved = resolve({
      state: structuredClone(state),
      plots_by_ship: {
        alpha_ship: alphaPlot,
        bravo_ship: bravoPlot
      },
      seed: `${state.match_setup.seed_root}:turn:${state.turn_number}`
    });
    const draft = createPlotDraft(resolved.next_state, "alpha_ship");

    draft.weapons[0] = {
      ...draft.weapons[0]!,
      charge_pips: 3,
      target_ship_instance_id: "bravo_ship"
    };

    const preview = buildPlotPreview(resolved.next_state, draft);

    expect(preview.weapon_cues[0]).toMatchObject({
      mount_id: "forward_mount",
      target_ship_instance_id: "bravo_ship",
      charge_pips: 3,
      effective_charge_pips: 2,
      max_range_km: 220,
      target_in_arc: true,
      target_in_range: true,
      firing_enabled: true
    });
    expect(preview.weapon_cues[0]?.predicted_hit_probability).toBeCloseTo(0.4256421865369799, 10);
  });
});
