---
type: synthesis
updated: 2026-10-04
sources:
  - ../sources/2026-10-04-provider-agnostic-decision-driver-discussion.md
  - ../sources/2026-10-04-decision-driver-render-test.md
  - ../sources/2026-10-04-layered-ai-driver-discussion.md
  - ../sources/2026-10-01-ollama-jev-decision-models.md
---

# Provider-agnostic decision driver — C4 and runtime flow

> Status: **Proposed architecture, not implemented**.
>
> Jev is the first candidate adapter. The architecture deliberately does not
> depend on Jev, TypeSafe, Ollama, Claude or any one transport.
>
> Raw rationale: [provider-agnostic driver discussion](../../raw/2026-10-04-provider-agnostic-decision-driver-discussion.md).

Related current architecture:
[agent control](c4-agent-control.md) · [MCP subsystem](c4-mcp.md) ·
[Agent API](../entities/agent-api.md).

## Design goal

Add a high-level AI driving loop without introducing a second physics model and
without turning model latency into steering latency.

The split is:

```text
Decision provider (~5–10 Hz) -> DrivingIntent
                               -> local DriveController (~60 Hz)
                               -> existing race input + physics
```

The provider decides **what target to pursue**. F1 Racer locally decides **how
to turn that target into controls**.

## Status legend

- **EXISTING** — on `master` today.
- **NEW** — required by this proposal.
- **EXTERNAL** — provider/runtime outside the game.

## C4 Level 1 — System context

```mermaid
flowchart LR
  human["Person: human player"]:::person
  provider["External decision provider<br/>Jev / Claude / local model / rules"]:::external
  driver["Decision-driver integration<br/>provider + transport neutral"]:::new
  game["F1 Racer<br/>browser race runtime + multiplayer"]:::existing

  human -->|"normal controls"| game
  provider -->|"DrivingObservation / DrivingIntent"| driver
  driver -->|"bounded agent control"| game

  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef existing fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef new fill:#9a6700,color:#fff,stroke:#6f4b00
  classDef external fill:#666,color:#fff,stroke:#444
```

### Context rule

The decision provider is outside the game authority boundary. It may stop,
restart or be replaced without changing normal human play, room lifecycle,
physics or multiplayer sync.

## C4 Level 2 — Containers

```mermaid
flowchart LR
  provider["Decision engine<br/>EXTERNAL<br/>Jev / Claude / local / rules"]:::external
  orchestrator["Driver Orchestrator<br/>NEW<br/>provider + port composition"]:::new
  port["AgentPort<br/>NEW abstraction<br/>MCP/direct transport adapter"]:::new
  mcp["Remote MCP + room relay<br/>EXISTING"]:::existing
  browser["Agent browser runtime<br/>EXISTING<br/>getState + agent facade"]:::existing
  controller["DriveController<br/>NEW<br/>browser-local high-level control"]:::new
  input["Race input + physics<br/>EXISTING<br/>single authority"]:::existing

  provider --> orchestrator
  orchestrator --> port
  port --> mcp
  mcp --> browser
  browser --> controller
  controller --> input
  input -. "next observation" .-> browser

  classDef existing fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef new fill:#9a6700,color:#fff,stroke:#6f4b00
  classDef external fill:#666,color:#fff,stroke:#444
```

### Container responsibilities

| Container | Status | Owns | Must not own |
|---|---|---|---|
| Decision engine | EXTERNAL | Provider-specific inference/decision | F1 physics or room protocol |
| Driver Orchestrator | NEW | Decision cadence, provider + port composition | Provider-specific branching |
| AgentPort | NEW | `observe / drive / release` transport contract | Decision semantics |
| Remote MCP / room relay | EXISTING | Authenticated command/result transport | Steering policy |
| Agent browser runtime | EXISTING | Live game state and agent endpoint | External provider logic |
| DriveController | NEW | Intent → smooth frame-rate controls | Provider protocol |
| Race input + physics | EXISTING | Authoritative movement | Provider/model state |

## C4 Level 3 — Components and interfaces

The provider family follows the project's OOP rule: one interface, variants
behind it, no provider type switches in callers.

