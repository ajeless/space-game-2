import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAvailableReactorPips,
  validateBattleState,
  validateMatchRulesConfig,
  validatePlotSubmission,
  validateShipConfig
} from "../src/shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

describe("v0.1 foundation contracts", () => {
  it("loads and validates the canonical rules, ship, battle-state, and plot fixtures", async () => {
    const rules = validateMatchRulesConfig(await readJson("data/rules/default_duel_v0_1.json"));
    const ship = validateShipConfig(await readJson("data/ships/css_meridian.json"));
    const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
    const alphaPlot = validatePlotSubmission(await readJson("fixtures/plots/alpha_turn_1.json"), battleState);
    const bravoPlot = validatePlotSubmission(await readJson("fixtures/plots/bravo_turn_1.json"), battleState);

    expect(rules.id).toBe("default_duel_v0_1");
    expect(ship.id).toBe("css_meridian");
    expect(battleState.match_setup.match_id).toBe("default_duel_fixture_v0_1");
    expect(alphaPlot.power.drive_pips + alphaPlot.power.railgun_pips).toBe(8);
    expect(bravoPlot.weapons[0]?.charge_pips).toBe(3);
  });

  it("derives available reactor pips from the canonical fixture state", async () => {
    const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
    const alphaShip = battleState.ships.alpha_ship;
    const bravoShip = battleState.ships.bravo_ship;

    if (!alphaShip || !bravoShip) {
      throw new Error("Fixture battle state is missing one or more runtime ships");
    }

    expect(getAvailableReactorPips(battleState, alphaShip)).toBe(8);
    expect(getAvailableReactorPips(battleState, bravoShip)).toBe(8);
  });
});
