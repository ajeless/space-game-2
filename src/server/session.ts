import type { BattleState, PlotSubmission, ShipInstanceId, SlotId } from "../shared/contracts.js";
import { resolve, validateBattleState, validatePlotSubmission } from "../shared/index.js";
import type { MatchSessionView, SessionIdentity } from "../shared/network.js";

interface SessionSubmitResult {
  plot: PlotSubmission;
  resolution_committed: boolean;
  session: MatchSessionView;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function getActiveShipIds(state: BattleState): ShipInstanceId[] {
  return state.match_setup.participants
    .map((participant) => participant.ship_instance_id)
    .filter((shipId) => state.ships[shipId]?.status === "active")
    .sort();
}

function makeSeed(state: BattleState): string {
  return `${state.match_setup.seed_root}:turn:${state.turn_number}`;
}

export class MatchSession {
  private battleState: BattleState;
  private readonly identities = new Map<string, SessionIdentity>();
  private readonly pendingPlots = new Map<ShipInstanceId, PlotSubmission>();
  private lastResolution: MatchSessionView["last_resolution"] = null;

  constructor(initialState: BattleState) {
    this.battleState = clone(validateBattleState(initialState));
  }

  connectClient(clientId: string): SessionIdentity {
    const openParticipant = this.battleState.match_setup.participants.find(
      (participant) =>
        !Array.from(this.identities.values()).some(
          (identity) => identity.ship_instance_id === participant.ship_instance_id
        )
    );

    const identity: SessionIdentity = openParticipant
      ? {
          client_id: clientId,
          role: "player",
          slot_id: openParticipant.slot_id,
          ship_instance_id: openParticipant.ship_instance_id
        }
      : {
          client_id: clientId,
          role: "spectator",
          slot_id: null,
          ship_instance_id: null
        };

    this.identities.set(clientId, identity);

    return identity;
  }

  disconnectClient(clientId: string): void {
    this.identities.delete(clientId);
  }

  getIdentity(clientId: string): SessionIdentity | undefined {
    const identity = this.identities.get(clientId);
    return identity ? clone(identity) : undefined;
  }

  getView(): MatchSessionView {
    return {
      battle_state: clone(this.battleState),
      pending_plot_ship_ids: Array.from(this.pendingPlots.keys()).sort(),
      occupied_slot_ids: Array.from(this.identities.values())
        .map((identity) => identity.slot_id)
        .filter((slotId): slotId is SlotId => slotId !== null)
        .sort(),
      last_resolution: this.lastResolution ? clone(this.lastResolution) : null
    };
  }

  reset(nextState: BattleState): MatchSessionView {
    this.battleState = clone(validateBattleState(nextState));
    this.pendingPlots.clear();
    this.lastResolution = null;

    const validShipIds = new Set(this.battleState.match_setup.participants.map((participant) => participant.ship_instance_id));

    for (const [clientId, identity] of this.identities.entries()) {
      if (identity.ship_instance_id && !validShipIds.has(identity.ship_instance_id)) {
        this.identities.set(clientId, {
          client_id: identity.client_id,
          role: "spectator",
          slot_id: null,
          ship_instance_id: null
        });
      }
    }

    return this.getView();
  }

  submitPlot(clientId: string, plotInput: unknown): SessionSubmitResult {
    const identity = this.identities.get(clientId);

    if (!identity) {
      throw new Error("unknown client");
    }

    if (identity.role !== "player" || !identity.ship_instance_id) {
      throw new Error("spectators cannot submit plots");
    }

    const plot = validatePlotSubmission(plotInput, this.battleState);

    if (plot.ship_instance_id !== identity.ship_instance_id) {
      throw new Error(`client may only submit plots for '${identity.ship_instance_id}'`);
    }

    this.pendingPlots.set(plot.ship_instance_id, plot);

    const activeShipIds = getActiveShipIds(this.battleState);
    const readyToResolve = activeShipIds.every((shipId) => this.pendingPlots.has(shipId));

    if (!readyToResolve) {
      return {
        plot,
        resolution_committed: false,
        session: this.getView()
      };
    }

    const plotsByShip = Object.fromEntries(
      activeShipIds.map((shipId) => {
        const pendingPlot = this.pendingPlots.get(shipId);

        if (!pendingPlot) {
          throw new Error(`missing pending plot for '${shipId}' at resolution time`);
        }

        return [shipId, pendingPlot];
      })
    ) as Record<ShipInstanceId, PlotSubmission>;
    const resolvedFromTurnNumber = this.battleState.turn_number;
    const output = resolve({
      state: this.battleState,
      plots_by_ship: plotsByShip,
      seed: makeSeed(this.battleState)
    });

    this.battleState = output.next_state;
    this.pendingPlots.clear();
    this.lastResolution = {
      resolved_from_turn_number: resolvedFromTurnNumber,
      event_count: output.events.length,
      events: output.events
    };

    return {
      plot,
      resolution_committed: true,
      session: this.getView()
    };
  }
}
