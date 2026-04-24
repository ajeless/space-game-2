import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getPlotLockState,
  isPlotInteractionLocked,
  reconcileOptimisticSubmittedPlot,
  type OptimisticSubmittedPlot
} from "../src/client/bridge_plot_lock.js";
import type { ResolutionPlaybackStep } from "../src/client/resolution_playback.js";
import { validateBattleState, type MatchSessionView, type SessionIdentity } from "../src/shared/index.js";

async function readJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const raw = await readFile(absolutePath, "utf8");

  return JSON.parse(raw) as unknown;
}

async function readBattleStateFixture() {
  return validateBattleState(await readJson("fixtures/battle_states/default_duel_turn_1.json"));
}

function makeSessionView(
  state: Awaited<ReturnType<typeof readBattleStateFixture>>,
  pendingPlotShipIds: string[] = []
): MatchSessionView {
  return {
    battle_state: state,
    pending_plot_ship_ids: pendingPlotShipIds,
    occupied_slot_ids: state.match_setup.participants.map((participant) => participant.slot_id),
    slot_states: state.match_setup.participants.map((participant) => ({
      slot_id: participant.slot_id,
      ship_instance_id: participant.ship_instance_id,
      connection_state: "connected" as const
    })),
    last_resolution: null
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

function makePlaybackStep(): ResolutionPlaybackStep {
  return {
    kind: "motion",
    duration_ms: 100,
    display_sub_tick: 4,
    total_sub_ticks: 60,
    ship_poses: {
      alpha_ship: {
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        heading_degrees: 0
      },
      bravo_ship: {
        position: { x: 100, y: 0 },
        velocity: { x: 0, y: 0 },
        heading_degrees: 180
      }
    },
    focus_event: null,
    focus_event_index: null,
    focus_event_count: 0,
    exchange_event_index: null,
    exchange_event_count: 0,
    camera_transition_ratio: 0.25,
    progress_ratio: 0.2
  };
}

describe("bridge plot lock state", () => {
  it("locks plotting when the bridge link is unavailable", async () => {
    const state = await readBattleStateFixture();

    expect(
      getPlotLockState({
        sessionValue: makeSessionView(state),
        identityValue: makePlayerIdentity(),
        playbackStep: null,
        linkState: "closed",
        optimisticSubmittedPlot: null
      })
    ).toEqual({
      reason: "link",
      status_label: "Host link unavailable",
      note_label: "Host link unavailable. Plot controls stay paused until the bridge reconnects."
    });
  });

  it("keeps plotting locked after a local optimistic submit until the host catches up", async () => {
    const state = await readBattleStateFixture();
    const optimisticSubmittedPlot: OptimisticSubmittedPlot = {
      ship_instance_id: "alpha_ship",
      turn_number: state.turn_number
    };

    const lockState = getPlotLockState({
      sessionValue: makeSessionView(state),
      identityValue: makePlayerIdentity(),
      playbackStep: null,
      linkState: "connected",
      optimisticSubmittedPlot
    });

    expect(lockState?.reason).toBe("submitted");
    expect(isPlotInteractionLocked({
      sessionValue: makeSessionView(state),
      identityValue: makePlayerIdentity(),
      playbackStep: null,
      linkState: "connected",
      optimisticSubmittedPlot
    })).toBe(true);
  });

  it("switches to replay lock once the previous exchange is still playing", async () => {
    const state = await readBattleStateFixture();

    const lockState = getPlotLockState({
      sessionValue: makeSessionView(state),
      identityValue: makePlayerIdentity(),
      playbackStep: makePlaybackStep(),
      linkState: "connected",
      optimisticSubmittedPlot: null
    });

    expect(lockState?.reason).toBe("replay");
    expect(lockState?.note_label).toContain("unlock when replay completes");
  });

  it("never exposes a player plot lock state to spectators", async () => {
    const state = await readBattleStateFixture();

    expect(
      getPlotLockState({
        sessionValue: makeSessionView(state),
        identityValue: {
          client_id: "spectator",
          role: "spectator",
          slot_id: null,
          ship_instance_id: null,
          reconnect_token: null
        },
        playbackStep: makePlaybackStep(),
        linkState: "connected",
        optimisticSubmittedPlot: null
      })
    ).toBeNull();
  });

  it("clears optimistic submit markers once replay starts or the session moves on", async () => {
    const state = await readBattleStateFixture();
    const optimisticSubmittedPlot: OptimisticSubmittedPlot = {
      ship_instance_id: "alpha_ship",
      turn_number: state.turn_number
    };

    expect(
      reconcileOptimisticSubmittedPlot({
        optimisticSubmittedPlot,
        sessionValue: makeSessionView(state),
        identityValue: makePlayerIdentity(),
        playbackStep: null
      })
    ).toEqual(optimisticSubmittedPlot);

    expect(
      reconcileOptimisticSubmittedPlot({
        optimisticSubmittedPlot,
        sessionValue: makeSessionView(state),
        identityValue: makePlayerIdentity(),
        playbackStep: makePlaybackStep()
      })
    ).toBeNull();

    const nextTurnState = structuredClone(state);
    nextTurnState.turn_number += 1;

    expect(
      reconcileOptimisticSubmittedPlot({
        optimisticSubmittedPlot,
        sessionValue: makeSessionView(nextTurnState),
        identityValue: makePlayerIdentity(),
        playbackStep: null
      })
    ).toBeNull();
  });
});
