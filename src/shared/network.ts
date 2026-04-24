// Wire types for the bridge WebSocket: the client/server message union, session identity, and match session view payloads.
// Depends on: shared contracts and resolver event types. Consumed by: src/server/app.ts and src/client/main.ts.
// Invariant: changing a message shape requires a server and client update in lockstep.

import type { BattleState, PlotSubmission, ShipInstanceId, SlotId } from "./contracts.js";
import type { ResolverEvent } from "./resolver/types.js";

export interface SessionSlotState {
  slot_id: SlotId;
  ship_instance_id: ShipInstanceId;
  connection_state: "connected" | "reconnecting" | "open";
}

export interface SessionIdentity {
  client_id: string;
  role: "player" | "spectator";
  slot_id: SlotId | null;
  ship_instance_id: ShipInstanceId | null;
  reconnect_token: string | null;
}

export interface MatchSessionView {
  battle_state: BattleState;
  pending_plot_ship_ids: ShipInstanceId[];
  occupied_slot_ids: SlotId[];
  slot_states: SessionSlotState[];
  last_resolution:
    | {
        resolved_from_turn_number: number;
        event_count: number;
        events: ResolverEvent[];
      }
    | null;
}

export type ClientToServerMessage = {
  type: "submit_plot";
  plot: PlotSubmission;
} | {
  type: "claim_slot";
  slot_id: SlotId;
};

export type ServerToClientMessage =
  | {
      type: "hello";
      identity: SessionIdentity;
      session: MatchSessionView;
    }
  | {
      type: "session_reset";
      matchId: string;
      turnNumber: number;
    }
  | {
      type: "session_state";
      session: MatchSessionView;
    }
  | {
      type: "plot_accepted";
      shipInstanceId: ShipInstanceId;
      turnNumber: number;
      pendingPlotShipIds: ShipInstanceId[];
    }
  | {
      type: "plot_rejected";
      message: string;
    }
  | {
      type: "error";
      message: string;
    };
