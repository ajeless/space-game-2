# Remote Play Runbook

> Created in this repository on 2026-04-21.
> This runbook captures the minimum host workflow for peer-hosted internet testing in `v0.1`.

**Status:** working host runbook  
**Scope:** local host + Cloudflare Tunnel smoke testing

## Goal

Start the local host, expose it through a tunnel, and verify that two browser sessions can connect to the same match over HTTP + WebSocket without changing code.

## Current server knobs

The host server now reads these environment variables:

- `SG2_HOST`
  Default: `127.0.0.1`
- `SG2_PORT`
  Default: `8000`
- `SG2_BATTLE_STATE_FIXTURE`
  Default: `fixtures/battle_states/default_duel_turn_1.json`
- `SG2_ADMIN_TOKEN`
  Optional. Enables the authenticated session reset endpoint.
- `SG2_EXTERNAL_ORIGIN`
  Optional. Purely diagnostic for now. Shows what public origin the host expects remote players to use.
- `SG2_RECONNECT_GRACE_MS`
  Optional. Default: `120000`. How long a disconnected player slot stays reserved for reconnect before it becomes open again.

## Local host startup

Build once:

```bash
npm run build
```

Start the server:

```bash
SG2_PORT=8000 npm run start:server
```

Optional reset support for the host:

```bash
SG2_PORT=8000 SG2_ADMIN_TOKEN=change-me npm run start:server
```

The server serves:

- browser client on `/`
- health endpoint on `/api/health`
- websocket endpoint on `/ws`

## Cloudflare Tunnel

With `cloudflared` installed locally, expose the host with:

```bash
cloudflared tunnel --url http://127.0.0.1:8000
```

If you want the server logs to show the public URL you are handing to the other player, start the server with:

```bash
SG2_EXTERNAL_ORIGIN=https://your-public-url.trycloudflare.com SG2_PORT=8000 npm run start:server
```

This value is informational only. The client already uses a relative websocket URL, so it will naturally switch to `wss://.../ws` when opened through an HTTPS tunnel URL.

## First smoke test

1. Start the server locally.
2. Start the Cloudflare Tunnel.
3. Open one browser session at `http://127.0.0.1:8000/`.
4. Open a second isolated browser session or profile at the tunnel URL.
5. Confirm:
   - first session claims `alpha`
   - second session claims `bravo`
   - both sessions show the other slot as occupied
   - both clients stay connected over WebSocket
   - both players can submit plots
   - the turn resolves after both plots arrive

If a fully fresh browser context reconnects after a player slot was disconnected and lost its local reconnect token, it can reclaim the reserved seat with the in-app `Claim <slot>` control while that slot is still marked `reconnecting`.

## Resetting the session

The reset endpoint is intentionally disabled unless `SG2_ADMIN_TOKEN` is set.

When reset is enabled, the browser UI also exposes a minimal `Reset match` button. The first use prompts for the admin token locally, then reuses it from browser storage for later resets.

When enabled, reset the current match with:

```bash
curl -X POST \
  -H 'x-sg2-admin-token: change-me' \
  http://127.0.0.1:8000/api/session/reset
```

This reloads the configured battle-state fixture, clears pending plots, clears the last resolution summary, and broadcasts a `session_reset` event plus fresh `session_state` to connected clients.

## What this slice does not solve yet

- persistent room codes or room discovery
- host UI for reset / new match
- reconnect recovery beyond reclaiming the now-open player slot
- public internet hardening beyond the optional reset token
- automated end-to-end tunnel testing inside CI

## Recommended follow-up after the first tunnel smoke

- record what failed in a short host-network punch list
- only then decide whether the next network slice is reconnect handling, host controls, or stricter admin/auth boundaries