```mermaid
flowchart TB
  observation["DrivingObservation<br/>EXISTING canonical state<br/>based on getState()"]:::existing

  base["DecisionProvider<br/>NEW interface<br/>decide(observation, context)"]:::new
  jev["CandidateDecisionProvider<br/>NEW adapter"]:::external
  claude["ClaudeDecisionProvider<br/>future adapter"]:::external
  rules["RulesDecisionProvider<br/>benchmark adapter"]:::external

  intent["DrivingIntent<br/>NEW value contract<br/>target offset / target speed / horizon"]:::new
  orchestrator["DriverOrchestrator<br/>NEW"]:::new
  agentPort["AgentPort<br/>NEW interface<br/>observe / drive / release"]:::new
  mcpPort["McpAgentPort<br/>NEW wrapper over EXISTING MCP"]:::new
  controller["DriveController<br/>NEW local deterministic component"]:::new
  low["steer / throttle / brake<br/>EXISTING low-level control"]:::existing
  physics["race-input + player-physics<br/>EXISTING"]:::existing

  observation --> orchestrator
  orchestrator --> base
  base --> intent
  jev -. "implements" .-> base
  claude -. "implements" .-> base
  rules -. "implements" .-> base
  orchestrator --> agentPort
  mcpPort -. "implements" .-> agentPort
  agentPort --> controller
  controller --> low
  low --> physics

  classDef existing fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef new fill:#9a6700,color:#fff,stroke:#6f4b00
  classDef external fill:#666,color:#fff,stroke:#444
```

### Proposed contracts

Architectural shape only; exact code/API names remain open.

```text
DecisionProvider
  decide(DrivingObservation, DecisionContext) -> DrivingIntent

AgentPort
  observe() -> DrivingObservation
  drive(DrivingIntent)
  release()

DrivingIntent
  targetOffsetMeters
  targetSpeedKmh
  horizonMs
  confidence?        // open: control input or diagnostics only
```

A provider-specific adapter may internally use discrete choices, logits,
generated text or any other mechanism. It must return the same neutral
`DrivingIntent`.

## C4 Level 4 — Proposed code direction

Do not treat these as final filenames. They document ownership boundaries for a
future implementation.

```text
decision/
  DecisionProvider
  DriverOrchestrator
  DrivingIntent
  providers/
    CandidateDecisionProvider
    RulesDecisionProvider

transport/
  AgentPort
  McpAgentPort

race/
  DriveController

existing convergence:
  agent-api.js -> race-input.js -> player-physics.js / main.js
```

One factory/composition point may select a provider. Callers after that point
must not switch on provider type.

## Runtime flow — what exists and what is new

```mermaid
sequenceDiagram
  participant G as Game/Physics 60 Hz [EXISTING]
  participant A as Agent API/MCP [EXISTING]
  participant O as Driver Orchestrator [NEW]
  participant P as DecisionProvider [NEW/EXTERNAL]
  participant C as DriveController 60 Hz [NEW]

  loop Decision loop ~5–10 Hz
    O->>A: observe()
    A->>G: getState()
    G-->>A: DrivingObservation
    A-->>O: DrivingObservation
    O->>P: decide(observation)
    P-->>O: DrivingIntent
    O->>A: drive(intent)
    A->>C: set latest bounded intent
  end

  loop Every game frame ~60 Hz
    C->>C: converge on target offset/speed
    C->>G: steer / throttle / brake
    G->>G: existing input + physics + race systems
  end
```

### Same flow as a status map

```text
[EXISTING] f1_observe / getState
       |
       v
[EXISTING] DrivingObservation
       |
       v
[NEW] DecisionProvider abstraction
       |
       +---- [EXTERNAL] Jev adapter
       +---- [EXTERNAL] Claude / local model
       +---- [NEW] rules baseline
       |
       v
[NEW] DrivingIntent
       |
       v
[NEW] AgentPort.drive(intent)
       |
       v
[NEW] browser-local DriveController
       |
       v
[EXISTING] race-input
       |
       v
[EXISTING] physics / main loop
       |
       v
[EXISTING] multiplayer car_state / rendering
```

## Why the local controller is the architectural pivot

Do **not** build:

```text
remote provider -> ~60 remote calls/sec -> f1_act -> physics
```

That makes network/model jitter visible as steering jitter.

Build:

```text
provider 5–10 Hz -> intent -> local controller 60 Hz -> existing physics
```

The controller keeps a bounded lease and fails neutral. Human input must keep
the existing immediate-takeover rule.

## Provider agnosticism

Adding another decision engine should require one provider implementation and
composition/factory registration only.

The following are forbidden design leaks:

- provider-specific fields in physics;
- Jev-specific branches in race input;
- provider-specific messages in the room protocol;
- model calls from `main.js`;
- a provider writing car position/velocity directly;
- a remote provider owning the 60 Hz control loop.

## Transport agnosticism

The orchestrator depends on `AgentPort`, not directly on MCP.

The first implementation can wrap the existing MCP path. A direct/local
transport may be added later without changing providers.

