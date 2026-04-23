import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildResolutionPlaybackState } from "../src/client/resolution_playback.js";
import { resolve, validateBattleState, validatePlotSubmission } from "../src/shared/index.js";
import type { MatchSessionView, PlotSubmission } from "../src/shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function readBattleStateFixture() {
  return validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
}

function makeSessionView(input: {
  previousState: Awaited<ReturnType<typeof readBattleStateFixture>>;
  nextState: Awaited<ReturnType<typeof readBattleStateFixture>>;
  events: ReturnType<typeof resolve>["events"];
}): MatchSessionView {
  return {
    battle_state: input.nextState,
    pending_plot_ship_ids: [],
    occupied_slot_ids: input.previousState.match_setup.participants.map((participant) => participant.slot_id),
    slot_states: input.previousState.match_setup.participants.map((participant) => ({
      slot_id: participant.slot_id,
      ship_instance_id: participant.ship_instance_id,
      connection_state: "connected" as const
    })),
    last_resolution: {
      resolved_from_turn_number: input.previousState.turn_number,
      event_count: input.events.length,
      events: input.events
    }
  };
}

function makeIdlePlan() {
  return {
    kind: "piecewise_linear" as const,
    frame: "world" as const,
    knots: [
      { t: 0, thrust_fraction: { x: 0, y: 0 } },
      { t: 1, thrust_fraction: { x: 0, y: 0 } }
    ]
  };
}

function makePlot(
  state: Awaited<ReturnType<typeof readBattleStateFixture>>,
  input: {
    ship_instance_id: string;
    drive_pips: number;
    railgun_pips: number;
    desired_end_heading_degrees: number;
    weapons: PlotSubmission["weapons"];
  }
) {
  return validatePlotSubmission(
    {
      schema_version: "sg2/v0.1",
      match_id: state.match_setup.match_id,
      turn_number: state.turn_number,
      ship_instance_id: input.ship_instance_id,
      power: {
        drive_pips: input.drive_pips,
        railgun_pips: input.railgun_pips
      },
      maneuver: {
        desired_end_heading_degrees: input.desired_end_heading_degrees,
        translation_plan: makeIdlePlan()
      },
      weapons: input.weapons
    },
    state
  );
}

describe("resolution playback", () => {
  it("builds a motion replay for quiet turns and holds the turn-ended summary separately", async () => {
    const previousState = await readBattleStateFixture();
    const alphaPlot = validatePlotSubmission(await readJson("fixtures/plots/alpha_turn_1.json"), previousState);
    const bravoPlot = validatePlotSubmission(await readJson("fixtures/plots/bravo_turn_1.json"), previousState);
    const result = resolve({
      state: structuredClone(previousState),
      plots_by_ship: {
        alpha_ship: alphaPlot,
        bravo_ship: bravoPlot
      },
      seed: "turn-1-seed"
    });
    const sessionView = makeSessionView({
      previousState,
      nextState: result.next_state,
      events: result.events
    });
    const playback = buildResolutionPlaybackState({
      sessionValue: sessionView,
      previousBattleState: previousState
    });

    expect(playback).not.toBeNull();
    expect(playback?.steps[0]).toMatchObject({
      kind: "motion",
      display_sub_tick: 0,
      focus_event: null
    });
    expect(playback?.steps.some((step) => step.kind === "settle")).toBe(true);
    expect(playback?.steps[1]?.ship_poses.alpha_ship?.position).not.toEqual(previousState.ships.alpha_ship?.pose.position);
    expect(playback?.steps.at(-1)).toMatchObject({
      kind: "event",
      display_sub_tick: 60,
      focus_event: expect.objectContaining({
        type: "turn_ended"
      })
    });
  });

  it("captures drift-only motion from zero-thrust dynamics samples", async () => {
    const previousState = await readBattleStateFixture();

    previousState.ships.alpha_ship!.pose.velocity = { x: 0.2, y: 0 };
    previousState.ships.bravo_ship!.pose.velocity = { x: 0, y: 0 };

    const result = resolve({
      state: structuredClone(previousState),
      plots_by_ship: {
        alpha_ship: makePlot(previousState, {
          ship_instance_id: "alpha_ship",
          drive_pips: 8,
          railgun_pips: 0,
          desired_end_heading_degrees: previousState.ships.alpha_ship!.pose.heading_degrees,
          weapons: []
        }),
        bravo_ship: makePlot(previousState, {
          ship_instance_id: "bravo_ship",
          drive_pips: 8,
          railgun_pips: 0,
          desired_end_heading_degrees: previousState.ships.bravo_ship!.pose.heading_degrees,
          weapons: []
        })
      },
      seed: "drift-only-replay"
    });
    const sessionView = makeSessionView({
      previousState,
      nextState: result.next_state,
      events: result.events
    });
    const playback = buildResolutionPlaybackState({
      sessionValue: sessionView,
      previousBattleState: previousState
    });

    expect(playback?.steps[1]?.ship_poses.alpha_ship?.position.x).toBeGreaterThan(
      previousState.ships.alpha_ship!.pose.position.x
    );
    expect(playback?.steps.at(-2)?.kind).toBe("settle");
    expect(playback?.steps.at(-1)?.focus_event?.type).toBe("turn_ended");
  });

  it("preserves distinct focus events even when they happen on the same sub-tick", async () => {
    const previousState = await readBattleStateFixture();

    previousState.match_setup.rules.damage.local_hit_resolution.radius_hull_units = 0.2;
    previousState.ships.alpha_ship!.pose.position = { x: 0, y: -100 };
    previousState.ships.alpha_ship!.pose.heading_degrees = 0;
    previousState.ships.bravo_ship!.pose.position = { x: 0, y: 0 };
    previousState.ships.bravo_ship!.pose.heading_degrees = 0;
    previousState.ships.bravo_ship!.systems.drive!.current_integrity = 20;

    const result = resolve({
      state: structuredClone(previousState),
      plots_by_ship: {
        alpha_ship: makePlot(previousState, {
          ship_instance_id: "alpha_ship",
          drive_pips: 5,
          railgun_pips: 3,
          desired_end_heading_degrees: 0,
          weapons: [
            {
              mount_id: "forward_mount",
              target_ship_instance_id: "bravo_ship",
              fire_mode: "best_shot_this_turn",
              charge_pips: 3
            }
          ]
        }),
        bravo_ship: makePlot(previousState, {
          ship_instance_id: "bravo_ship",
          drive_pips: 8,
          railgun_pips: 0,
          desired_end_heading_degrees: 0,
          weapons: []
        })
      },
      seed: "combat-seed-1"
    });
    const sessionView = makeSessionView({
      previousState,
      nextState: result.next_state,
      events: result.events
    });
    const playback = buildResolutionPlaybackState({
      sessionValue: sessionView,
      previousBattleState: previousState
    });
    const eventTypes = playback?.steps
      .filter((step) => step.kind === "event")
      .map((step) => step.focus_event?.type);

    expect(eventTypes).toEqual(["weapon_fired", "hit_registered", "subsystem_damaged", "turn_ended"]);
  });
});
