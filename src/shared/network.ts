import type { BattleState, PlotSubmission, ShipInstanceId, SlotId } from "./contracts.js";
import type { ResolverEvent } from "./resolver/types.js";

export interface SessionIdentity {
  client_id: string;
  role: "player" | "spectator";
  slot_id: SlotId | null;
  ship_instance_id: ShipInstanceId | null;
}

export interface MatchSessionView {
  battle_state: BattleState;
  pending_plot_ship_ids: ShipInstanceId[];
  occupied_slot_ids: SlotId[];
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
};

export type ServerToClientMessage =
  | {
      type: "hello";
      identity: SessionIdentity;
      session: MatchSessionView;
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
