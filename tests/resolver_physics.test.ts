import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolve, validateBattleState, validatePlotSubmission } from "../src/shared/index.js";
import type { BattleState, PlotSubmission, Vector2 } from "../src/shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function readBattleStateFixture(relativePath = "fixtures/battle_states/default_duel_turn_1.json") {
  return validateBattleState(await readJson(relativePath));
}

function makeConstantTranslationPlan(thrustFraction: Vector2) {
  return {
    kind: "piecewise_linear" as const,
    frame: "world" as const,
    knots: [
      { t: 0, thrust_fraction: { ...thrustFraction } },
      { t: 1, thrust_fraction: { ...thrustFraction } }
    ]
  };
}

function makePlot(
  state: BattleState,
  input: {
    ship_instance_id: string;
    drive_pips: number;
    railgun_pips: number;
    desired_end_heading_degrees: number;
    translation_plan?: PlotSubmission["maneuver"]["translation_plan"];
    weapons?: PlotSubmission["weapons"];
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
        translation_plan: input.translation_plan ?? makeConstantTranslationPlan({ x: 0, y: 0 })
      },
      weapons: input.weapons ?? []
    },
    state
  );
}

function resolveTurn(
  state: BattleState,
  plotsByShip: Record<string, PlotSubmission>,
  seed = "physics-seed"
) {
  return resolve({
    state,
    plots_by_ship: plotsByShip,
    seed
  });
}

function getExpectedDeltaVelocityForFullBurn(state: BattleState): number {
  const shipConfig = state.match_setup.ship_catalog.css_meridian;
  const driveSystem = shipConfig?.systems.find((system) => system.type === "drive");

  if (!shipConfig || !driveSystem || driveSystem.type !== "drive") {
    throw new Error("Missing css_meridian drive config in battle-state fixture");
  }

  return (driveSystem.parameters.max_thrust / shipConfig.dynamics.mass) * state.match_setup.rules.turn.duration_seconds;
}

