// Targeted tests covering reachable branches in src/shared/** that default fixtures don't exercise.
// Depends on: shared contracts/resolve/validators/derived, Vitest, fixtures/. Consumed by: vitest runner.
// Invariant: each test names the specific branch it covers (file:line) so future maintainers can see why it's here.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveSubsystemState,
  getAvailableReactorPips,
  validateBattleState
} from "../src/shared/index.js";
import { evaluateWeaponOpportunity } from "../src/shared/resolver/combat.js";
import { runEventsPhase } from "../src/shared/resolver/phases/events.js";
import type { BattleState, ShipRuntimeState } from "../src/shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function readBattleStateFixture(): Promise<BattleState> {
  return validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
}

function getReactorRules(state: BattleState) {
  const reactor = state.match_setup.rules.damage.effects_by_system_type.reactor;

  if (!reactor) {
    throw new Error("fixture missing reactor effects");
  }

  return reactor;
}

describe("shared branch coverage — reachable branches that default fixtures miss", () => {
  it("covers src/shared/derived.ts:49 — subsystem 'offline' return when integrity is below degraded threshold", async () => {
    const state = await readBattleStateFixture();
    const rules = state.match_setup.rules;

    // fraction=0 < 0.34 degraded threshold ⇒ offline
    expect(deriveSubsystemState(0, 100, rules)).toBe("offline");
  });

  it("covers src/shared/derived.ts:118 — discretionary_pips_override branch", async () => {
    const state = await readBattleStateFixture();
    const reactorEffects = getReactorRules(state);

    // Force operational reactor state to carry the override so the branch fires on a healthy ship.
    reactorEffects.operational = { discretionary_pips_override: 3 };

    const alphaShip = state.ships.alpha_ship as ShipRuntimeState;

    expect(getAvailableReactorPips(state, alphaShip)).toBe(3);
  });

  it("covers src/shared/derived.ts:126 — rounding = 'ceil' arm", async () => {
    const state = await readBattleStateFixture();
    const reactorEffects = getReactorRules(state);

    // base=8 * 0.5 = 4.0, but use 0.55 for a fractional value that differs under each rounding mode.
    reactorEffects.operational = { discretionary_pips_factor: 0.55, rounding: "ceil" };

    const alphaShip = state.ships.alpha_ship as ShipRuntimeState;

    // 8 * 0.55 = 4.4 -> ceil = 5
    expect(getAvailableReactorPips(state, alphaShip)).toBe(5);
  });

  it("covers src/shared/derived.ts:130 — rounding = 'round' arm", async () => {
    const state = await readBattleStateFixture();
    const reactorEffects = getReactorRules(state);

    // Factor 0.7 produces a raw value where round and floor disagree:
    // 8 * 0.7 = 5.6 -> round = 6, floor = 5. The assertion proves the round arm executed.
    reactorEffects.operational = { discretionary_pips_factor: 0.7, rounding: "round" };

    const alphaShip = state.ships.alpha_ship as ShipRuntimeState;

    expect(getAvailableReactorPips(state, alphaShip)).toBe(6);
  });

  it("covers src/shared/resolver/phases/events.ts:52 — weapon-miss path when hitRoll > hit_probability", async () => {
    const state = await readBattleStateFixture();
    const alphaShip = state.ships.alpha_ship as ShipRuntimeState;
    const bravoShip = state.ships.bravo_ship as ShipRuntimeState;

    // hit_probability=-1 guarantees miss regardless of determinism hash: sampleUnitInterval returns
    // a value in [0, 1), which is always > -1. Decouples the test from hash internals.
    const output = runEventsPhase({
      state,
      plotsByShip: {},
      sensing: {
        weapon_readings: [
          {
            actor_ship_id: alphaShip.ship_instance_id,
            target_ship_id: bravoShip.ship_instance_id,
            mount_id: "forward_mount",
            sub_tick: 0,
            mount_position: { x: 0, y: 0 },
            target_position: { x: 100, y: 0 },
            effective_charge_pips: 1,
            hit_probability: -1,
            base_damage: 10
          }
        ]
      },
      seed: "miss-seed-coverage",
      subTick: 0
    });

    const fired = output.events.filter((event) => event.type === "weapon_fired");
    const hits = output.events.filter((event) => event.type === "hit_registered");

    expect(fired).toHaveLength(1);
    expect(hits).toHaveLength(0);
  });

  it("covers src/shared/resolver/combat.ts — off-arc branch returns null", async () => {
    const state = await readBattleStateFixture();
    const shooter = state.ships.alpha_ship as ShipRuntimeState;
    const target = state.ships.bravo_ship as ShipRuntimeState;

    // Mount bearing 0 deg with 60 deg arc (± 30 deg). Place target directly behind the shooter.
    shooter.pose.position = { x: 0, y: 0 };
    shooter.pose.heading_degrees = 0; // forward is +y in hull local => world bearing 0 deg
    target.pose.position = { x: 0, y: -200 }; // target is directly behind

    const opportunity = evaluateWeaponOpportunity(state, shooter, target, "forward_mount", 1, 0);

    expect(opportunity).toBeNull();
  });

  it("covers src/shared/resolver/combat.ts — out-of-range branch returns null", async () => {
    const state = await readBattleStateFixture();
    const shooter = state.ships.alpha_ship as ShipRuntimeState;
    const target = state.ships.bravo_ship as ShipRuntimeState;

    // 1-pip charge has max_range_km=140; place target 500 units ahead so rangeRatio > 1.
    shooter.pose.position = { x: 0, y: 0 };
    shooter.pose.heading_degrees = 0;
    target.pose.position = { x: 0, y: 500 };

    const opportunity = evaluateWeaponOpportunity(state, shooter, target, "forward_mount", 1, 0);

    expect(opportunity).toBeNull();
  });

  it("covers src/shared/resolver/combat.ts — charge band not found returns null", async () => {
    const state = await readBattleStateFixture();
    const shooter = state.ships.alpha_ship as ShipRuntimeState;
    const target = state.ships.bravo_ship as ShipRuntimeState;

    shooter.pose.position = { x: 0, y: 0 };
    shooter.pose.heading_degrees = 0;
    target.pose.position = { x: 0, y: 100 };

    // charge_table has pips=1,2,3; asking for 7 pips yields no matching entry.
    const opportunity = evaluateWeaponOpportunity(state, shooter, target, "forward_mount", 7, 0);

    expect(opportunity).toBeNull();
  });
});
