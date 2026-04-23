# Playtest Backlog

> Created in this repository on 2026-04-23.
> This is a scratch capture for playtest observations, deferred suggestions, and future-slice notes that should not get lost between sessions.

**Status:** active scratch list
**Purpose:** capture live playtest feedback without prematurely rewriting design docs
**Rule:** items here are not automatically scheduled or committed for the current slice

## Triage buckets

- `Fix now` means the issue is breaking interaction, misleading the player, or cheap to repair while touching the same code.
- `v0.2 cleanup` means near-term polish or structure work that still fits the current cleanup pass.
- `Post-v0.2` means valid product direction, architecture, or moddability notes that should be revisited during later planning.

## 2026-04-23 playtest capture

### v0.2 cleanup

- Resolution after both plots submit still feels abrupt. Add a later pass for smoother post-submit / resolve motion that takes better advantage of the existing sub-tick event model, without committing yet to a full replay-control UX.

### Post-v0.2

- The right-side play surface may eventually need multiple dedicated station views instead of one tactical pane that tries to carry navigation, combat, engineering, and other future ship-management tasks at once.
- If station-specific views are added, the long-term direction should stay data-driven and moddable rather than hard-coding one fixed shell for every ruleset or ship family.
- Hosts may eventually need a dedicated admin/session view rather than one-off destructive buttons scattered through normal player chrome. That view could later own reset, match settings, moderation, scenario controls, and other host-only actions.
- Weapon range and hit-probability tuning should keep moving toward explicit strategy/config ownership. The current numeric weights are already data-driven, but the overall probability formula and strategy selection still live in code. Future systems such as ECM or other fire-control modifiers should plug into declared combat-resolution strategy seams rather than hard-coded one-off checks.
- As combat rules settle by version, capture the shipped hit/range model more thoroughly in the developer and player docs so tuning intent, player-facing expectations, and extension seams stay explicit.
- The SSD should eventually communicate hit registration more spatially, not only through subsystem condition numbers and labels. A future pass should explore recent-hit or damage tinting on the hull outline or nearby sections of the wireframe.
- Any richer SSD damage visualization should stay anchored to physical hit data rather than cosmetic-only layout. The current resolver already emits impact points and nearby impacted subsystems, so the likely missing work is presentation plus any future expansion of per-system hit footprints.
