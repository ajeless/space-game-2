# User Manual

> Lean guide for the currently playable duel build.

**Status:** current shipped behavior  
**Audience:** players and playtesters  
**Rule:** keep this aligned with the browser build, not with future ideas

## Starting a match

- The first two browser sessions normally occupy `alpha` and `bravo`.
- Extra sessions join as spectators.
- If a player disconnects, a spectator can reclaim the seat with `Claim <slot>` while the reconnect window is still open.

## Reading the bridge

- The top bar shows phase, turn, your station, and link status.
- The left panel is your SSD: ship state, system buttons, trim controls, and selected-system detail.
- The right panel is the ship-relative tactical scope: your ship stays centered and bow-up.
- The lower strips summarize current allocations, replay state, recent combat, and host-link status.

## Plotting movement

- Drag the burn handle on the tactical scope to set thrust.
- Drag the heading handle on the projected ghost to set end-of-turn heading.
- Use the SSD `Turn`, `Axial Trim`, and `Lateral Trim` controls for fine adjustment.
- `Station Keep` builds a no-drift plot from the current ship state.
- `R` resets the current draft.

## Authorizing fire

- Select `RAILGUN` on the SSD to enter `AIM MODE`.
- Click a contact on the tactical scope to lock or clear target.
- Set mount charge in the selected-system panel.
- `Clear Target` stands the mount down.
- `Esc` closes the selected-system panel.

## Submitting and replay

- `Space` or `Submit Plot` commits the current turn.
- After you submit, your controls stay locked until the exchange replay finishes.
- Once both players have submitted, the turn resolves automatically and the replay/feed strips show what happened.

## Damage and win conditions

- Hull damage always matters.
- Hits near major systems may also damage the local subsystem.
- System state is shown as `Operational`, `Degraded`, or `Offline`.
- A ship loses by hull destruction or by boundary disengagement.

## Reset flow

- `Reset Match` is a host/admin action, not a normal player control.
- When reset is enabled on the host, it appears under `Host Tools`.

## Update rule

- If a control label, lock rule, reclaim flow, or panel name changes in the shipped UI, update this manual in the same change.
