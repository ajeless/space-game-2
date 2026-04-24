# Stack decision — v0.1

**Status:** reference  
**Audience:** contributors

> Imported from `ajeless/docs/sg/space_game_2/design/stack_decision.md` on 2026-04-21.
> This copy is now maintained in this repository.

**Scope:** v0.1 vertical slice
**Last updated:** 2026-04-21

## Summary

TypeScript for client and server. Node.js on the host's machine. Raw WebSockets for networking. Canvas 2D and SVG for rendering. Cloudflare Tunnel for exposing the host to friends. No database, no Docker, no CI/CD at v0.1.

## Decisions

**Language: TypeScript everywhere.**
Client and server in the same language. The resolver is a shared module imported by both. No porting ever required between the two sides of the game.

**Client runtime: browser.**
No installer, no platform-specific build, no "trust this .exe" friction. The host shares a URL; friends click it.

**Client build: Vite.**
Modern, fast, near-zero config. Dev server with hot reload, production build with tree-shaking.

**Client rendering: Canvas 2D for the tactical viewport, SVG or DOM for the ship schematic and UI chrome.**
Canvas is the right tool for the live-animating tactical view. SVG is the right tool for the schematic, which is fundamentally vector-based (hull paths, system placement, damage overlays). DOM for ordinary UI chrome. No frontend framework at v0.1 — plain TypeScript modules are enough. React or similar becomes a real option if UI complexity later justifies it.

**Server runtime: Node.js on the host's machine.**
The host starts the server before a session; the server terminates when the host closes it. No always-on service.

**Server networking: raw WebSockets (the `ws` library).**
Bidirectional, low-latency, universally supported in browsers. Turn-based traffic is tiny; `ws` handles it with minimal overhead. Colyseus (a TypeScript multiplayer framework) remains available as an upgrade if room management, reconnection, and matchmaking become real work worth outsourcing — deferring that is an earned-complexity decision.

**Resolver: a pure TypeScript module in a shared folder.**
Imported by both server and client. Takes inputs, returns outputs, has no side effects, no network calls, no UI dependencies. Floating-point math initially. Isolated enough that migrating to fixed-point later is bounded work if strict cross-platform determinism becomes required.

**Resolver execution: server-authoritative at v0.1.**
The host's server runs the resolver. The client receives replay events and renders them. This is Option B from the resolver design discussion. It sidesteps cross-platform determinism concerns entirely because only one machine computes the resolution.

**Data format: JSON.**
Ship definitions, plot submissions, replay events. Universal, debuggable, AI-agent-friendly, zero external dependencies. Upgrade to a binary format later only if profiling shows it matters.

**Testing: Vitest.**
Shared test suite for the resolver module, runnable on both server and client. Other modules tested to the extent they're non-trivial.

**Deployment: Cloudflare Tunnel.**
The host runs the server locally and exposes it via a tunnel. Free tier is fine for friends-only play. No dedicated hosting, no DNS, no TLS management. This is not a deferred deployment step: the first real v0.1 slice is expected to be internet-reachable through the tunnel, even if the feature surface is still thin.

**First-slice testability: same-host internet-path testing is supported.**
The host should be able to test the networked slice alone by opening two browser sessions against the same server, for example one on `localhost` and one on the tunnel URL, or two isolated sessions against the tunnel URL. Separate browser profiles or an incognito window are sufficient to simulate the two participants.

**Persistence at v0.1: files on disk.**
Replays saved as JSON files. No database. Ship definitions are static files read at startup.

## Not decided / deferred

- **Frontend framework.** Plain TypeScript is the v0.1 choice. React, Vue, Svelte, etc. are revisitable when UI complexity warrants.
- **Server framework beyond `ws`.** Colyseus, Socket.IO, or Express+ws are all reachable from the current choice without rewriting the resolver.
- **Fixed-point vs. floating-point math in the resolver.** Floating-point is fine given server-authoritative play. Revisit if the game ever needs peer cross-checking, deterministic replays across architectures, or tournament-grade reproducibility.
- **Database.** Not needed at v0.1. JSON files on disk are sufficient for ship definitions, replays, and any persistent state that emerges.
- **Hosting beyond tunnel.** A real dedicated server is the move when peer-hosting is the bottleneck — not before.

## Why not other stacks

**Python + TypeScript split (earlier recommendation).** Rejected because the split means the resolver has to be ported from Python to TypeScript when client-side resolution is needed, and that port is real work for real determinism risk. TypeScript everywhere avoids the port by not splitting in the first place.

**Rust + WebAssembly.** Considered seriously. Rejected for v0.1 because the infrastructure cost (cargo workspaces, wasm-pack, JS-WASM marshaling, build pipeline) adds 2-4x to v0.1 timeline despite excellent agentic-coding support for the Rust code itself. The minimalist tactical aesthetic doesn't need Rust-level performance, and server-authoritative play doesn't need Rust-level determinism. Reserved as a future migration target for the resolver module specifically, if and when requirements demand it.

**Full game engine (Unity, Godot, Bevy).** Rejected as overkill for a minimalist turn-based 2D game. Engine ceremony would dominate v0.1. Plain browser APIs are sufficient.

## Upgrade paths preserved

This stack does not lock out any of the following future directions:

- **Client-side resolution** for single-player, offline play, or prediction — resolver already runs in TypeScript on the client.
- **Peer cross-checking of resolutions** — both peers can run the shared resolver; add a hash comparison layer.
- **Dedicated server** — lift the Node server from the host's machine to a cloud instance; no code changes needed.
- **AI opponent** — an AI module produces plots and feeds them to the resolver like any other player.
- **Hot-seat** — collect both plots on one machine with UI handoff, invoke the resolver locally.
- **Campaign / persistence** — add a database or structured file storage behind the existing server code.
- **Rust port of the resolver** — bounded work because the resolver is a well-isolated module with a clear input/output contract.

## Assumed reader

A capable coding agent, a future collaborator, or future-you reading this after time away. The doc captures *what* was decided and *why*, on the theory that reasoning is what lets the reader extend the design to questions we didn't anticipate.

## Related docs

- `ship_definition_format.md` — the data format for ships, which the resolver consumes and the UI renders.
- `resolver_design.md` — the engine that these stack choices exist to support.
- `ssd_layout.md` — the user-facing interface structure.
