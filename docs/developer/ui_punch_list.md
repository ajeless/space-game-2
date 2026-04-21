# UI Punch List

> Created in this repository on 2026-04-21.
> This is a holding pen for UI issues we have noticed but are intentionally deferring so current work stays vertical-slice focused.

**Status:** active scratch list  
**Scope:** v0.1 client/UI cleanup backlog  
**Rule:** items here do not automatically become the next task

## How to use this file

- Add issues that are real but not currently blocking a vertical slice.
- Fix items immediately only if they block interaction, misstate rules/state, or are essentially free while touching the same code.
- Everything else waits for a deliberate cleanup pass.

## Fix now if encountered

- Broken click targets or controls that appear interactive but do nothing.
- Missing or misleading state cues that cause the player to misunderstand what is armed, selected, pending, or resolved.
- Layout bugs that hide core controls or push the main play surface off-screen at normal desktop sizes.

## Deferred UI cleanup

- Tactical board proportions still need tuning so the main viewport consistently feels dominant over the SSD.
- Camera-mode controls work, but the chrome is still temporary and visually heavier than the final design should be.
- Selected-target / armed-shot state should be more obvious in both the SSD and tactical view.
- Tactical header copy and diagnostics should get tighter once the underlying interactions settle.
- The SSD still mixes temporary engineering readouts with player-facing controls in places.
- The bottom strip and footer copy need a later compression pass once the final information hierarchy is clearer.
- Combat and outcome events need a cleaner player-facing presentation than raw-ish resolution summaries.
- Aim-mode overlays need another readability pass once more real combat cases are exercised.
- Keyboard shortcuts and on-screen key labels from the layout spec are not implemented yet.
- The current UI is structurally closer to the intended SSD shell, but not yet at the final design pass for spacing, typography, or visual consistency.

## Candidate cleanup pass trigger

Do the dedicated UI cleanup pass when all of these are true:

- local two-player play is stable
- tunnel-based remote play has been tested at least once
- the tactical camera modes have been exercised enough to know which ones survive
- one more gameplay slice has landed after the current camera work
