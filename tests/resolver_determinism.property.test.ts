// Property test: resolver determinism. Random seeds, same inputs → byte-identical outputs.
// Depends on: shared resolve/validators, fast-check, Vitest, fixtures/. Consumed by: vitest runner.
// Invariant: this test encodes the "replays reproduce from state+plot+seed" invariant (AGENTS.md).

import { readFile } from "node:fs/promises";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  resolve,
  validateBattleState,
  validatePlotSubmission
} from "../src/shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");
  return JSON.parse(raw) as unknown;
}

describe("resolver determinism (property)", () => {
  it("same seed + same plots produce byte-identical resolutions", async () => {
    const state = validateBattleState(
      await readJson("fixtures/battle_states/default_duel_turn_1.json")
    );
    const alphaPlot = validatePlotSubmission(
      await readJson("fixtures/plots/alpha_turn_1.json"),
      state
    );
    const bravoPlot = validatePlotSubmission(
      await readJson("fixtures/plots/bravo_turn_1.json"),
      state
    );

    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 64 }), (seed) => {
        const inputA = {
          state: structuredClone(state),
          plots_by_ship: { alpha_ship: alphaPlot, bravo_ship: bravoPlot },
          seed
        };
        const inputB = {
          state: structuredClone(state),
          plots_by_ship: { alpha_ship: alphaPlot, bravo_ship: bravoPlot },
          seed
        };

        const a = resolve(inputA);
        const b = resolve(inputB);

        expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
      }),
      { numRuns: 50 }
    );
  });
});
