import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPlotSubmissionFromDraft,
  clearPlotDraftWeaponIntent,
  createPlotDraft,
  setPlotDraftWeaponTarget,
  setPlotDraftDesiredEndHeading,
  setPlotDraftWorldThrust,
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
  it("starts weapon mounts unassigned until a contact is selected", async () => {
    const state = await readBattleStateFixture();
    const summary = summarizePlotDraft(state, createPlotDraft(state, "alpha_ship"));

    expect(summary.draft.weapons).toEqual([
      {
        mount_id: "forward_mount",
        target_ship_instance_id: null,
        charge_pips: 0
      }
    ]);
  });

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

  it("maps a desired end heading into the existing delta-based draft model", async () => {
    const state = await readBattleStateFixture();
    const draft = createPlotDraft(state, "alpha_ship");
    state.ships.alpha_ship!.pose.heading_degrees = 350;

    const updated = setPlotDraftDesiredEndHeading(state, draft, 20);
    const summary = summarizePlotDraft(state, updated);

    expect(summary.draft.heading_delta_degrees).toBe(30);
    expect(summary.desired_end_heading_degrees).toBe(20);
  });

  it("maps a world-space burn vector into local thrust input", async () => {
    const state = await readBattleStateFixture();
    const draft = createPlotDraft(state, "alpha_ship");
    state.ships.alpha_ship!.pose.heading_degrees = 90;

    const updated = setPlotDraftWorldThrust(state, draft, {
      x: 1,
      y: 0
    });
    const summary = summarizePlotDraft(state, updated);

    expect(summary.draft.thrust_input.axial_fraction).toBeCloseTo(1, 10);
    expect(summary.draft.thrust_input.lateral_fraction).toBeCloseTo(0, 10);
    expect(summary.world_thrust_fraction.x).toBeCloseTo(1, 10);
    expect(summary.world_thrust_fraction.y).toBeCloseTo(0, 10);
  });

  it("can arm and explicitly clear a weapon target without reselecting a default contact", async () => {
    const state = await readBattleStateFixture();
    const draft = createPlotDraft(state, "alpha_ship");

    const targeted = setPlotDraftWeaponTarget(state, draft, "forward_mount", "bravo_ship");
    const targetedSummary = summarizePlotDraft(state, targeted);

    expect(targetedSummary.draft.weapons[0]).toEqual({
      mount_id: "forward_mount",
      target_ship_instance_id: "bravo_ship",
      charge_pips: 1
    });

    const cleared = clearPlotDraftWeaponIntent(state, targeted, "forward_mount");
    const clearedSummary = summarizePlotDraft(state, cleared);

    expect(clearedSummary.draft.weapons[0]).toEqual({
      mount_id: "forward_mount",
      target_ship_instance_id: null,
      charge_pips: 0
    });
  });
});
