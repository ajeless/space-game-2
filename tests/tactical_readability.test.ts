import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPlotPreview,
  createPlotDraft,
  resolve,
  validatePlotSubmission,
  validateBattleState,
  type ShipRuntimeState
} from "../src/shared/index.js";
import {
  getContactTelemetry,
  getWeaponCueBlockedReason,
  getWeaponCueGuidanceLabel,
  getWeaponCueEngagementLabel,
  getWeaponCueEngagementState,
  getWeaponCueSolutionLabel,
  getWeaponMountStateLabel
} from "../src/client/combat_readability.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function readBattleStateFixture(relativePath = "fixtures/battle_states/default_duel_turn_1.json") {
  return validateBattleState(await readJson(relativePath));
}

function cloneShip(ship: ShipRuntimeState): ShipRuntimeState {
  return structuredClone(ship);
}

describe("tactical readability", () => {
  it("distinguishes tracked, armed, and blocked target states from weapon cues", async () => {
    const state = await readBattleStateFixture();
    const trackedDraft = createPlotDraft(state, "alpha_ship");

    trackedDraft.weapons[0] = {
      ...trackedDraft.weapons[0]!,
      target_ship_instance_id: "bravo_ship",
      charge_pips: 0
    };

    const trackedCue = buildPlotPreview(state, trackedDraft).weapon_cues[0]!;
    expect(getWeaponCueEngagementState(trackedCue)).toBe("tracked");
    expect(getWeaponCueEngagementLabel(trackedCue)).toBe("TRACKED · HOLD FIRE");
    expect(getWeaponCueGuidanceLabel(trackedCue)).toBe(
      "Target tracked. Charge is set to hold fire, so this mount will not shoot."
    );

    state.ships.alpha_ship!.pose.position = { x: 0, y: -90 };
    state.ships.alpha_ship!.pose.heading_degrees = 0;
    state.ships.bravo_ship!.pose.position = { x: 0, y: 0 };
    state.ships.bravo_ship!.pose.heading_degrees = 180;

    const armedDraft = createPlotDraft(state, "alpha_ship");
    armedDraft.weapons[0] = {
      ...armedDraft.weapons[0]!,
      target_ship_instance_id: "bravo_ship",
      charge_pips: 2
    };

    const armedCue = buildPlotPreview(state, armedDraft).weapon_cues[0]!;
    expect(getWeaponCueEngagementState(armedCue)).toBe("armed");
    expect(getWeaponCueEngagementLabel(armedCue)).toContain("ARMED · 2P");
    expect(getWeaponCueEngagementLabel(armedCue)).toContain("% HIT");
    expect(getWeaponCueSolutionLabel(armedCue)).toMatch(/% hit · fire window T\d{2}/);
    expect(getWeaponCueGuidanceLabel(armedCue)).toMatch(/^Target tracked\. Fire control predicts \d+% hit at T\d{2}\.$/);

    state.ships.bravo_ship!.pose.position = { x: 0, y: 260 };

    const blockedCue = buildPlotPreview(state, armedDraft).weapon_cues[0]!;
    expect(getWeaponCueEngagementState(blockedCue)).toBe("blocked");
    expect(getWeaponCueEngagementLabel(blockedCue)).toBe("BLOCKED · OUT OF RANGE");
    expect(getWeaponCueGuidanceLabel(blockedCue)).toBe(
      "Target tracked, but it stays out of range this turn. Close distance or hold fire."
    );
  });

  it("treats a mount as armed when a legal shot exists later in the turn even if the live pose is not yet in arc", async () => {
    const state = await readBattleStateFixture();
    const draft = createPlotDraft(state, "alpha_ship");

    draft.heading_delta_degrees = 90;
    draft.weapons[0] = {
      ...draft.weapons[0]!,
      target_ship_instance_id: "bravo_ship",
      charge_pips: 3
    };

    const cue = buildPlotPreview(state, draft).weapon_cues[0]!;

    expect(cue.target_in_arc).toBe(false);
    expect(cue.predicted_hit_probability).not.toBeNull();
    expect(getWeaponCueEngagementState(cue)).toBe("armed");
    expect(getWeaponCueEngagementLabel(cue)).toContain("ARMED · 3P");
  });

  it("surfaces blocked reasons and degraded mount penalties for selected-mount readouts", async () => {
    const state = await readBattleStateFixture();

    state.ships.alpha_ship!.pose.position = { x: 0, y: -90 };
    state.ships.alpha_ship!.pose.heading_degrees = 0;
    state.ships.bravo_ship!.pose.position = { x: 0, y: 260 };
    state.ships.bravo_ship!.pose.heading_degrees = 180;

    const blockedDraft = createPlotDraft(state, "alpha_ship");
    blockedDraft.weapons[0] = {
      ...blockedDraft.weapons[0]!,
      target_ship_instance_id: "bravo_ship",
      charge_pips: 2
    };

    const blockedCue = buildPlotPreview(state, blockedDraft).weapon_cues[0]!;

    expect(getWeaponCueBlockedReason(blockedCue)).toBe("OUT OF RANGE");
    expect(getWeaponCueSolutionLabel(blockedCue)).toBe("Shot blocked · out of range");

    const closeActionState = await readBattleStateFixture("fixtures/battle_states/close_action_duel_turn_1.json");
    const alphaPlot = validatePlotSubmission(await readJson("fixtures/plots/close_action_alpha_turn_1.json"), closeActionState);
    const bravoPlot = validatePlotSubmission(await readJson("fixtures/plots/close_action_bravo_turn_1.json"), closeActionState);
    const resolved = resolve({
      state: structuredClone(closeActionState),
      plots_by_ship: {
        alpha_ship: alphaPlot,
        bravo_ship: bravoPlot
      },
      seed: `${closeActionState.match_setup.seed_root}:turn:${closeActionState.turn_number}`
    });
    const degradedDraft = createPlotDraft(resolved.next_state, "alpha_ship");

    degradedDraft.weapons[0] = {
      ...degradedDraft.weapons[0]!,
      charge_pips: 3,
      target_ship_instance_id: "bravo_ship"
    };

    const degradedCue = buildPlotPreview(resolved.next_state, degradedDraft).weapon_cues[0]!;

    expect(
      getWeaponMountStateLabel(
        "degraded",
        {
          charge_penalty_pips: 1,
          track_quality_factor: 0.85,
          firing_enabled: true
        },
        degradedCue
      )
    ).toBe("DEGRADED · 3P->2P · TRACK 85%");
  });

  it("summarizes contact range and closure from relative motion", async () => {
    const state = await readBattleStateFixture();
    const viewpointShip = cloneShip(state.ships.alpha_ship!);
    const contactShip = cloneShip(state.ships.bravo_ship!);

    viewpointShip.pose.position = { x: 0, y: 0 };
    viewpointShip.pose.velocity = { x: 0, y: 0 };
    contactShip.pose.position = { x: 0, y: 120 };
    contactShip.pose.velocity = { x: 0, y: -0.004 };

    expect(getContactTelemetry(viewpointShip, contactShip)).toEqual({
      range_label: "120 km",
      closure_label: "closing",
      summary_label: "120 km · closing"
    });

    contactShip.pose.velocity = { x: 0, y: 0.004 };
    expect(getContactTelemetry(viewpointShip, contactShip)?.closure_label).toBe("opening");

    contactShip.pose.velocity = { x: 0, y: 0 };
    expect(getContactTelemetry(viewpointShip, contactShip)?.closure_label).toBe("steady");
  });
});
