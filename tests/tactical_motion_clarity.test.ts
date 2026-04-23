import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderTacticalBoard, TACTICAL_VIEWPORT } from "../src/client/tactical_view.js";
import {
  buildPlotPreview,
  buildTacticalCamera,
  createDefaultTacticalCameraSelection,
  createPlotDraft,
  summarizePlotDraft,
  validateBattleState
} from "../src/shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function readBattleStateFixture() {
  return validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
}

describe("tactical motion clarity", () => {
  it("renders explicit drift, projected endpoint, and handle labels for active plotting", async () => {
    const state = await readBattleStateFixture();
    state.ships.alpha_ship!.pose.velocity = { x: 0.24, y: 0.06 };

    const draft = createPlotDraft(state, "alpha_ship");
    draft.heading_delta_degrees = 25;
    draft.thrust_input = {
      lateral_fraction: 0.35,
      axial_fraction: 0.8
    };

    const plotSummary = summarizePlotDraft(state, draft);
    const plotPreview = buildPlotPreview(state, plotSummary.draft);
    const camera = buildTacticalCamera({
      state,
      boundary: state.match_setup.battlefield.boundary,
      viewport: {
        width: TACTICAL_VIEWPORT.width,
        height: TACTICAL_VIEWPORT.height,
        padding: TACTICAL_VIEWPORT.padding
      },
      selection: createDefaultTacticalCameraSelection(),
      preferred_ship_instance_id: "alpha_ship",
      plot_preview: plotPreview
    });

    const markup = renderTacticalBoard({
      sessionValue: {
        battle_state: state,
        pending_plot_ship_ids: [],
        occupied_slot_ids: [],
        slot_states: [],
        last_resolution: null
      },
      battleStateValue: state,
      identityValue: {
        client_id: "alpha-client",
        role: "player",
        slot_id: "alpha",
        ship_instance_id: "alpha_ship",
        reconnect_token: "token"
      },
      plotSummary,
      plotPreview,
      focusedMountId: null,
      camera,
      playbackStep: null,
      playbackEvent: null
    });

    expect(markup).toContain("ship-glyph__velocity-arrow");
    expect(markup).toContain("plot-preview__path-end-ring");
    expect(markup).toContain("PROJECTED · 025°");
    expect(markup).toContain("tactical-board__legend");
    expect(markup).toContain(">Drift<");
    expect(markup).toContain(">Burn<");
    expect(markup).toContain(">Heading<");
    expect(markup).not.toContain("ship-glyph__velocity-ring");
    expect(markup).not.toContain(">BURN</text>");
    expect(markup).not.toContain(">HEADING</text>");
  });

  it("renders lock chevrons instead of a target reticle when aiming a selected contact", async () => {
    const state = await readBattleStateFixture();
    const draft = createPlotDraft(state, "alpha_ship");

    state.ships.alpha_ship!.pose.position = { x: 0, y: -90 };
    state.ships.alpha_ship!.pose.heading_degrees = 0;
    state.ships.bravo_ship!.pose.position = { x: 0, y: 0 };
    state.ships.bravo_ship!.pose.heading_degrees = 180;

    draft.weapons[0] = {
      ...draft.weapons[0]!,
      target_ship_instance_id: "bravo_ship",
      charge_pips: 2
    };

    const plotSummary = summarizePlotDraft(state, draft);
    const plotPreview = buildPlotPreview(state, plotSummary.draft);
    const camera = buildTacticalCamera({
      state,
      boundary: state.match_setup.battlefield.boundary,
      viewport: {
        width: TACTICAL_VIEWPORT.width,
        height: TACTICAL_VIEWPORT.height,
        padding: TACTICAL_VIEWPORT.padding
      },
      selection: createDefaultTacticalCameraSelection(),
      preferred_ship_instance_id: "alpha_ship",
      plot_preview: plotPreview
    });

    const markup = renderTacticalBoard({
      sessionValue: {
        battle_state: state,
        pending_plot_ship_ids: [],
        occupied_slot_ids: [],
        slot_states: [],
        last_resolution: null
      },
      battleStateValue: state,
      identityValue: {
        client_id: "alpha-client",
        role: "player",
        slot_id: "alpha",
        ship_instance_id: "alpha_ship",
        reconnect_token: "token"
      },
      plotSummary,
      plotPreview,
      focusedMountId: "forward_mount",
      camera,
      playbackStep: null,
      playbackEvent: null
    });

    expect(markup).toContain("ship-glyph__target-lock");
    expect(markup).toContain("animateTransform");
    expect(markup).toContain("plot-preview__target-line");
    expect(markup).not.toContain("plot-preview__target-reticle");
  });

  it("renders an offscreen lock cue when the selected contact is out of scope but in range", async () => {
    const state = await readBattleStateFixture();
    const draft = createPlotDraft(state, "alpha_ship");

    state.ships.alpha_ship!.pose.position = { x: 0, y: 0 };
    state.ships.alpha_ship!.pose.heading_degrees = 90;
    state.ships.bravo_ship!.pose.position = { x: 200, y: 0 };
    state.ships.bravo_ship!.pose.heading_degrees = 270;

    draft.weapons[0] = {
      ...draft.weapons[0]!,
      target_ship_instance_id: "bravo_ship",
      charge_pips: 3
    };

    const plotSummary = summarizePlotDraft(state, draft);
    const plotPreview = buildPlotPreview(state, plotSummary.draft);
    const camera = buildTacticalCamera({
      state,
      boundary: state.match_setup.battlefield.boundary,
      viewport: {
        width: TACTICAL_VIEWPORT.width,
        height: TACTICAL_VIEWPORT.height,
        padding: TACTICAL_VIEWPORT.padding
      },
      selection: createDefaultTacticalCameraSelection(),
      preferred_ship_instance_id: "alpha_ship",
      plot_preview: plotPreview
    });

    const markup = renderTacticalBoard({
      sessionValue: {
        battle_state: state,
        pending_plot_ship_ids: [],
        occupied_slot_ids: [],
        slot_states: [],
        last_resolution: null
      },
      battleStateValue: state,
      identityValue: {
        client_id: "alpha-client",
        role: "player",
        slot_id: "alpha",
        ship_instance_id: "alpha_ship",
        reconnect_token: "token"
      },
      plotSummary,
      plotPreview,
      focusedMountId: "forward_mount",
      camera,
      playbackStep: null,
      playbackEvent: null
    });

    expect(markup).toContain("offscreen-marker__target-lock");
    expect(markup).toContain("data-target-ship=\"bravo_ship\"");
  });

  it("keeps the idle preview free of projected-state labels when the ship is not maneuvering", async () => {
    const state = await readBattleStateFixture();
    const draft = createPlotDraft(state, "alpha_ship");
    const plotSummary = summarizePlotDraft(state, draft);
    const plotPreview = buildPlotPreview(state, plotSummary.draft);
    const camera = buildTacticalCamera({
      state,
      boundary: state.match_setup.battlefield.boundary,
      viewport: {
        width: TACTICAL_VIEWPORT.width,
        height: TACTICAL_VIEWPORT.height,
        padding: TACTICAL_VIEWPORT.padding
      },
      selection: createDefaultTacticalCameraSelection(),
      preferred_ship_instance_id: "alpha_ship",
      plot_preview: plotPreview
    });

    const markup = renderTacticalBoard({
      sessionValue: {
        battle_state: state,
        pending_plot_ship_ids: [],
        occupied_slot_ids: [],
        slot_states: [],
        last_resolution: null
      },
      battleStateValue: state,
      identityValue: {
        client_id: "alpha-client",
        role: "player",
        slot_id: "alpha",
        ship_instance_id: "alpha_ship",
        reconnect_token: "token"
      },
      plotSummary,
      plotPreview,
      focusedMountId: null,
      camera,
      playbackStep: null,
      playbackEvent: null
    });

    expect(markup).not.toContain("PROJECTED ·");
    expect(markup).not.toContain("plot-preview__path-end-ring");
  });
});
