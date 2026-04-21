import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateBattleState, validatePlotSubmission } from "../src/shared/index.js";
import { MatchSession } from "../src/server/session.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

describe("MatchSession", () => {
  it("assigns player slots in participant order and resolves once both plots arrive", async () => {
    const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
    const alphaPlot = validatePlotSubmission(await readJson("fixtures/plots/alpha_turn_1.json"), battleState);
    const bravoPlot = validatePlotSubmission(await readJson("fixtures/plots/bravo_turn_1.json"), battleState);
    const session = new MatchSession(battleState);
    const firstIdentity = session.connectClient("client_1");
    const secondIdentity = session.connectClient("client_2");

    expect(firstIdentity.ship_instance_id).toBe("alpha_ship");
    expect(secondIdentity.ship_instance_id).toBe("bravo_ship");

    const firstSubmit = session.submitPlot("client_1", alphaPlot);

    expect(firstSubmit.resolution_committed).toBe(false);
    expect(firstSubmit.session.pending_plot_ship_ids).toEqual(["alpha_ship"]);

    const secondSubmit = session.submitPlot("client_2", bravoPlot);

    expect(secondSubmit.resolution_committed).toBe(true);
    expect(secondSubmit.session.pending_plot_ship_ids).toEqual([]);
    expect(secondSubmit.session.battle_state.turn_number).toBe(2);
    expect(secondSubmit.session.last_resolution?.event_count).toBeGreaterThan(0);
  });

  it("rejects plots submitted for the wrong assigned ship", async () => {
    const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
    const bravoPlot = validatePlotSubmission(await readJson("fixtures/plots/bravo_turn_1.json"), battleState);
    const session = new MatchSession(battleState);

    session.connectClient("client_1");

    expect(() => session.submitPlot("client_1", bravoPlot)).toThrow("only submit plots");
  });
});
