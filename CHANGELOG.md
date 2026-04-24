# Changelog

All notable changes to Burn Vector are recorded here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-04-24

### Changed
- Rebranded from `space_game_2` to **Burn Vector**.
- Project moved to maintenance mode; feature development is retired.

### Added
- `CHANGELOG.md` (this file), `CONTRIBUTING.md`, `docs/developer/testing.md`.
- Architecture diagram (`docs/design/architecture.md`).
- Coverage reporting on `src/shared/` with an 85% threshold.
- `fast-check` property test asserting resolver determinism.
- Portfolio-grade `README.md` with embedded duel GIF, screenshots, and tech-stack credits.
- Wordmark SVG logo and favicon.
- Static GitHub Pages demo playing a canned duel (`?demo=1`).

### Refactored
- `src/client/style.css` split into layered stylesheets under `src/client/styles/`.
- Stable seams extracted from `src/client/main.ts`.
- File-header orientation comments on every source file in `src/`.

## [0.2.0]

### Changed
- Combat presentation readability pass.
- Remote-play reconnect, reclaim, and link-loss hardening.
- Replay-locked plotting.
- Host-authenticated match reset.

### Added
- Browser regression coverage via Playwright.

## [0.1.0]

### Added
- Peer-hosted networked duel on Cloudflare-tunnel-class hosting.
- Plot → Commit → Execute → Debrief loop.
- SSD-centric interface with minimal systems (drive, reactor, bridge, one weapon mount, hull tracking).
- Continuous Newtonian movement with planning UI (velocity arrows, ghost projections, draggable thrust handles).
- Deterministic replay as seed + plot-log artifact.
- Win conditions: hull destruction or boundary disengagement.
