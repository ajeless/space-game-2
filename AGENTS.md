# AGENTS

## Purpose

This repository now carries the shipped `v0.2` duel build of `space_game_2`: a deployable, internet-playable, peer-hosted duel with a pure shared resolver and SSD-centric UI.

`v0.2` shipped as a stabilization pass over the original `v0.1` rules/contracts. Unless a real defect forces it, keep gameplay behavior inside those existing invariants.

## Canonical docs

Read these first before changing rules or contracts:

- `README.md`
- `PLAN.md`
- `docs/design/stack_decision.md`
- `docs/design/resolver_design.md`
- `docs/design/ssd_layout.md`
- `docs/design/planner_ui_and_tactical_camera.md`
- `docs/design/ship_definition_format.md`
- `docs/design/v0_1_data_contracts.md`
- `docs/design/v0_1_tuning_baseline.md`
- `docs/developer/layout_and_hit_model.md`
- `docs/developer/remote_play_runbook.md`

## Non-negotiable v0.1 invariants

- Heading is separate from drift / velocity.
- Turning is kinematic and capped by ship data.
- Reactor power is integer pips, and every discretionary pip is assigned each turn.
- Fire intent is explicit; shot timing is automatic best-legal-shot timing.
- `physical_position` is canonical combat data; `ssd_position` is cosmetic only.
- Resolver execution is server-authoritative in `v0.1`.
- Replays and tests should be able to run from self-contained state + plot + seed artifacts.

## Working posture

- Be contract-first. If a rule affects data shape, update shared contracts and validation before resolver logic.
- Prefer fixtures before complexity. Add or update JSON fixtures before adding non-trivial resolver behavior.
- Keep `v0.1` scope narrow. Do not add later-slice features unless the current slice explicitly requires them.
- Keep the shared module pure. No UI, network, filesystem, wall-clock, or process-global state inside resolver-facing code.
- Keep planner/UI config separate from resolver rules. Widget choice, camera presets, and labels should not leak into combat math contracts.
- Treat docs as design authority until code exists; once code exists, keep docs and code aligned in the same change.

## Expected repo layout

- `src/client/` browser client
- `src/server/` Node host server
- `src/shared/` contracts, validation, resolver-facing logic
- `data/` canonical config JSON
- `fixtures/` canonical battle / plot fixtures
- `tests/` Vitest coverage for contracts, validation, and resolver work

## Commands

- `npm install`
- `npm run dev:server`
- `npm run dev:client`
- `npm run typecheck`
- `npm run test`
- `npm run test:browser:smoke`
- `npm run build`
- `npm run check`

## Scope guardrails

- No frontend framework unless the current UI complexity clearly earns it.
- No database in `v0.1`.
- No Docker in `v0.1`.
- No speculative AI, campaign, hot-seat, or advanced damage-model work.
- If a question does not change a schema, fixture, validation rule, or immediate implementation step, it is probably not in scope yet.
