// Computes whether the local bridge should lock plot interaction (link down, plot submitted, or replay in flight).
// Depends on: shared session types and resolution_playback steps. Consumed by: src/client/main.ts and bridge_presenters.
// Invariant: lock state is derived; never persist it — recompute from session + link + playback on every render.

import type { MatchSessionView, SessionIdentity, ShipInstanceId } from "../shared/index.js";
import type { ResolutionPlaybackStep } from "./resolution_playback.js";

export type BridgeLinkState = "connecting" | "connected" | "closed" | "error";

export type PlotLockState = {
  reason: "submitted" | "replay" | "link";
  status_label: string;
  note_label: string;
};

export type OptimisticSubmittedPlot = {
  ship_instance_id: ShipInstanceId;
  turn_number: number;
};

export function reconcileOptimisticSubmittedPlot(input: {
  optimisticSubmittedPlot: OptimisticSubmittedPlot | null;
  sessionValue: MatchSessionView | null;
  identityValue: SessionIdentity | null;
  playbackStep: ResolutionPlaybackStep | null;
}): OptimisticSubmittedPlot | null {
  const { optimisticSubmittedPlot, sessionValue, identityValue, playbackStep } = input;

  if (!optimisticSubmittedPlot) {
    return null;
  }

  if (!sessionValue || !identityValue || identityValue.role !== "player" || !identityValue.ship_instance_id) {
    return null;
  }

  if (
    identityValue.ship_instance_id !== optimisticSubmittedPlot.ship_instance_id ||
    sessionValue.battle_state.turn_number !== optimisticSubmittedPlot.turn_number ||
    sessionValue.pending_plot_ship_ids.includes(identityValue.ship_instance_id) ||
    playbackStep
  ) {
    return null;
  }

  return optimisticSubmittedPlot;
}

export function getPlotLockState(input: {
  sessionValue: MatchSessionView | null;
  identityValue: SessionIdentity | null;
  playbackStep: ResolutionPlaybackStep | null;
  linkState: BridgeLinkState;
  optimisticSubmittedPlot: OptimisticSubmittedPlot | null;
}): PlotLockState | null {
  const { sessionValue, identityValue, playbackStep, linkState, optimisticSubmittedPlot } = input;

  if (!sessionValue || !identityValue || identityValue.role !== "player" || !identityValue.ship_instance_id) {
    return null;
  }

  if (linkState !== "connected") {
    return {
      reason: "link",
      status_label: "Host link unavailable",
      note_label: "Host link unavailable. Plot controls stay paused until the bridge reconnects."
    };
  }

  const shipInstanceId = identityValue.ship_instance_id;
  const hasOptimisticSubmit =
    optimisticSubmittedPlot?.ship_instance_id === shipInstanceId &&
    optimisticSubmittedPlot.turn_number === sessionValue.battle_state.turn_number;

  if (sessionValue.pending_plot_ship_ids.includes(shipInstanceId) || hasOptimisticSubmit) {
    return {
      reason: "submitted",
      status_label: "Orders submitted",
      note_label: "Orders are committed. Plot controls stay locked until the turn replay completes."
    };
  }

  if (playbackStep) {
    return {
      reason: "replay",
      status_label: "Replay in progress",
      note_label: "The previous exchange is still replaying. Plot controls unlock when replay completes."
    };
  }

  return null;
}

export function isPlotInteractionLocked(input: Parameters<typeof getPlotLockState>[0]): boolean {
  return getPlotLockState(input) !== null;
}
