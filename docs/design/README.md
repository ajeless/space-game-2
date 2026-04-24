# Design

Design docs for contributors and reviewers. They describe the gameplay contracts, resolver internals, data shapes, and shell layout that the shipped duel is built on.

- [architecture.md](./architecture.md) — one-page map of the codebase.
- [resolver_design.md](./resolver_design.md) — pure resolver function, sub-tick simulation, and event schema.
- [ship_definition_format.md](./ship_definition_format.md) — JSON schema for ships, systems, and positional metadata.
- [v0_1_data_contracts.md](./v0_1_data_contracts.md) — canonical shapes for rules config, ship config, battle state, and plot submission.
- [v0_1_tuning_baseline.md](./v0_1_tuning_baseline.md) — starting numeric values for the v0.1 ruleset.
- [planner_ui_and_tactical_camera.md](./planner_ui_and_tactical_camera.md) — client-side plot controls and camera behavior, kept separate from resolver contracts.
- [ssd_layout.md](./ssd_layout.md) — structural description of the shipped bridge shell.
- [stack_decision.md](./stack_decision.md) — reference record of the TypeScript/WebSocket/Canvas stack choice.
