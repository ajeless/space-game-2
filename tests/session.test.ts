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
    const firstIdentity = session.connectClient("client_1").identity;
    const secondIdentity = session.connectClient("client_2").identity;

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

  it("can reset the match state while preserving connected player slots", async () => {
    const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
    const alphaPlot = validatePlotSubmission(await readJson("fixtures/plots/alpha_turn_1.json"), battleState);
    const session = new MatchSession(battleState);
    const firstIdentity = session.connectClient("client_1").identity;

    session.submitPlot("client_1", alphaPlot);
    const resetView = session.reset(battleState);

    expect(resetView.battle_state.turn_number).toBe(1);
    expect(resetView.pending_plot_ship_ids).toEqual([]);
    expect(resetView.last_resolution).toBeNull();
    expect(session.getIdentity("client_1")).toEqual(firstIdentity);
  });

  it("reserves a disconnected slot for reconnect and restores it with the reconnect token", async () => {
    const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
    const session = new MatchSession(battleState);
    const alphaIdentity = session.connectClient("client_1").identity;

    session.disconnectClient("client_1");

    expect(session.getView().slot_states).toContainEqual({
      slot_id: "alpha",
      ship_instance_id: "alpha_ship",
      connection_state: "reconnecting"
    });

    const bravoIdentity = session.connectClient("client_2").identity;
    const resumedAlpha = session.connectClient("client_3", alphaIdentity.reconnect_token).identity;

    expect(bravoIdentity.ship_instance_id).toBe("bravo_ship");
    expect(resumedAlpha.ship_instance_id).toBe("alpha_ship");
    expect(resumedAlpha.reconnect_token).toBe(alphaIdentity.reconnect_token);
  });

  it("releases a disconnected slot after the reconnect grace period expires", async () => {
    const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
    let now = 1_000;
    const session = new MatchSession(battleState, {
      reconnect_grace_ms: 50,
      now: () => now
    });

    const alphaIdentity = session.connectClient("client_1").identity;
    session.disconnectClient("client_1");
    now += 100;

    const replacementIdentity = session.connectClient("client_2").identity;

    expect(replacementIdentity.ship_instance_id).toBe("alpha_ship");
    expect(replacementIdentity.reconnect_token).not.toBe(alphaIdentity.reconnect_token);
  });

  it("lets a fresh spectator explicitly claim a reconnecting slot", async () => {
    const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
    const session = new MatchSession(battleState);

    const alphaIdentity = session.connectClient("client_1").identity;
    const bravoIdentity = session.connectClient("client_2").identity;

    session.disconnectClient("client_2");

    const spectatorIdentity = session.connectClient("client_3").identity;
    expect(spectatorIdentity.role).toBe("spectator");

    const claim = session.claimSlot("client_3", "bravo");

    expect(alphaIdentity.ship_instance_id).toBe("alpha_ship");
    expect(bravoIdentity.ship_instance_id).toBe("bravo_ship");
    expect(claim.identity.role).toBe("player");
    expect(claim.identity.slot_id).toBe("bravo");
    expect(claim.identity.ship_instance_id).toBe("bravo_ship");
    expect(claim.session.slot_states).toContainEqual({
      slot_id: "bravo",
      ship_instance_id: "bravo_ship",
      connection_state: "connected"
    });
  });

  it("preserves a submitted plot across reconnect token resume and resolves the turn", async () => {
    const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
    const alphaPlot = validatePlotSubmission(await readJson("fixtures/plots/alpha_turn_1.json"), battleState);
    const bravoPlot = validatePlotSubmission(await readJson("fixtures/plots/bravo_turn_1.json"), battleState);
    const session = new MatchSession(battleState);

    const alphaIdentity = session.connectClient("client_1").identity;
    session.connectClient("client_2");
    session.submitPlot("client_1", alphaPlot);
    session.disconnectClient("client_1");

    const resumedAlpha = session.connectClient("client_3", alphaIdentity.reconnect_token).identity;
    const resolved = session.submitPlot("client_2", bravoPlot);

    expect(resumedAlpha.ship_instance_id).toBe("alpha_ship");
    expect(resumedAlpha.reconnect_token).toBe(alphaIdentity.reconnect_token);
    expect(resolved.resolution_committed).toBe(true);
    expect(resolved.session.pending_plot_ship_ids).toEqual([]);
    expect(resolved.session.battle_state.turn_number).toBe(2);
  });

  it("preserves a disconnected player's submitted plot when a fresh spectator claims the slot", async () => {
    const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
    const alphaPlot = validatePlotSubmission(await readJson("fixtures/plots/alpha_turn_1.json"), battleState);
    const bravoPlot = validatePlotSubmission(await readJson("fixtures/plots/bravo_turn_1.json"), battleState);
    const session = new MatchSession(battleState);

    session.connectClient("client_1");
    session.connectClient("client_2");
    session.submitPlot("client_2", bravoPlot);
    session.disconnectClient("client_2");

    const spectatorIdentity = session.connectClient("client_3").identity;
    expect(spectatorIdentity.role).toBe("spectator");

    const claim = session.claimSlot("client_3", "bravo");
    const resolved = session.submitPlot("client_1", alphaPlot);

    expect(claim.identity.slot_id).toBe("bravo");
    expect(claim.session.pending_plot_ship_ids).toEqual(["bravo_ship"]);
    expect(resolved.resolution_committed).toBe(true);
    expect(resolved.session.pending_plot_ship_ids).toEqual([]);
    expect(resolved.session.battle_state.turn_number).toBe(2);
  });

  it("rejects server-side plot submission after the match has already ended", async () => {
    const battleState = validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
    const alphaPlot = validatePlotSubmission(await readJson("fixtures/plots/alpha_turn_1.json"), battleState);
    const session = new MatchSession(battleState);

    battleState.outcome = {
      winner_ship_instance_id: "alpha_ship",
      end_reason: "destroyed"
    };
    battleState.ships.bravo_ship!.status = "destroyed";

    const endedSession = new MatchSession(battleState);
    endedSession.connectClient("client_1");

    expect(() => endedSession.submitPlot("client_1", alphaPlot)).toThrow("match already ended");
    expect(session.getView().battle_state.outcome.end_reason).toBeNull();
  });
});
