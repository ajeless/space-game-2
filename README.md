# space_game_2

> Imported from `ajeless/docs/sg/space_game_2/README.md` on 2026-04-21.
> This copy is now maintained in this repository. The old docs repo remains the archive/reference source for earlier ideation.

A tactical starship combat videogame. Turn-based planning, animated execution, SSD-centric interface. Original IP. Built in deployable vertical slices.

## What this project is

A homage to tabletop tactical starship combat games — Star Fleet Battles, Federation Commander, Attack Vector: Tactical, Full Thrust, Triplanetary, Mayday/Brilliant Lances, and the rest of that lineage — that takes full advantage of the digital and networked medium.

Core loop: **Plot -> Commit -> Execute-animated -> Debrief.**

Primary interface: the Ship System Display (SSD). Energy allocation, damage, subsystems, damage control, crew — all live on a ship schematic the player plays *with*, not a pop-out screen.

Movement model: continuous Newtonian physics with rich digital planning UI (velocity arrows, ghost projections, reachable-region envelopes, quantized effect thresholds for ranges and arcs).

## What this project is not

- Not a 4X or empire game.
- Not a real-time game.
- Not setting-first.
- Not a top-down design exercise. Scope is earned slice by slice, not planned in advance.

## Working discipline

This project is built in **deployable vertical slices**. Each slice is a working, multiplayer-capable, internet-reachable version of the game that players can actually play.

- New features earn their place in the next slice by serving the players who are currently playing the previous slice.
- Scope is added only when the current slice demands it. Ideas that aren't required for the next playable build are not in scope, regardless of how good they are.
- Mechanical design is prioritized. Setting decisions are made only as needed to support mechanics, and only to the minimum extent required.
- Infrastructure is earned. No server until the game is good enough that peer-hosting becomes the bottleneck.

## v0.1 slice target

The first deployable slice. Everything below is required; anything not listed is out of scope.

- **Two identical ships in space.** Symmetric. Fairness is free when both sides are the same.
- **Continuous Newtonian movement** with planning UI: velocity arrows, ghost projections, draggable thrust handles, reachable-region envelopes, collision/constraint feedback.
- **Minimal SSD** with two or three subsystems (reactor, one weapon, hull). Energy allocation exists but is simple. Damage exists but is simple.
- **One weapon type** — direct-fire. No seekers, no EW, no point defense.
- **Full plot-commit-execute-debrief loop.** Even if each phase is thin, all four phases exist.
- **Win condition.** One ship destroyed, or one ship disengages past a map boundary.
- **Peer-hosted networked multiplayer via tunnel** (Cloudflare Tunnel or equivalent). No dedicated server. One player hosts; the other connects via shared link.
- **Replays as deterministic artifacts.** Seed plus plot log reproduces the battle. Shareable as files.

## Architectural ordering

The sequence in which capabilities are added matters. These are the ordering commitments:

- **Networked peer-hosted multiplayer is first.** This is the v0.1 slice. All later modes ride on this foundation.
- **AI opponent in networked-style comes after human-vs-human works.** The AI is another participant from the protocol's perspective; the networking layer is already proven.
- **Hot-seat comes after networked play.** Hot-seat is structurally harder than networked play in WEGO (secret-state management on a shared screen, physical handoff, social awkwardness). Building networked-first produces a cleaner foundation; hot-seat rides on top of it. Hot-seat is *not* part of the initial slices.
- **Dedicated server comes when peer-hosting is the actual bottleneck.** Not before. The game must be good enough that the friction of peer-hosting is a real problem players complain about.
- **Campaign, persistence, and other single-player modes come later still.** Each is earned.

## Current design docs

- [Stack decision](docs/design/stack_decision.md)
- [Resolver design](docs/design/resolver_design.md)
- [Ship definition format](docs/design/ship_definition_format.md)
- [SSD layout](docs/design/ssd_layout.md)
- [v0.1 tuning baseline](docs/design/v0_1_tuning_baseline.md)

## Audience docs

- [Developer: layout and hit model](docs/developer/layout_and_hit_model.md)
- [Player: ship layout and damage](docs/player/ship_layout_and_damage.md)

## Research questions (deferred)

To be revisited once the core game is playable. The AI landscape moves fast; any recommendation captured now will be partially stale by the time it's needed. Capture the questions, search fresh when the time comes.

- What is the state of classical tactical game AI — MCTS, policy networks, learned opponent models — for WEGO-style games with large plot-space and imperfect information?
- What is the state of hybrid architectures that combine classical game AI for decisions with LLMs for explanation, personality, and flavor? (The Meta CICERO Diplomacy work is probably the closest published analog.)
- What is the right split between deterministic tactical AI (for the opponent's moves) and LLM-driven presentation (for briefings, debriefs, captain-voice narration, faction-flavored text)?
- How can an AI opponent be made to feel like a *person* commanding a ship, with personality and voice, without the LLM being on the critical path for tactical decisions?
- What can procedural content generation contribute to scenario design, mission generation, or dynamic campaign events?
- What does imitation learning from player data look like once there's enough player data to learn from?
- What safeguards and design choices are needed to keep an AI opponent challenging without cheating (perfect information access, unrealistic reaction speed, etc.)?

## Preserved prior ideation

Earlier ideation explored setting, IP direction, faction architecture, cosmology, and many other creative directions. The preserved creative artifact still lives in the archive docs repo:

- <https://github.com/ajeless/docs/blob/main/sg/space_game_1/idea_capture.md>

**It is not binding on this project.** Design decisions here start fresh. Ideas from the preserved doc may be drawn on when useful, but they are not commitments, and scope here is not pre-allocated to honor them.
