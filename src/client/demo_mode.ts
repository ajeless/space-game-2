// Canned-replay demo mode: runs the shared resolver on bundled fixtures to produce a MatchSessionView
// the bridge shell can render without needing a WebSocket or server. Depends on: shared resolver,
// validation, and network types. Consumed by: src/client/main.ts when ?demo=1 is present.
// Invariant: demo mode never touches the network and never opens a WebSocket.

import defaultDuelTurn1 from "../../fixtures/battle_states/default_duel_turn_1.json?raw";
import alphaPlotTurn1 from "../../fixtures/plots/alpha_turn_1.json?raw";
import bravoPlotTurn1 from "../../fixtures/plots/bravo_turn_1.json?raw";
import {
  resolve,
  validateBattleState,
  validatePlotSubmission
} from "../shared/index.js";
import type {
  BattleState,
  MatchSessionView,
  SessionIdentity
} from "../shared/index.js";

const DEMO_SEED = "burn-vector-demo-turn-1";

export type DemoBootstrap = {
  previousBattleState: BattleState;
  session: MatchSessionView;
  identity: SessionIdentity;
};

export function isDemoModeRequested(search: string): boolean {
  return new URLSearchParams(search).get("demo") === "1";
}

export function buildDemoBootstrap(): DemoBootstrap {
  const previousBattleState = validateBattleState(JSON.parse(defaultDuelTurn1));
  const alphaPlot = validatePlotSubmission(JSON.parse(alphaPlotTurn1), previousBattleState);
  const bravoPlot = validatePlotSubmission(JSON.parse(bravoPlotTurn1), previousBattleState);
  const resolveInputState = structuredClone(previousBattleState);
  const result = resolve({
    state: resolveInputState,
    plots_by_ship: {
      alpha_ship: alphaPlot,
      bravo_ship: bravoPlot
    },
    seed: DEMO_SEED
  });

  const session: MatchSessionView = {
    battle_state: result.next_state,
    pending_plot_ship_ids: [],
    occupied_slot_ids: previousBattleState.match_setup.participants.map((p) => p.slot_id),
    slot_states: previousBattleState.match_setup.participants.map((p) => ({
      slot_id: p.slot_id,
      ship_instance_id: p.ship_instance_id,
      connection_state: "connected" as const
    })),
    last_resolution: {
      resolved_from_turn_number: previousBattleState.turn_number,
      event_count: result.events.length,
      events: result.events
    }
  };

  const identity: SessionIdentity = {
    client_id: "demo-client",
    role: "spectator",
    slot_id: null,
    ship_instance_id: null,
    reconnect_token: null
  };

  return { previousBattleState, session, identity };
}

export function mountDemoBanner(): void {
  if (document.querySelector("[data-demo-banner]")) {
    return;
  }

  const banner = document.createElement("div");
  banner.setAttribute("data-demo-banner", "");
  banner.className = "demo-banner";
  banner.innerHTML = `
    <span class="demo-banner__label">Demo mode</span>
    <span class="demo-banner__copy">Watching a canned duel replay — interactive controls are disabled.</span>
  `;
  document.body.appendChild(banner);
}
