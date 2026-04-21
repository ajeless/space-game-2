import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPlotSubmissionFromDraft,
  createPlotDraft,
  summarizePlotDraft,
  validateBattleState,
  validatePlotSubmission
} from "../src/shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function readBattleStateFixture() {
  return validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
}

describe("plot authoring", () => {
  it("builds a valid PlotSubmission from a direct-control draft", async () => {
    const state = await readBattleStateFixture();
    const draft = createPlotDraft(state, "alpha_ship");

    draft.heading_delta_degrees = 25;
    draft.thrust_input = {
      lateral_fraction: 0.2,
      axial_fraction: 0.75
    };
    draft.weapons[0] = {
      ...draft.weapons[0]!,
      charge_pips: 2,
      target_ship_instance_id: "bravo_ship"
    };

    const plot = buildPlotSubmissionFromDraft(state, draft);

    expect(plot.power).toEqual({
      drive_pips: 6,
      railgun_pips: 2
    });
    expect(plot.maneuver.desired_end_heading_degrees).toBe(25);
    expect(plot.weapons).toEqual([
      {
        mount_id: "forward_mount",
        target_ship_instance_id: "bravo_ship",
        fire_mode: "best_shot_this_turn",
        charge_pips: 2
      }
    ]);
    expect(validatePlotSubmission(plot, state)).toEqual(plot);
  });

  it("clamps overspecified draft commands back into legal authoring limits", async () => {
    const state = await readBattleStateFixture();
    const draft = createPlotDraft(state, "alpha_ship");

    draft.heading_delta_degrees = 999;
    draft.thrust_input = {
      lateral_fraction: 1,
      axial_fraction: 1
    };
    draft.weapons[0] = {
      ...draft.weapons[0]!,
      charge_pips: 9,
      target_ship_instance_id: "bravo_ship"
    };

    const summary = summarizePlotDraft(state, draft);

    expect(summary.draft.heading_delta_degrees).toBe(120);
    expect(summary.draft.weapons[0]?.charge_pips).toBe(3);
    expect(summary.power).toEqual({
      drive_pips: 5,
      railgun_pips: 3
    });
    expect(Math.hypot(summary.draft.thrust_input.lateral_fraction, summary.draft.thrust_input.axial_fraction)).toBeCloseTo(
      1,
      10
    );
  });
});
