// Owns the bridge WebSocket: connect, reconnect-on-close, send, and link-state reporting.
// Depends on: shared ServerToClientMessage type, bridge_plot_lock BridgeLinkState. Consumed by: src/client/main.ts.
// Invariant: close code 4001 signals host-initiated takeover; callers must not auto-reconnect in that case.

import type { ServerToClientMessage } from "../shared/index.js";
import type { BridgeLinkState } from "./bridge_plot_lock.js";

export type BridgeConnectionCallbacks = {
  onLinkStateChange: (state: BridgeLinkState) => void;
  onServerMessage: (message: ServerToClientMessage) => void;
  onLogMessage: (message: string) => void;
  getReconnectToken: () => string | null;
};

export type BridgeConnection = {
  send: (message: unknown) => boolean;
  isOpen: () => boolean;
  cancelPendingReconnect: () => void;
};

const RECONNECT_DELAY_MS = 1000;
const HOST_TAKEOVER_CLOSE_CODE = 4001;

export function connectBridgeWebSocket(callbacks: BridgeConnectionCallbacks): BridgeConnection {
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;

  function openSocket(): void {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const reconnectToken = callbacks.getReconnectToken();
    const url = new URL(`${protocol}//${window.location.host}/ws`);

    if (reconnectToken) {
      url.searchParams.set("reconnectToken", reconnectToken);
    }

    const nextSocket = new WebSocket(url.toString());
    socket = nextSocket;

    nextSocket.addEventListener("open", () => {
      callbacks.onLinkStateChange("connected");
    });

    nextSocket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerToClientMessage;
      callbacks.onServerMessage(message);
    });

    nextSocket.addEventListener("close", (event) => {
      // Log before onLinkStateChange("closed") so the "link closed" message
      // lands in the render that the state change triggers.
      if (event.code !== HOST_TAKEOVER_CLOSE_CODE) {
        callbacks.onLogMessage("link closed");
      }
      if (event.code !== HOST_TAKEOVER_CLOSE_CODE && reconnectTimer === null) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          callbacks.onLinkStateChange("connecting");
          openSocket();
        }, RECONNECT_DELAY_MS);
      }
      callbacks.onLinkStateChange("closed");
    });

    nextSocket.addEventListener("error", () => {
      callbacks.onLogMessage("link error");
      callbacks.onLinkStateChange("error");
    });
  }

  openSocket();

  return {
    send(message) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(JSON.stringify(message));
      return true;
    },
    isOpen() {
      return socket !== null && socket.readyState === WebSocket.OPEN;
    },
    cancelPendingReconnect() {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }
  };
}
