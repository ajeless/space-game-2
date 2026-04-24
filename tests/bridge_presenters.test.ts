import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatResolutionEventSummary,
  getActionStripPresentation,
  getMatchOutcomePresentation,
  getResolutionPlaybackMetaLabel
} from "../src/client/bridge_presenters.js";
import type { ResolutionPlaybackStep } from "../src/client/resolution_playback.js";
import {
  createPlotDraft,
  summarizePlotDraft,
  validateBattleState,
  type MatchSessionView,
  type ResolverEvent,
  type SessionIdentity
} from "../src/shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function readBattleStateFixture() {
  return validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
}

function makeShipPoses(state: Awaited<ReturnType<typeof readBattleStateFixture>>) {
  return Object.fromEntries(
    Object.values(state.ships).map((ship) => [ship.ship_instance_id, structuredClone(ship.pose)])
  );
}

function makeSessionView(
  state: Awaited<ReturnType<typeof readBattleStateFixture>>,
  resolvedFromTurnNumber = state.turn_number
): MatchSessionView {
  return {
    battle_state: state,
    pending_plot_ship_ids: [],
    occupied_slot_ids: state.match_setup.participants.map((participant) => participant.slot_id),
    slot_states: state.match_setup.participants.map((participant) => ({
      slot_id: participant.slot_id,
      ship_instance_id: participant.ship_instance_id,
      connection_state: "connected" as const
    })),
    last_resolution: {
      resolved_from_turn_number: resolvedFromTurnNumber,
      event_count: 0,
      events: []
    }
  };
}

function makePlayerIdentity(): SessionIdentity {
  return {
    client_id: "alpha-client",
    role: "player",
    slot_id: "alpha",
    ship_instance_id: "alpha_ship",
    reconnect_token: "token"
  };
}