A high-level `drive(intent)` operation may require an additive game-facing
tool. Its exact MCP name is **Open**; existing `f1_act`, `f1_enqueue`,
`f1_observe` and `f1_release` remain valid and must not be removed.

## Jev as first adapter

The first model-backed implementation stays generic:

```text
DrivingObservation
  -> CandidateDecisionProvider
  -> bounded candidate intents
  -> ModelClient.choose(...)
  -> SystemOneModelClient (first protocol implementation)
  -> selected candidate
  -> DrivingIntent
```

Jev/System One request and response shapes stay inside
`SystemOneModelClient`. Changing Nimble to Tev is configuration; changing
protocol means a new `ModelClient`, with the racing provider unchanged.

The statement that Jev itself is a diffusion model is **Needs verification**
and is irrelevant to this boundary.

## Acceptance rules for future implementation

1. Normal F1 Racer works with no decision provider process.
2. Human multiplayer works with no MCP process.
3. Existing Room Bot remains independent.
4. Existing low-level MCP control remains available.
5. Physics/input stay single-source and browser-local.
6. Human takeover still wins immediately.
7. Provider timeout cannot leave an unbounded stale command.
8. Replacing Jev does not touch race physics/multiplayer/UI.
9. Replacing MCP transport does not touch decision providers.
10. One provider implementation contains all provider-specific protocol logic.

## Open implementation decisions

- Final `DrivingIntent` fields and bounds.
- Where the local `DriveController` plugs into the current Agent API.
- Whether `drive(intent)` becomes a new MCP tool or is exposed through a
  separate local driver channel.
- Decision cadence and intent lease defaults.
- Confidence semantics.
- Jev median/p95 latency and quality against a deterministic rules baseline.


## OOP implementation plan

The implementation follows [the project OOP rules](../concepts/oop.md):
variants sit behind one interface and callers do not switch on concrete types.

```text
DecisionProvider
  ├─ RulesDecisionProvider       deterministic baseline
  ├─ CandidateDecisionProvider         first model adapter
  └─ future providers

AgentPort
  ├─ RelayAgentPort              existing agent relay / AgentBridgeClient
  ├─ McpAgentPort                remote MCP transport
  └─ future transports

DriverOrchestrator(provider, port)
  └─ coordinates observation → decision → intent

DriveController
  └─ one provider-neutral browser-local controller
```

A factory/composition root may select implementations once from configuration.
After construction, neither `DriverOrchestrator` nor race/physics code may
contain provider/transport type switches.

Development order:

1. value contracts (`DrivingObservation`, `DrivingIntent`);
2. `DecisionProvider` and `AgentPort` families;
3. `RulesDecisionProvider` baseline;
4. `RelayAgentPort` over the existing agent relay;
5. browser-local `DriveController`;
6. full-lap baseline test;
7. `CandidateDecisionProvider`;
8. same-observation rules-vs-Jev comparison.

## Test deployment — reuse the existing Render backend

**Feasible and preferred for the first test**, provided Render stays the room
and agent-relay backend rather than becoming the inference host.

```mermaid
flowchart LR
  runner["Local driver runner<br/>DriverOrchestrator + DecisionProvider"]:::new
  render["Existing Render service<br/>room-server.mjs<br/>room + agent relay"]:::existing
  pages["GitHub Pages<br/>race.html?agent=1"]:::existing
  controller["Browser-local DriveController<br/>NEW"]:::new
  physics["race-input + physics<br/>EXISTING"]:::existing

  runner -->|"AgentPort / relay"| render
  render <-->|"normal room socket + agent bridge"| pages
  pages --> controller
  controller --> physics
  physics -. "observation" .-> pages

  classDef existing fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef new fill:#9a6700,color:#fff,stroke:#6f4b00
```

The current Render service already provides the exact provider-neutral duties
needed here: room lifecycle, participant binding and command/result relay.

For the first Jev experiment, run the model and driver runner locally and reuse
the deployed Render backend. Do **not** put Jev/model inference in
`room-server.mjs`: that would couple room availability to a provider and
break the current responsibility boundary.

The existing `agent-mcp-http.mjs` remains a separate optional transport.
A local Jev test does not need a second Render service: `RelayAgentPort` can
wrap the existing `AgentBridgeClient` directly. When a remote MCP-native
client is the decision source, `McpAgentPort` can use the current MCP process.

This matters operationally because the current free Render room service is
already configured to consume almost the whole monthly free-hour allowance;
the architecture must not assume a second free Render web service.

### First end-to-end acceptance test

The first meaningful test is:

