import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolve, validateBattleState, validatePlotSubmission } from "../src/shared/index.js";
import type { PlotSubmission } from "../src/shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function readBattleStateFixture() {
  return validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
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

describe("resolver", () => {
  it("advances the turn with deterministic motion and no legal shots in the default duel", async () => {
    const state = await readBattleStateFixture();
    const alphaPlot = validatePlotSubmission(await readJson("fixtures/plots/alpha_turn_1.json"), state);
    const bravoPlot = validatePlotSubmission(await readJson("fixtures/plots/bravo_turn_1.json"), state);
    const inputState = structuredClone(state);
    const result = resolve({
      state: inputState,
      plots_by_ship: {
        bravo_ship: bravoPlot,
        alpha_ship: alphaPlot
      },
      seed: "turn-1-seed"
    });

    expect(inputState.turn_number).toBe(1);
    expect(result.next_state.turn_number).toBe(2);
    expect(result.next_state.ships.alpha_ship?.pose.heading_degrees).toBeCloseTo(15, 10);
    expect(result.next_state.ships.bravo_ship?.pose.heading_degrees).toBeCloseTo(195, 10);
    expect(result.next_state.ships.alpha_ship?.pose.position.y ?? 0).toBeLessThan(
      state.ships.alpha_ship?.pose.position.y ?? 0
    );
    expect(result.next_state.ships.alpha_ship?.pose.position.x ?? 0).toBeGreaterThan(
      state.ships.alpha_ship?.pose.position.x ?? 0
    );
    expect(result.next_state.ships.bravo_ship?.pose.position.y ?? 0).toBeGreaterThan(
      state.ships.bravo_ship?.pose.position.y ?? 0
    );
    expect(result.next_state.ships.bravo_ship?.pose.position.x ?? 0).toBeLessThan(
      state.ships.bravo_ship?.pose.position.x ?? 0
    );
    const thrustEvents = result.events.filter((event) => event.type === "thrust_applied");

    expect(thrustEvents).toHaveLength(120);
    expect(result.events.filter((event) => event.type === "weapon_fired")).toHaveLength(0);
    expect(result.events.filter((event) => event.type === "hit_registered")).toHaveLength(0);
    expect(result.events).toHaveLength(123);
    expect(result.events[0]).toMatchObject({
      sub_tick: 0,
      type: "plot_committed",
      actor: "alpha_ship"
    });
    expect(result.events[2]).toMatchObject({
      sub_tick: 0,
      type: "thrust_applied",
      actor: "alpha_ship"
    });
    expect(result.events[3]).toMatchObject({
      sub_tick: 0,
      type: "thrust_applied",
      actor: "bravo_ship"
    });
    expect(result.events[result.events.length - 1]).toMatchObject({
      sub_tick: 60,
      type: "turn_ended",
      details: {
        turnNumber: 2,
        winner: null
      }
    });
  });

  it("rejects missing active-ship plots", async () => {
    const state = await readBattleStateFixture();
    const alphaPlot = validatePlotSubmission(await readJson("fixtures/plots/alpha_turn_1.json"), state);

    expect(() =>
      resolve({
        state,
        plots_by_ship: {
          alpha_ship: alphaPlot
        },
        seed: "turn-1-seed"
      })
    ).toThrow("missing plot");
  });

  it("applies deterministic local subsystem damage when a planned shot hits", async () => {
    const state = await readBattleStateFixture();

    state.match_setup.rules.damage.local_hit_resolution.radius_hull_units = 0.2;
    state.ships.alpha_ship!.pose.position = { x: 0, y: -100 };
    state.ships.alpha_ship!.pose.heading_degrees = 0;
    state.ships.bravo_ship!.pose.position = { x: 0, y: 0 };
    state.ships.bravo_ship!.pose.heading_degrees = 0;
    state.ships.bravo_ship!.systems.drive!.current_integrity = 20;

    const result = resolve({
      state,
      plots_by_ship: {
        alpha_ship: makePlot(state, {
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
        bravo_ship: makePlot(state, {
          ship_instance_id: "bravo_ship",
          drive_pips: 8,
          railgun_pips: 0,
          desired_end_heading_degrees: 0,
          weapons: []
        })
      },
      seed: "combat-seed-1"
    });

    expect(result.events).toContainEqual(
      expect.objectContaining({
        sub_tick: 0,
        type: "weapon_fired",
        actor: "alpha_ship",
        target: "bravo_ship"
      })
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        sub_tick: 0,
        type: "hit_registered",
        target: "bravo_ship",
        details: expect.objectContaining({
          fromActor: "alpha_ship",
          impactSystemId: "drive",
          hullDamageApplied: 15,
          subsystemDamageApplied: 9
        })
      })
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        sub_tick: 0,
        type: "subsystem_damaged",
        actor: "bravo_ship",
        details: expect.objectContaining({
          systemId: "drive",
          previousState: "operational",
          newState: "degraded",
          previousIntegrity: 20,
          newIntegrity: 11
        })
      })
    );
    expect(result.next_state.ships.bravo_ship?.hull.current_integrity).toBe(85);
    expect(result.next_state.ships.bravo_ship?.systems.drive?.current_integrity).toBe(11);
  });

  it("marks the winner when a lethal hit destroys the remaining enemy ship", async () => {
    const state = await readBattleStateFixture();

    state.ships.alpha_ship!.pose.position = { x: 0, y: -100 };
    state.ships.alpha_ship!.pose.heading_degrees = 0;
    state.ships.bravo_ship!.pose.position = { x: 0, y: 0 };
    state.ships.bravo_ship!.pose.heading_degrees = 0;
    state.ships.bravo_ship!.hull.current_integrity = 10;

    const result = resolve({
      state,
      plots_by_ship: {
        alpha_ship: makePlot(state, {
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
        bravo_ship: makePlot(state, {
          ship_instance_id: "bravo_ship",
          drive_pips: 8,
          railgun_pips: 0,
          desired_end_heading_degrees: 0,
          weapons: []
        })
      },
      seed: "combat-seed-1"
    });

    expect(result.events).toContainEqual(
      expect.objectContaining({
        sub_tick: 0,
        type: "ship_destroyed",
        target: "bravo_ship",
        details: expect.objectContaining({
          causeActor: "alpha_ship"
        })
      })
    );
    expect(result.events[result.events.length - 1]).toMatchObject({
      sub_tick: 60,
      type: "turn_ended",
      details: {
        turnNumber: 2,
        winner: "alpha_ship"
      }
    });
    expect(result.next_state.ships.bravo_ship?.status).toBe("destroyed");
    expect(result.next_state.outcome).toMatchObject({
      winner_ship_instance_id: "alpha_ship",
      end_reason: "destroyed"
    });
  });

  it("marks a ship as disengaged when it ends the turn outside the battle boundary", async () => {
    const state = await readBattleStateFixture();

    state.ships.alpha_ship!.pose.position = { x: -450, y: 0 };
    state.ships.bravo_ship!.pose.position = { x: 0, y: 0 };

    const result = resolve({
      state,
      plots_by_ship: {
        alpha_ship: makePlot(state, {
          ship_instance_id: "alpha_ship",
          drive_pips: 8,
          railgun_pips: 0,
          desired_end_heading_degrees: 0,
          weapons: []
        }),
        bravo_ship: makePlot(state, {
          ship_instance_id: "bravo_ship",
          drive_pips: 8,
          railgun_pips: 0,
          desired_end_heading_degrees: 180,
          weapons: []
        })
      },
      seed: "boundary-seed-1"
    });

    expect(result.next_state.ships.alpha_ship?.status).toBe("disengaged");
    expect(result.next_state.ships.bravo_ship?.status).toBe("active");
    expect(result.next_state.outcome).toMatchObject({
      winner_ship_instance_id: "bravo_ship",
      end_reason: "boundary_disengage"
    });
    expect(result.events).toContainEqual(
      expect.objectContaining({
        sub_tick: expect.any(Number),
        type: "ship_disengaged",
        target: "alpha_ship",
        details: expect.objectContaining({
          finalPosition: expect.any(Object)
        })
      })
    );
    expect(result.events[result.events.length - 1]).toMatchObject({
      sub_tick: 60,
      type: "turn_ended",
      details: {
        turnNumber: 2,
        winner: "bravo_ship"
      }
    });
  });

  it("ignores boundary exit when disengage is disabled in the rules", async () => {
    const state = await readBattleStateFixture();

    state.match_setup.rules.victory.boundary_disengage_enabled = false;
    state.ships.alpha_ship!.pose.position = { x: -450, y: 0 };

    const result = resolve({
      state,
      plots_by_ship: {
        alpha_ship: makePlot(state, {
          ship_instance_id: "alpha_ship",
          drive_pips: 8,
          railgun_pips: 0,
          desired_end_heading_degrees: 0,
          weapons: []
        }),
        bravo_ship: makePlot(state, {
          ship_instance_id: "bravo_ship",
          drive_pips: 8,
          railgun_pips: 0,
          desired_end_heading_degrees: 180,
          weapons: []
        })
      },
      seed: "boundary-seed-2"
    });

    expect(result.next_state.ships.alpha_ship?.status).toBe("active");
    expect(result.next_state.outcome).toMatchObject({
      winner_ship_instance_id: null,
      end_reason: null
    });
    expect(result.events[result.events.length - 1]).toMatchObject({
      sub_tick: 60,
      type: "turn_ended",
      details: {
        turnNumber: 2,
        winner: null
      }
    });
  });
});
