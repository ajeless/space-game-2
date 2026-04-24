# PLAN

> Canonical backlog and deferred-work capture for the repository after the final `v0.2` stabilization pass.
> If a task is unfinished, deferred, speculative, or only loosely scheduled, it belongs here rather than in multiple slice-era notes.

**Status:** active handoff doc  
**Current shipped baseline:** `v0.2` duel build on top of the unchanged `sg2/v0.1` rules/contracts  
**Rule:** preserve the shipped duel behavior unless a real defect forces a change

## Current baseline

The shipped build now includes:

- peer-hosted remote play with reconnect, reclaim, and reset hardening
- SSD aim-mode and combat-presentation cleanup
- replay-locked plotting and browser regression coverage
- a documented local config seam for current bridge presentation tunables

The combat schema, resolver rules, ship data, and fixture contracts are still the `v0.1` baseline. `v0.2` changed maintainability, presentation, and workflow clarity, not gameplay scope.

## Near-term post-v0.2 work

### Presentation and usability

- Separate current drift cues, planned burn cues, and ghost/end-state cues even more clearly on the tactical scope.
- Give contact markers and closure/bearing labels another readability pass once more live combat cases are exercised.
- Compress header, action-strip, and footer copy further now that the main information hierarchy is stable.
- Decide whether the SSD trim sliders stay, shrink, or get redesigned once later system controls start competing for the same space.
- Add restrained sound and replay-motion polish only where it materially improves state readability.
- Add more spatial SSD hit feedback using existing impact-point data, without turning cosmetic layout into gameplay state.
- Reserve any broad typography, spacing, or art-direction overhaul for a deliberate visual redesign pass rather than incremental cleanup.

### Host and session workflow

- Decide whether host/admin actions should move into a dedicated session-management view instead of staying inside normal player chrome.
- Revisit room discovery, room codes, and stronger host/admin boundaries only when peer-host friction becomes the actual bottleneck.
- Keep reconnect/reclaim coverage expanding only around real failure modes found in live remote play.

### Codebase maintenance

- Continue splitting oversized client files where seams are already stable, especially `src/client/style.css` and any future growth in the bridge shell.
- Keep current presentation tunables centralized in local config seams before considering a fully external planner/UI config file.
- Preserve the data-driven boundary between resolver contracts, shared plot-authoring logic, and client-only presentation bindings.

## Later-slice product direction

- Explore whether later gameplay wants multiple dedicated station views instead of one tactical pane carrying every future bridge responsibility.
- If station-specific views or richer rulesets arrive, keep the planner/UI layer data-driven rather than hard-coding one fixed shell per ship or ruleset.
- Expand combat-resolution strategy seams in explicit, documented ways before adding systems such as ECM or richer fire-control modifiers.
- Revisit module/mod support only when there is a concrete second ruleset, ship family, or extension workflow that earns it.

## Research and long-horizon questions

- What is the state of classical tactical game AI for WEGO combat with large plot spaces and imperfect information?
- What is the right split between deterministic tactical AI and LLM-driven presentation or explanation?
- How can an AI opponent feel like a ship commander without putting an LLM on the tactical critical path?
- What should procedural generation contribute to scenarios, missions, or campaign structure once those become scope?
- What does imitation learning from player data look like once there is enough data to matter?
- What safeguards keep future AI opponents challenging without cheating on information or reaction time?

## Planning rules

- Update this file when work is deferred, not the design docs.
- Update the design docs when shipped behavior or contracts change.
- Remove stale plan items rather than letting them accumulate as historical debris.
