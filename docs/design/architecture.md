# Architecture

**Status:** current  
**Audience:** contributors, reviewers

> One-page map of how Burn Vector's code is organized.

## Layers

```mermaid
flowchart LR
  subgraph Client["Client (browser)"]
    Main[main.ts]
    Tactical[tactical_view.ts]
    SSD[schematic_view.ts]
    Bridge[bridge_shell_view.ts]
  end

  subgraph Shared["Shared (pure)"]
    Contracts[contracts.ts]
    Validation[validation.ts]
    PlotAuth[plot_authoring.ts]
    Resolver[resolver/*]
  end

  subgraph Server["Server (Node + ws)"]
    App[app.ts]
    Session[session.ts]
  end

  Client -- plot submit --> Server
  Server -- resolution broadcast --> Client
  Server --> Resolver
  Client --> PlotAuth
  Client --> Validation
```

## Turn loop

```mermaid
sequenceDiagram
  participant A as Alpha (client)
  participant S as Server
  participant B as Bravo (client)

  A->>A: Plot (draft + lock)
  B->>B: Plot (draft + lock)
  A->>S: SUBMIT plot
  B->>S: SUBMIT plot
  S->>S: resolve(battle_state, {alpha, bravo})
  S-->>A: Resolution (seed + events)
  S-->>B: Resolution (seed + events)
  A->>A: Animated replay
  B->>B: Animated replay
  A->>A: Debrief (next turn ready)
  B->>B: Debrief (next turn ready)
```

## Boundaries

- **`src/shared/` is pure.** No DOM, no filesystem, no wall clock, no network. Everything gameplay-relevant lives here.
- **`src/server/` is authoritative.** The resolver runs server-side; clients don't resolve their own turns.
- **`src/client/` is presentation only.** Plot authoring exists client-side but is validated server-side against the shared contracts.

## See also

- Resolver internals: [resolver_design.md](./resolver_design.md)
- Ship definition shape: [ship_definition_format.md](./ship_definition_format.md)
- Layered UI camera: [planner_ui_and_tactical_camera.md](./planner_ui_and_tactical_camera.md)
- Test strategy: [../developer/testing.md](../developer/testing.md)
