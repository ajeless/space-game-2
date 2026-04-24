# Burn Vector style layers

`src/client/style.css` used to be a 1,740-line monolith. In v0.3 slice B it was split into focused layer files. `style.css` is now a thin aggregator whose `@import` order preserves the original cascade exactly.

## Import order (= cascade order)

```
base.css
layout.css
ssd.css
tactical.css
controls.css
replay.css
responsive.css
```

## Mapping back to the original file

Line numbers reference the pre-split `src/client/style.css` at commit `545b043`.

| Layer            | Original lines | Scope                                                                                              |
|------------------|---------------:|----------------------------------------------------------------------------------------------------|
| `base.css`       |   1 –  45      | `:root` tokens, `*` reset, `body`, `body.is-plot-dragging`, `#app`                                 |
| `layout.css`     |  47 – 134      | `.bridge-shell`, `.mission-bar*`, `.section-kicker`, `.status--*`, `.bridge-main`, `.bridge-panel` |
| `ssd.css`        | 135 – 634      | `.schematic-shell*`, `.ssd-*`, `.status-tile`, `.readout-chip` shared typography, `.heading-compass*` |
| `tactical.css`   | 636 – 1292     | `.tactical-*`, `.ship-glyph*`, `.offscreen-marker*`, `.plot-preview*`, `.plot-handles*`, `.resolution-playback__*`, `.tactical-legend*`, `.tactical-scale-bar*` |
| `controls.css`   | 1294 – 1480    | `.action-strip`, `.match-outcome-banner*`, `.readout-strip`, `.readout-chip`, `.commit-strip*`, `.action-button*`                                |
| `replay.css`     | 1482 – 1654    | `.footer-strip*`, `.resolution-progress*`, `.host-tools*`, `.resolution-feed*`                      |
| `responsive.css` | 1656 – 1740    | `@media (max-width: 1180px)`, `@media (max-width: 820px)`                                           |

## Cascade safety

- The original file is strictly partitioned: every line from 1 to 1740 belongs to exactly one layer, with no rule crossing a layer boundary.
- Selectors that mix a concern from two layers (e.g. `.status-tile span, .readout-chip span` at original line 217) were kept with the first-referenced owner. They apply to distinct element classes, so their ordering relative to the later standalone selectors (`.readout-chip` at original line 1346) is preserved by the aggregator import order.
- Media queries must remain last. They were isolated into `responsive.css` and are imported last.

## Why keep `style.css`

`main.ts` (and Vite's module graph) imports `./style.css` as the single client stylesheet entry point. Keeping the aggregator avoids touching the HTML or build config. Do not inline `@import` chains into HTML.