describe("bridge presenters", () => {
  it("labels replay motion, settle, and completion states", async () => {
    const state = await readBattleStateFixture();
    const session = makeSessionView(state, 3);
    const baseStep: Omit<ResolutionPlaybackStep, "kind"> = {
      duration_ms: 100,
      display_sub_tick: 12,
      total_sub_ticks: state.match_setup.rules.turn.sub_ticks,
      ship_poses: makeShipPoses(state),
      focus_event: null,
      focus_event_index: null,
      focus_event_count: 2,
      exchange_event_index: null,
      exchange_event_count: 0,
      camera_transition_ratio: 0.5,
      progress_ratio: 0.4
    };

    expect(
      getResolutionPlaybackMetaLabel(session, {
        ...baseStep,
        kind: "preroll"
      })
    ).toBe("Replay turn 3 · resolving committed plots");
    expect(
      getResolutionPlaybackMetaLabel(session, {
        ...baseStep,
        kind: "motion"
      })
    ).toBe("Replay turn 3 · motion 12 of 60");
    expect(
      getResolutionPlaybackMetaLabel(session, {
        ...baseStep,
        kind: "settle"
      })
    ).toBe("Replay turn 3 · settling back onto the plot");
    expect(getResolutionPlaybackMetaLabel(session, null)).toBe("Turn 3 replay complete");
  });

  it("summarizes player-facing weapon and damage events", async () => {
    const state = await readBattleStateFixture();
    const session = makeSessionView(state);
    const identity = makePlayerIdentity();
    const weaponEvent: ResolverEvent = {
      sub_tick: 18,
      type: "weapon_fired",
      actor: "alpha_ship",
      target: "bravo_ship",
      details: {
        mountId: "forward_mount",
        mountPosition: { x: 0, y: -100 },
        targetPosition: { x: 0, y: 0 },
        chargePips: 3,
        hitProbability: 0.95,
        baseDamage: 15
      }
    };
    const hitEvent: ResolverEvent = {
      sub_tick: 18,
      type: "hit_registered",
      actor: "alpha_ship",
      target: "bravo_ship",
      details: {
        fromActor: "alpha_ship",
        impactPoint: { x: 0, y: 0 },
        impactSystemId: "drive",
        hullDamageApplied: 9,
        subsystemDamageApplied: 5
      }
    };
    const damageEvent: ResolverEvent = {
      sub_tick: 18,
      type: "subsystem_damaged",
      actor: "bravo_ship",
      details: {
        systemId: "drive",
        previousState: "operational",
        newState: "degraded",
        previousIntegrity: 28,
        newIntegrity: 20
      }
    };

    expect(formatResolutionEventSummary(session, identity, weaponEvent)).toBe(
      "You opened fire with bow railgun on contact · 3P"
    );
    expect(formatResolutionEventSummary(session, identity, hitEvent)).toBe("Direct hit on contact · drive");
    expect(formatResolutionEventSummary(session, identity, damageEvent)).toBe("Contact drive degraded");
  });

  it("tightens match-end detail for victory and defeat states", async () => {
    const state = await readBattleStateFixture();
    const identity = makePlayerIdentity();

    state.outcome = {
      winner_ship_instance_id: "alpha_ship",
      end_reason: "destroyed"
    };

    expect(getMatchOutcomePresentation(makeSessionView(state), identity)).toEqual(
      expect.objectContaining({
        headline: "Victory",
        detail: "Contact destroyed. You hold the field."
      })
    );

    state.outcome = {
      winner_ship_instance_id: "bravo_ship",
      end_reason: "boundary_disengage"
    };

    expect(getMatchOutcomePresentation(makeSessionView(state), identity)).toEqual(
      expect.objectContaining({
        headline: "Defeat",
        detail: "Contact won by boundary disengage."
      })
    );
  });

  it("adds replay status to the player action strip while the previous turn is still playing", async () => {
    const state = await readBattleStateFixture();
    const session = makeSessionView(state, 1);
    const plotSummary = summarizePlotDraft(state, createPlotDraft(state, "alpha_ship"));
    const playbackStep: ResolutionPlaybackStep = {
      kind: "motion",
      duration_ms: 100,
      display_sub_tick: 8,
      total_sub_ticks: state.match_setup.rules.turn.sub_ticks,
      ship_poses: makeShipPoses(state),
      focus_event: null,
      focus_event_index: null,
      focus_event_count: 0,
      exchange_event_index: null,
      exchange_event_count: 0,
      camera_transition_ratio: 0,
      progress_ratio: 0.2
    };
    const presentation = getActionStripPresentation({
      sessionValue: session,
      identityValue: makePlayerIdentity(),
      plotSummary,
      outcomePresentation: null,
      playbackStep,
      plotLocked: true,
      wsState: "connected"
    });

    expect(presentation.kind).toBe("player");
    if (presentation.kind !== "player") {
      throw new Error("Expected player presentation");
    }
    expect(presentation.status_label).toContain("replaying turn 1");
    expect(presentation.controls_locked).toBe(true);
  });

  it("shows a resolving status before replay motion begins", async () => {
    const state = await readBattleStateFixture();
    const session = makeSessionView(state, 1);
    const plotSummary = summarizePlotDraft(state, createPlotDraft(state, "alpha_ship"));
    const playbackStep: ResolutionPlaybackStep = {
      kind: "preroll",
      duration_ms: 100,
      display_sub_tick: 0,
      total_sub_ticks: state.match_setup.rules.turn.sub_ticks,
      ship_poses: makeShipPoses(state),
      focus_event: null,
      focus_event_index: null,
      focus_event_count: 0,
      exchange_event_index: null,
      exchange_event_count: 0,
      camera_transition_ratio: 0,
      progress_ratio: 0
    };
    const presentation = getActionStripPresentation({
      sessionValue: session,
      identityValue: makePlayerIdentity(),
      plotSummary,
      outcomePresentation: null,
      playbackStep,
      plotLocked: true,
      wsState: "connected"
    });

    expect(presentation.kind).toBe("player");
    if (presentation.kind !== "player") {
      throw new Error("Expected player presentation");
    }
    expect(presentation.status_label).toContain("resolving turn 1");
    expect(presentation.controls_locked).toBe(true);
  });

  it("adds a link-state suffix when the player bridge is disconnected", async () => {
    const state = await readBattleStateFixture();
    const session = makeSessionView(state, 1);
    const plotSummary = summarizePlotDraft(state, createPlotDraft(state, "alpha_ship"));
    const presentation = getActionStripPresentation({
      sessionValue: session,
      identityValue: makePlayerIdentity(),
      plotSummary,
      outcomePresentation: null,
      playbackStep: null,
      plotLocked: true,
      wsState: "closed"
    });

    expect(presentation.kind).toBe("player");
    if (presentation.kind !== "player") {
      throw new Error("Expected player presentation");
    }
    expect(presentation.status_label).toContain("closed");
    expect(presentation.controls_locked).toBe(true);
  });
});
