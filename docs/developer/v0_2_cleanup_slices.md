# v0.2 Cleanup Slices

> Created in this repository on 2026-04-23.
> This note extends `v0.2` as a sequence of bounded cleanup slices without changing its phase label.

**Status:** draft  
**Scope:** remaining `v0.2` cleanup ordering  
**Last updated:** 2026-04-23

## Summary

`v0.2` remains a cleanup/polish phase. It can still take several slices.

This note complements the active `v0.2` cleanup planning and gives a practical execution order for the work that still fits the current phase. It does not recast `v0.2` as redesign.

The governing rule stays the same:

- improve clarity, usability, reliability, and maintainability
- preserve the current duel rules and overall shell
- add tests and docs where fixes close real gaps
- defer any work that requires a new interaction model or major visual/layout rethink

## Cleanup Versus Later Redesign

A change still fits `v0.2` cleanup if it:

- preserves the current left/right duel shell and general panel ownership
- works through existing controls, overlays, summaries, or local layout tuning
- can be protected with targeted unit or browser regression coverage
- improves trust or readability without inventing a new workflow

Defer a change to the later redesign phase if it needs:

- a new workspace model or dedicated station views
- a major visual, layout, or art-direction pass
- control-deck or navigation concepts that replace the current shell rather than tune it
- broad replay or preview semantics changes that alter the basic client mental model

## Recommended Slices

### 1. Interaction clarity and regression repair

- fix misleading armed, selected, targeted, or blocked-state cues in the existing SSD and tactical surfaces
- repair layout regressions that hide controls, add scroll where it should not exist, or compress the main play surfaces
- tighten copy and labels in existing panels rather than adding more chrome
- add browser coverage for the concrete regressions fixed

#### Slice 1 implementation checklist

Use this as the bounded execution checklist for the first `v0.2` cleanup branch.

In scope:

- make selected mount state easier to read inside the existing selected-system panel
- make blocked-shot reasons and degraded mount penalties visible without opening auxiliary UI
- keep the SSD and tactical viewport stable when a mount is selected or cleared
- fix concrete layout regressions that add inner scroll or visibly compress the schematic at normal desktop sizes
- tighten labels and summaries in place rather than adding a new panel, mode, or workspace concept

Explicitly out of scope:

- replay or camera redesign
- replacing the current plot/aim shell with a different control-deck model
- major typography, spacing, or art-direction work
- new combat rules, new subsystems, or new replay controls

Primary source issues to address:

- selected, targeted, and armed state can still be too easy to miss during ordinary plotting
- blocked-state communication is not always readable enough at the point of interaction
- selected-system controls must not introduce inner scroll or force the schematic to collapse
- copy in the current plot/aim panel should answer the combat question faster with less chrome

Required browser coverage:

- selecting a mount does not introduce an inner scrollbar in the active control area at a laptop-class viewport
- selecting a mount does not materially shrink the schematic or push the page shell off-screen
- blocked-shot messaging remains visible in the selected mount workflow

Required unit coverage:

- any new mount-state label or summary helper added for degraded/blocked state
- any logic that condenses multiple blocked reasons into the player-facing string shown in the panel

Likely touch set:

- `src/client/schematic_view.ts` for the selected mount panel and aim-mode copy
- `src/client/combat_readability.ts` for blocked/degraded summary helpers reused by tactical and SSD cues
- `src/client/style.css` for selected-panel sizing and no-scroll behavior
- `src/client/main.ts` only if wiring or selection state needs a small supporting change
- `tests/tactical_readability.test.ts` for new state-label helper coverage
- existing Playwright/browser specs covering mount selection, plotting, and blocked-state workflows

Recommended execution order:

1. capture the current selected-mount and blocked-shot render path in code
2. make the smallest copy/state-readability changes that improve the panel without changing shell structure
3. repair any layout behavior that still adds scroll or schematic compression
4. add browser assertions around the repaired layout and selected-mount workflow
5. stop before touching replay behavior unless a discovered bug is already present on `main`

Slice 1 is done when:

- a player selecting a mount can immediately read target, charge, legal/blocked status, and degraded state from the existing panel
- the selected-system panel stays usable without its own scrollbar at supported desktop sizes
- the schematic remains the same practical size before and after selecting a mount
- the new browser and unit coverage fail on the broken behavior and pass on the repaired behavior

### 2. Replay and feedback polish

- make post-submit resolution easier to follow using the existing event model
- improve turn summaries and combat feed readability
- add restrained audio or motion cues only where they clarify state changes
- avoid new replay controls or a new replay UX model

### 3. Remote-play hardening and browser coverage

- run real remote-play sessions and fix reconnect, reclaim, reset, and match-end failures
- extend end-to-end coverage only around the flows that repeatedly fail in play
- keep tests deterministic through existing fixtures, plots, and seeds

### 4. Maintenance, docs, and config cleanup

- split oversized client code where behavior has settled enough to make the refactor safe
- sync player and developer docs to shipped behavior
- move remaining hard-coded existing tunables into config seams when that does not change rules behavior
- capture post-`v0.2` ideas without implementing them here

## Slice Acceptance Rules

Each `v0.2` slice should:

- solve a concrete playtest or maintenance problem already observed
- stay inside current `v0.1` invariants and the current duel scope
- avoid page or shell churn unless that churn is the bug being repaired
- land with updated docs or backlog notes when behavior changes
- include the smallest durable unit or browser coverage that guards the fix

## Exit Criteria For `v0.2`

`v0.2` is complete when:

- the duel is trustworthy to plot, aim, resolve, and replay in normal desktop use
- remote two-player sessions stop exposing routine reclaim, reset, or flow breakage
- the client code and docs are clean enough that `v0.3` work can start without carrying obvious UI debt
- deferred redesign topics are documented as post-`v0.2` work instead of being half-started here

## Related Docs

- `ui_punch_list.md`
- `playtest_backlog.md`
- `../design/ssd_layout.md`
- `../design/planner_ui_and_tactical_camera.md`
