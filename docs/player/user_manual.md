# User Manual

> Created in this repository on 2026-04-21.
> This manual is intentionally lean. It should track the currently playable game, not an imagined future UI.

**Status:** early draft  
**Audience:** players learning the current duel build  
**Rule:** keep this practical and short; prefer current behavior over speculative screenshots or stale control diagrams

## Purpose

This document is the player-facing guide for the current duel loop:

- how to join a match
- how to read the SSD and tactical view
- how to plot movement and authorize fire
- how turns resolve
- how to understand damage, victory, and reset flow

## What belongs here

- the minimum instructions needed to play the current version
- short explanations of core concepts like heading, drift, and reactor pips
- explanations of the current host/join flow when remote play matters
- terminology that the player actually sees in the build

## What does not belong here

- speculative future mechanics
- deep design rationale better suited to design docs
- screenshots that will go stale immediately unless they are actively maintained
- internal developer implementation details

## Starting a match

- A duel is a two-ship match. Each player claims one ship and waits for both links to show connected.
- The top bar shows the current phase, turn number, and link/contact status.
- When both players are present, the duel starts in `PLOT PHASE`.

## Reading the battle screen

- The left panel is your ship schematic. It shows hull, reactor, velocity, and heading for the ship you are flying.
- The right panel is the ship-relative tactical scope. Your ship stays centered and bow-up; contacts and motion are shown relative to your ship.
- Heading is facing. Velocity/drift is movement. They are related, but they are not the same thing.
- Reactor pips are your per-turn power budget. In the current duel, that budget is split between drive power and railgun charge.

## Plotting movement

- Drag the burn and heading handles directly on the tactical plot to author your move for the turn.
- The `Turn`, `Axial Trim`, and `Lateral Trim` controls in the SSD are fine-trim controls, not the primary plotting surface.
- `R` resets your current plot draft.
- `Space` submits your plot for the turn.

## Arming and aiming weapons

- Select the `RAILGUN` mount on the SSD to enter `AIM MODE`.
- In aim mode, click the contact on the tactical plot to authorize or withdraw fire for that mount.
- Set charge using the mount charge control in the SSD.
- `Esc` closes the current selection or exits aim mode.

## Resolving a turn

- Once both players submit, the turn resolves automatically.
- The turn counter advances when resolution completes.
- `Current Resolution` and `Combat Feed` summarize what just happened.

## Damage, destruction, and disengagement

- System integrity and hull state are shown on the SSD.
- A ship is destroyed when its hull is reduced to zero.
- A ship can also lose by disengaging past the battle boundary.
- `Reset Match` is a host-only control used to start a fresh duel after the current match ends.

## Current update rule

- Keep examples synchronized with the shipped controls.
- Prefer concise player language over system-internal vocabulary where possible.
- If the UI changes significantly, update this doc in the same cleanup pass.