describe("resolver physics", () => {
  it("preserves drift across a thrust-free turn", async () => {
    const state = await readBattleStateFixture();

    state.ships.alpha_ship!.pose.position = { x: -10, y: 20 };
    state.ships.alpha_ship!.pose.velocity = { x: 0.18, y: -0.05 };

    const result = resolveTurn(state, {
      alpha_ship: makePlot(state, {
        ship_instance_id: "alpha_ship",
        drive_pips: 8,
        railgun_pips: 0,
        desired_end_heading_degrees: 0
      }),
      bravo_ship: makePlot(state, {
        ship_instance_id: "bravo_ship",
        drive_pips: 8,
        railgun_pips: 0,
        desired_end_heading_degrees: 180
      })
    });
    const alpha = result.next_state.ships.alpha_ship!;
    const turnDuration = state.match_setup.rules.turn.duration_seconds;

    expect(alpha.pose.velocity).toEqual({ x: 0.18, y: -0.05 });
    expect(alpha.pose.position.x).toBeCloseTo(-10 + 0.18 * turnDuration, 10);
    expect(alpha.pose.position.y).toBeCloseTo(20 - 0.05 * turnDuration, 10);
  });

  it("accelerates across consecutive turns when the same burn is repeated", async () => {
    const initialState = await readBattleStateFixture();
    const translationPlan = makeConstantTranslationPlan({ x: 0, y: 1 });
    const turnOneResult = resolveTurn(initialState, {
      alpha_ship: makePlot(initialState, {
        ship_instance_id: "alpha_ship",
        drive_pips: 8,
        railgun_pips: 0,
        desired_end_heading_degrees: 0,
        translation_plan: translationPlan
      }),
      bravo_ship: makePlot(initialState, {
        ship_instance_id: "bravo_ship",
        drive_pips: 8,
        railgun_pips: 0,
        desired_end_heading_degrees: 180
      })
    });
    const turnTwoState = turnOneResult.next_state;
    const turnTwoResult = resolveTurn(turnTwoState, {
      alpha_ship: makePlot(turnTwoState, {
        ship_instance_id: "alpha_ship",
        drive_pips: 8,
        railgun_pips: 0,
        desired_end_heading_degrees: 0,
        translation_plan: translationPlan
      }),
      bravo_ship: makePlot(turnTwoState, {
        ship_instance_id: "bravo_ship",
        drive_pips: 8,
        railgun_pips: 0,
        desired_end_heading_degrees: 180
      })
    });
    const turnOneVelocity = turnOneResult.next_state.ships.alpha_ship!.pose.velocity.y;
    const turnTwoVelocity = turnTwoResult.next_state.ships.alpha_ship!.pose.velocity.y;
    const expectedDeltaV = getExpectedDeltaVelocityForFullBurn(initialState);

    expect(turnOneVelocity).toBeCloseTo(expectedDeltaV, 10);
    expect(turnTwoVelocity).toBeCloseTo(expectedDeltaV * 2, 10);
    expect(turnTwoVelocity).toBeGreaterThan(turnOneVelocity);
  });

  it("keeps drift direction independent from heading changes", async () => {
    const state = await readBattleStateFixture();

    state.ships.alpha_ship!.pose.velocity = { x: 0.2, y: 0 };
    state.ships.alpha_ship!.pose.heading_degrees = 0;

    const result = resolveTurn(state, {
      alpha_ship: makePlot(state, {
        ship_instance_id: "alpha_ship",
        drive_pips: 8,
        railgun_pips: 0,
        desired_end_heading_degrees: 120
      }),
      bravo_ship: makePlot(state, {
        ship_instance_id: "bravo_ship",
        drive_pips: 8,
        railgun_pips: 0,
        desired_end_heading_degrees: 180
      })
    });

    expect(result.next_state.ships.alpha_ship!.pose.heading_degrees).toBeCloseTo(120, 10);
    expect(result.next_state.ships.alpha_ship!.pose.velocity).toEqual({ x: 0.2, y: 0 });
  });

  it("does not let opposite thrust magically cancel velocity unless the burn is physically large enough", async () => {
    const state = await readBattleStateFixture();

    state.ships.alpha_ship!.pose.velocity = { x: 0, y: 0.4 };

    const result = resolveTurn(state, {
      alpha_ship: makePlot(state, {
        ship_instance_id: "alpha_ship",
        drive_pips: 8,
        railgun_pips: 0,
        desired_end_heading_degrees: 0,
        translation_plan: makeConstantTranslationPlan({ x: 0, y: -1 })
      }),
      bravo_ship: makePlot(state, {
        ship_instance_id: "bravo_ship",
        drive_pips: 8,
        railgun_pips: 0,
        desired_end_heading_degrees: 180
      })
    });
    const expectedDeltaV = getExpectedDeltaVelocityForFullBurn(state);

    expect(result.next_state.ships.alpha_ship!.pose.velocity.y).toBeCloseTo(0.4 - expectedDeltaV, 10);
    expect(result.next_state.ships.alpha_ship!.pose.velocity.y).toBeGreaterThan(0);
  });

  it("does not apply railgun hits as momentum loss to a coasting target", async () => {
    const state = await readBattleStateFixture();

    state.match_setup.rules.hit_probability.min_probability = 1;
    state.match_setup.rules.hit_probability.max_probability = 1;
    state.ships.alpha_ship!.pose.position = { x: 0, y: -100 };
    state.ships.alpha_ship!.pose.heading_degrees = 0;
    state.ships.bravo_ship!.pose.position = { x: 0, y: 0 };
    state.ships.bravo_ship!.pose.heading_degrees = 0;
    state.ships.bravo_ship!.pose.velocity = { x: 0, y: 0.2 };

    const result = resolveTurn(
      state,
      {
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
          desired_end_heading_degrees: 0
        })
      },
      "head-on-hit-seed"
    );
    const bravo = result.next_state.ships.bravo_ship!;
    const turnDuration = state.match_setup.rules.turn.duration_seconds;

    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: "hit_registered",
        target: "bravo_ship"
      })
    );
    expect(bravo.pose.velocity).toEqual({ x: 0, y: 0.2 });
    expect(bravo.pose.position.y).toBeCloseTo(0.2 * turnDuration, 10);
  });

  it("keeps a destroyed ship drifting for the rest of the turn after a lethal hit", async () => {
    const state = await readBattleStateFixture();

    state.match_setup.rules.hit_probability.min_probability = 1;
    state.match_setup.rules.hit_probability.max_probability = 1;
    state.ships.alpha_ship!.pose.position = { x: 0, y: -100 };
    state.ships.alpha_ship!.pose.heading_degrees = 0;
    state.ships.bravo_ship!.pose.position = { x: 0, y: 0 };
    state.ships.bravo_ship!.pose.heading_degrees = 0;
    state.ships.bravo_ship!.pose.velocity = { x: 0, y: 0.2 };
    state.ships.bravo_ship!.hull.current_integrity = 10;

    const result = resolveTurn(
      state,
      {
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
          desired_end_heading_degrees: 0
        })
      },
      "lethal-hit-seed"
    );
    const bravo = result.next_state.ships.bravo_ship!;
    const turnDuration = state.match_setup.rules.turn.duration_seconds;
    const bravoThrustEvents = result.events.filter((event) => event.type === "thrust_applied" && event.actor === "bravo_ship");
    const destroyedEvent = result.events.find(
      (event): event is Extract<(typeof result.events)[number], { type: "ship_destroyed" }> =>
        event.type === "ship_destroyed" && event.target === "bravo_ship"
    );

    expect(bravo.status).toBe("destroyed");
    expect(bravo.pose.velocity).toEqual({ x: 0, y: 0.2 });
    expect(bravo.pose.position.y).toBeCloseTo(0.2 * turnDuration, 10);
    expect(bravoThrustEvents).toHaveLength(state.match_setup.rules.turn.sub_ticks);
    expect(destroyedEvent?.details.finalPosition).toEqual(bravo.pose.position);
  });

  it("keeps a disengaging ship drifting after it crosses the battle boundary", async () => {
    const state = await readBattleStateFixture();

    state.ships.alpha_ship!.pose.position = { x: -499.9, y: 0 };
    state.ships.alpha_ship!.pose.velocity = { x: -0.2, y: 0 };

    const result = resolveTurn(state, {
      alpha_ship: makePlot(state, {
        ship_instance_id: "alpha_ship",
        drive_pips: 8,
        railgun_pips: 0,
        desired_end_heading_degrees: 0
      }),
      bravo_ship: makePlot(state, {
        ship_instance_id: "bravo_ship",
        drive_pips: 8,
        railgun_pips: 0,
        desired_end_heading_degrees: 180
      })
    });
    const alpha = result.next_state.ships.alpha_ship!;
    const turnDuration = state.match_setup.rules.turn.duration_seconds;
    const alphaThrustEvents = result.events.filter((event) => event.type === "thrust_applied" && event.actor === "alpha_ship");
    const disengagedEvent = result.events.find(
      (event): event is Extract<(typeof result.events)[number], { type: "ship_disengaged" }> =>
        event.type === "ship_disengaged" && event.target === "alpha_ship"
    );

    expect(alpha.status).toBe("disengaged");
    expect(alpha.pose.velocity).toEqual({ x: -0.2, y: 0 });
    expect(alpha.pose.position.x).toBeCloseTo(-499.9 - 0.2 * turnDuration, 10);
    expect(alphaThrustEvents).toHaveLength(state.match_setup.rules.turn.sub_ticks);
    expect(disengagedEvent?.details.finalPosition).toEqual(alpha.pose.position);
  });
});