```text
RulesDecisionProvider
        ↓
DriverOrchestrator
        ↓
RelayAgentPort
        ↓
existing Render room/agent relay
        ↓
GitHub Pages agent browser
        ↓
DriveController
        ↓
existing input/physics
```

Then replace only `RulesDecisionProvider` with `CandidateDecisionProvider`.

If that swap requires no change to Render, `AgentPort`, `DriveController`
or physics, provider agnosticism has been demonstrated rather than assumed.


## Layered intelligence — strategist, decision engine and controller

The target architecture allows different kinds of intelligence to cooperate
without moving model-specific concerns into F1 Racer.

```mermaid
flowchart TB
  strategist["StrategyProvider<br/>~0.1–1 Hz / event driven<br/>ChatGPT · Claude · rules"]:::new
  directive["StrategyDirective<br/>race objective / mode / pit policy"]:::new
  decision["DecisionProvider<br/>~5–10 Hz<br/>racing semantics"]:::new
  model["ModelClient<br/>protocol adapter<br/>System One · OpenAI-compatible · future"]:::new
  intent["DrivingIntent<br/>short-horizon target"]:::new
  controller["DriveController<br/>~60 Hz · browser-local"]:::new
  input["race-input + physics<br/>EXISTING"]:::existing

  strategist --> directive
  directive --> decision
  model -. "composed into model-backed provider" .-> decision
  decision --> intent
  intent --> controller
  controller --> input

  classDef existing fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef new fill:#9a6700,color:#fff,stroke:#6f4b00
```

### Why `ModelClient` is separate

`DecisionProvider` belongs to the F1 racing domain. It receives
`DrivingObservation + StrategyDirective` and returns `DrivingIntent`.

`ModelClient` belongs to infrastructure. It knows how to call a model API,
but knows nothing about track geometry, multiplayer or physics.

Example:

```text
CandidateDecisionProvider
    -> SystemOneModelClient(model="nimble")

CandidateDecisionProvider
    -> SystemOneModelClient(model="tev1")

CandidateDecisionProvider
    -> future ChoiceModelClient(...)
```

The racing provider therefore does not parse System One payloads. The
`ModelClient.choose(...)` contract normalizes protocol-specific responses to
`{ choice, confidence }`.

Nimble → Tev is therefore configuration under the same client. A new protocol
is a new `ModelClient`, not a race-engine change.

## Runtime — three clocks

```mermaid
sequenceDiagram
  participant G as F1 Racer physics [EXISTING ~60 Hz]
  participant A as AgentPort [NEW abstraction / existing relay]
  participant S as StrategyProvider [NEW ~0.1–1 Hz]
  participant D as DecisionProvider [NEW ~5–10 Hz]
  participant C as DriveController [NEW ~60 Hz]

  loop Strategy events / slow cadence
    A->>G: observe
    G-->>A: DrivingObservation
    A-->>S: race context
    S-->>D: StrategyDirective
  end

  loop Decision cadence
    A->>G: observe
    G-->>A: DrivingObservation
    A-->>D: observation + current StrategyDirective
    D-->>A: DrivingIntent
    A->>C: bounded intent
  end

  loop Every game frame
    C->>G: steer / throttle / brake
    G->>G: existing input + physics + sync
  end
```

The loops are deliberately independent. A strategist does not need to answer
for every driving decision, and a decision model does not need to answer for
every rendered frame.

## Heterogeneous multiplayer grid

```mermaid
flowchart LR
  human["Human"]:::person --> room["Existing Render room / agent relay"]:::existing
  chatjev["ChatGPT strategy<br/>+ Jev decision<br/>+ DriveController"]:::new --> room
  clauderules["Claude strategy<br/>+ Rules decision<br/>+ DriveController"]:::new --> room
  jev["Jev decision only<br/>+ DriveController"]:::new --> room
  bot["Existing Room Bot"]:::existing --> room
  room --> game["F1 Racer participants<br/>same race + physics paths"]:::existing

  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef existing fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef new fill:#9a6700,color:#fff,stroke:#6f4b00
```

The room server never branches on the intelligence source. It only binds
participants and relays the provider-neutral game-facing commands.

## ChatGPT integration point

The preferred ChatGPT role is the strategy layer:

```text
ChatGPT
  -> StrategyDirective
  -> fast DecisionProvider (Jev / rules / another model)
  -> DrivingIntent
  -> browser-local DriveController
  -> existing physics
```

This avoids coupling ChatGPT response latency to steering while still letting
it make the decisions that benefit from broader context: attack/defend,
overtake policy, pit timing, tyre choice, safety-car reaction and race goals.

Direct ChatGPT-as-`DecisionProvider` remains a valid experimental stack;
the controller and physics do not change.
