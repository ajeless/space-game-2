# Remote Play Runbook

> Current host workflow for the shipped peer-hosted duel build.

**Status:** shipped workflow  
**Scope:** local host, same-machine smoke tests, and Cloudflare Tunnel sessions

## Goal

Start the local host, expose it through a tunnel if needed, and verify that two browser sessions can play the same duel over HTTP + WebSocket without code changes.

## Current server knobs

The host server reads these environment variables:

- `SG2_HOST`
  Default: `127.0.0.1`
- `SG2_PORT`
  Default: `8000`
- `SG2_BATTLE_STATE_FIXTURE`
  Default: `fixtures/battle_states/default_duel_turn_1.json`
- `SG2_ADMIN_TOKEN`
  Optional. Enables authenticated session reset.
- `SG2_EXTERNAL_ORIGIN`
  Optional. Diagnostic only. Logs the public origin the host expects remote players to use.
- `SG2_RECONNECT_GRACE_MS`
  Optional. Default: `120000`. How long a disconnected player slot stays reserved before it becomes claimable.

## Local host startup

Build once:

```bash
npm run build
```

Start the server:

```bash
SG2_PORT=8000 npm run start:server
```

Optional host reset support:

```bash
SG2_PORT=8000 SG2_ADMIN_TOKEN=change-me npm run start:server
```

The server serves:

- browser client on `/`
- health endpoint on `/api/health`
- websocket endpoint on `/ws`

## Cloudflare Tunnel

With `cloudflared` installed locally:

```bash
cloudflared tunnel --url http://127.0.0.1:8000
```

If you want logs to show the public URL you handed to the other player:

```bash
SG2_EXTERNAL_ORIGIN=https://your-public-url.trycloudflare.com SG2_PORT=8000 npm run start:server
```

The client uses a relative WebSocket URL, so tunnel sessions naturally switch to `wss://.../ws`.

## Smoke workflow

1. Start the server locally.
2. Start the Cloudflare Tunnel if you want a real internet path.
3. Open one browser session at `http://127.0.0.1:8000/`.
4. Open a second isolated session or profile at either the same local origin or the tunnel URL.
5. Confirm:
   - the first two sessions occupy `alpha` and `bravo`
   - both sessions show `PLOT PHASE`
   - both players can submit plots
   - the turn resolves and replays after both plots arrive
   - plotting stays locked until the replay finishes

## Reconnect and reclaim expectations

Current shipped behavior:

- Reloading the same claimed browser session should resume the same seat through the stored reconnect token.
- If a player disappears long enough for another browser to notice the slot as reconnecting/open, a spectator can reclaim it with `Claim <slot>`.
- While the host link is down, live plot controls stay disabled.

This is the behavior the browser smoke suite now protects.

## Resetting the session

Reset is disabled unless `SG2_ADMIN_TOKEN` is set.

When enabled:

- localhost sessions can open `Host Tools` and trigger `Reset Match`
- the browser stores the token locally after the first successful reset
- the server reloads the configured fixture, clears pending plots, clears the last resolution, and broadcasts the reset

Manual reset request:

```bash
curl -X POST \
  -H 'x-sg2-admin-token: change-me' \
  http://127.0.0.1:8000/api/session/reset
```

## Local verification commands

Current regression battery:

```bash
npm run typecheck
npm run test
npm run build
npm run test:browser:smoke
```

Use the browser smoke suite before and after remote-play work that touches reconnect, reclaim, reset, replay lock, or match-end flow.

## Remaining manual concerns

- real internet/tunnel testing is still manual rather than CI-driven
- there is no room discovery or room-code flow yet
- host/admin workflow still lives inside the main player shell rather than a dedicated host view
