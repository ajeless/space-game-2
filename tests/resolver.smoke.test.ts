import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolve, validateBattleState, validatePlotSubmission } from "../src/shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

describe("resolver skeleton", () => {
  it("validates plots, advances the turn, and emits deterministic skeleton events", async () => {
    const state = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
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
    expect(result.next_state.ships.alpha_ship?.pose.position).toEqual(state.ships.alpha_ship?.pose.position);
    expect(result.events).toHaveLength(3);
    expect(result.events[0]).toMatchObject({
      sub_tick: 0,
      type: "plot_committed",
      actor: "alpha_ship"
    });
    expect(result.events[1]).toMatchObject({
      sub_tick: 0,
      type: "plot_committed",
      actor: "bravo_ship"
    });
    expect(result.events[2]).toMatchObject({
      sub_tick: 60,
      type: "turn_ended",
      details: {
        turnNumber: 2,
        winner: null
      }
    });
  });

  it("rejects missing active-ship plots", async () => {
    const state = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
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
});
