# UI Punch List

> Created in this repository on 2026-04-21.
> This is a holding pen for UI issues we have noticed but are intentionally deferring so current work stays vertical-slice focused.

**Status:** active scratch list
**Scope:** remaining v0.2 client/UI cleanup backlog
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
- The tactical view still needs a cleaner separation between current velocity/drift cues and planned burn/ghost cues.
- Contact markers need one more readability pass so heading / closure information is obvious at a glance without overloading the scope.
- Selected-target / armed-shot state should be more obvious in both the SSD and tactical view.
- Tactical header and overlay copy should get one more compression pass now that the main interactions are stable.
- The SSD trim sliders are useful, but they should stay visibly secondary to direct tactical plotting.
- The bottom strip and footer copy need a later compression pass once the final information hierarchy is clearer.
- Combat and outcome events need a cleaner player-facing presentation than raw-ish resolution summaries.
- Aim-mode overlays need another readability pass once more real combat cases are exercised.
- The SSD schematic should keep a fixed footprint while selection/aim panels change; selecting a mount should not visibly bump or compress the schematic viewport.
- Basic sounds and modest replay-motion polish still need a deliberate pass.
- The current UI is structurally close to the intended SSD shell, but not yet at the final spacing / typography / visual-consistency pass.

## Related implementation cleanup

- `src/client/main.ts` is still oversized and should be split into smaller render / input / screen-composition modules once the current UI behavior settles.
- `src/client/style.css` still carries too much mixed responsibility and should be broken into clearer tactical / schematic / chrome sections when that refactor earns its cost.
