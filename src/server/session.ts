import { randomUUID } from "node:crypto";
import type { BattleState, PlotSubmission, ShipInstanceId, SlotId } from "../shared/contracts.js";
import { resolve, validateBattleState, validatePlotSubmission } from "../shared/index.js";
import type { MatchSessionView, SessionIdentity } from "../shared/network.js";

interface SessionSubmitResult {
  plot: PlotSubmission;
  resolution_committed: boolean;
  session: MatchSessionView;
}

interface SessionConnectResult {
  identity: SessionIdentity;
  displaced_client_id: string | null;
}

interface SessionClaimResult {
  identity: SessionIdentity;
  session: MatchSessionView;
}

interface MatchSessionOptions {
  reconnect_grace_ms?: number;
  now?: () => number;
}

interface PlayerReservation {
  slot_id: SlotId;
  ship_instance_id: ShipInstanceId;
  reconnect_token: string;
  client_id: string | null;
  disconnected_at_ms: number | null;
}

const DEFAULT_RECONNECT_GRACE_MS = 120000;

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
  private readonly reservations = new Map<ShipInstanceId, PlayerReservation>();
  private readonly reconnectGraceMs: number;
  private readonly now: () => number;

  constructor(initialState: BattleState, options: MatchSessionOptions = {}) {
    this.battleState = clone(validateBattleState(initialState));
    this.reconnectGraceMs = options.reconnect_grace_ms ?? DEFAULT_RECONNECT_GRACE_MS;
    this.now = options.now ?? Date.now;
  }

  private sweepExpiredReservations(): void {
    if (this.reconnectGraceMs <= 0) {
      for (const [shipId, reservation] of this.reservations.entries()) {
        if (reservation.client_id === null) {
          this.reservations.delete(shipId);
        }
      }

      return;
    }

    const now = this.now();

    for (const [shipId, reservation] of this.reservations.entries()) {
      if (reservation.client_id !== null || reservation.disconnected_at_ms === null) {
        continue;
      }

      if (now - reservation.disconnected_at_ms >= this.reconnectGraceMs) {
        this.reservations.delete(shipId);
      }
    }
  }

  private makePlayerIdentity(clientId: string, reservation: PlayerReservation): SessionIdentity {
    return {
      client_id: clientId,
      role: "player",
      slot_id: reservation.slot_id,
      ship_instance_id: reservation.ship_instance_id,
      reconnect_token: reservation.reconnect_token
    };
  }

  private makeSpectatorIdentity(clientId: string): SessionIdentity {
    return {
      client_id: clientId,
      role: "spectator",
      slot_id: null,
      ship_instance_id: null,
      reconnect_token: null
    };
  }

  connectClient(clientId: string, requestedReconnectToken: string | null = null): SessionConnectResult {
    this.sweepExpiredReservations();

    if (requestedReconnectToken) {
      const existingReservation = Array.from(this.reservations.values()).find(
        (reservation) => reservation.reconnect_token === requestedReconnectToken
      );

      if (existingReservation) {
        const displacedClientId =
          existingReservation.client_id && existingReservation.client_id !== clientId
            ? existingReservation.client_id
            : null;

        if (displacedClientId) {
          this.identities.delete(displacedClientId);
        }

        existingReservation.client_id = clientId;
        existingReservation.disconnected_at_ms = null;
        const identity = this.makePlayerIdentity(clientId, existingReservation);
        this.identities.set(clientId, identity);

        return {
          identity,
          displaced_client_id: displacedClientId
        };
      }
    }

    const openParticipant = this.battleState.match_setup.participants.find(
      (participant) => !this.reservations.has(participant.ship_instance_id)
    );

    if (openParticipant) {
      const reservation: PlayerReservation = {
        slot_id: openParticipant.slot_id,
        ship_instance_id: openParticipant.ship_instance_id,
        reconnect_token: randomUUID(),
        client_id: clientId,
        disconnected_at_ms: null
      };

      this.reservations.set(reservation.ship_instance_id, reservation);
      const identity = this.makePlayerIdentity(clientId, reservation);
      this.identities.set(clientId, identity);

      return {
        identity,
        displaced_client_id: null
      };
    }

    const identity = this.makeSpectatorIdentity(clientId);
    this.identities.set(clientId, identity);

    return {
      identity,
      displaced_client_id: null
    };
  }

  disconnectClient(clientId: string): void {
    const identity = this.identities.get(clientId);
    this.identities.delete(clientId);

    if (!identity || identity.role !== "player" || !identity.ship_instance_id) {
      return;
    }

    const reservation = this.reservations.get(identity.ship_instance_id);

    if (!reservation || reservation.client_id !== clientId) {
      return;
    }

    reservation.client_id = null;
    reservation.disconnected_at_ms = this.now();
  }

  getIdentity(clientId: string): SessionIdentity | undefined {
    const identity = this.identities.get(clientId);
    return identity ? clone(identity) : undefined;
  }

  getView(): MatchSessionView {
    this.sweepExpiredReservations();

    return {
      battle_state: clone(this.battleState),
      pending_plot_ship_ids: Array.from(this.pendingPlots.keys()).sort(),
      occupied_slot_ids: Array.from(this.reservations.values())
        .filter((reservation) => reservation.client_id !== null)
        .map((reservation) => reservation.slot_id)
        .sort(),
      slot_states: this.battleState.match_setup.participants.map((participant) => {
        const reservation = this.reservations.get(participant.ship_instance_id);

        return {
          slot_id: participant.slot_id,
          ship_instance_id: participant.ship_instance_id,
          connection_state:
            !reservation ? "open" : reservation.client_id !== null ? "connected" : "reconnecting"
        };
      }),
      last_resolution: this.lastResolution ? clone(this.lastResolution) : null
    };
  }

  reset(nextState: BattleState): MatchSessionView {
    this.battleState = clone(validateBattleState(nextState));
    this.pendingPlots.clear();
    this.lastResolution = null;

    const nextParticipantsByShipId = new Map(
      this.battleState.match_setup.participants.map((participant) => [participant.ship_instance_id, participant])
    );

    for (const [shipId, reservation] of this.reservations.entries()) {
      const nextParticipant = nextParticipantsByShipId.get(shipId);

      if (!nextParticipant) {
        this.reservations.delete(shipId);
        continue;
      }

      reservation.slot_id = nextParticipant.slot_id;
    }

    for (const [clientId, identity] of this.identities.entries()) {
      if (identity.ship_instance_id && !nextParticipantsByShipId.has(identity.ship_instance_id)) {
        this.identities.set(clientId, {
          client_id: identity.client_id,
          role: "spectator",
          slot_id: null,
          ship_instance_id: null,
          reconnect_token: null
        });
        continue;
      }

      if (identity.ship_instance_id) {
        const reservation = this.reservations.get(identity.ship_instance_id);

        if (reservation) {
          this.identities.set(clientId, this.makePlayerIdentity(clientId, reservation));
        }
      }
    }

    return this.getView();
  }

  claimSlot(clientId: string, slotId: SlotId): SessionClaimResult {
    this.sweepExpiredReservations();

    const identity = this.identities.get(clientId);

    if (!identity) {
      throw new Error("unknown client");
    }

    if (identity.role === "player" && identity.slot_id === slotId) {
      return {
        identity: clone(identity),
        session: this.getView()
      };
    }

    const participant = this.battleState.match_setup.participants.find((candidate) => candidate.slot_id === slotId);

    if (!participant) {
      throw new Error(`unknown slot '${slotId}'`);
    }

    const reservation = this.reservations.get(participant.ship_instance_id);

    if (reservation?.client_id !== null) {
      throw new Error(`slot '${slotId}' is already occupied`);
    }

    if (identity.role === "player" && identity.ship_instance_id) {
      const previousReservation = this.reservations.get(identity.ship_instance_id);

      if (previousReservation?.client_id === clientId) {
        previousReservation.client_id = null;
        previousReservation.disconnected_at_ms = this.now();
      }
    }

    const nextReservation: PlayerReservation =
      reservation ?? {
        slot_id: participant.slot_id,
        ship_instance_id: participant.ship_instance_id,
        reconnect_token: randomUUID(),
        client_id: null,
        disconnected_at_ms: null
      };

    nextReservation.slot_id = participant.slot_id;
    nextReservation.client_id = clientId;
    nextReservation.disconnected_at_ms = null;
    nextReservation.reconnect_token = randomUUID();
    this.reservations.set(nextReservation.ship_instance_id, nextReservation);

    const nextIdentity = this.makePlayerIdentity(clientId, nextReservation);
    this.identities.set(clientId, nextIdentity);

    return {
      identity: clone(nextIdentity),
      session: this.getView()
    };
  }

  submitPlot(clientId: string, plotInput: unknown): SessionSubmitResult {
    const identity = this.identities.get(clientId);

    if (!identity) {
      throw new Error("unknown client");
    }

    if (identity.role !== "player" || !identity.ship_instance_id) {
      throw new Error("spectators cannot submit plots");
    }

    if (this.battleState.outcome.end_reason !== null) {
      throw new Error("match already ended");
    }

    if (this.pendingPlots.has(identity.ship_instance_id)) {
      throw new Error(`plot already submitted for '${identity.ship_instance_id}' on turn ${this.battleState.turn_number}`);
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
