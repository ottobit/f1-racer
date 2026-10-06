# Raw discussion — layered AI drivers in one race, 2026-10-04

Continuation of the provider-agnostic decision-driver discussion.

## User target

The user confirmed the desired end state:

- a human player, ChatGPT, Claude, Jev/System One and future models can all
  participate in the **same multiplayer room**;
- F1 Racer does not know or care which intelligence controls a participant;
- fast local/model decisions and slower strategic decisions are separate;
- adapters remain generic enough to try different models without rewriting
  race, physics, multiplayer or controller code.

## Key refinement: separate model protocol from racing semantics

The first design had a `DecisionProvider` abstraction. The discussion refined
this further: a provider that understands **racing** should not also own the
wire protocol used to talk to an LLM/runtime.

Proposed split:

```text
DrivingObservation
       |
       v
DecisionProvider                  domain: racing decision
       |
       v
ModelClient                       infrastructure: model protocol
       |
       +-- SystemOneModelClient   Jev / Nimble / Tev family
       +-- OpenAICompatibleClient future OpenAI-compatible endpoints
       +-- LocalModelClient       future local runtime
       +-- other clients
```

A `JevDecisionProvider` can therefore depend on a
`SystemOneModelClient`, but neither F1 Racer nor `DriveController` sees
Jev-specific request/response fields.

Changing Nimble -> Tev behind the same System One endpoint should ideally be
configuration only. Changing protocol means a different `ModelClient`, not a
rewrite of the race domain.

## Three clocks, three responsibilities

The discussion converged on three layers.

### 1. Strategy — slow, semantic, contextual

Target cadence: roughly 0.1–1 Hz or event-driven.

Good fit for ChatGPT / Claude / another reasoning agent.

Examples:
- attack / defend / conserve;
- pit this lap / extend;
- choose tyre;
- avoid risky overtake;
- target a rival;
- react to safety car, weather or damage;
- change race objective after a position gain/loss.

Output concept:

```json
{
  "mode": "attack",
  "overtakePolicy": "prefer-clean",
  "pitPolicy": "stay-out",
  "targetDriverId": "rival-3"
}
```

Exact schema is open; the invariant is that strategy does not steer the car.

### 2. Decision — fast, bounded, tactical

Target cadence: roughly 5–10 Hz.

Good fit for Jev/System One or another small/fast decision engine.

Input:
- live `DrivingObservation`;
- current `StrategyDirective`.

Output:
- `DrivingIntent`, for example target lateral offset and target speed.

The decision layer turns a strategy such as "attack" into near-term driving
targets but still does not write physics.

### 3. Control — frame-rate, deterministic, local

Target cadence: game frame rate, roughly 60 Hz.

Owned by F1 Racer.

Input:
- latest bounded `DrivingIntent`.

Output:
- steer / throttle / brake through the existing input path.

This layer must continue safely if a model decision is late for a few frames,
and must release/neutralize if the intent expires.

## Where ChatGPT enters

ChatGPT is **not** the preferred 60 Hz controller and is not required to be the
5–10 Hz micro-decision engine.

The preferred role is a **RaceStrategist**:

```text
ChatGPT / Claude                     ~0.1–1 Hz or events
          |
          v
StrategyDirective
          |
          v
DecisionProvider (Jev / fast model) ~5–10 Hz
          |
          v
DrivingIntent
          |
          v
DriveController                     ~60 Hz
          |
          v
F1 Racer physics                    ~60 Hz
```

This gives a remote reasoning model enough time to reason about the whole race
without making its network/model latency visible in the steering wheel.

The architecture must also allow a different configuration in which ChatGPT
itself is the `DecisionProvider` for experimentation. It may drive less
smoothly because of latency, but the domain contract should not forbid it.

## Heterogeneous grid

The desired room can contain different control stacks at once:

```text
Participant A  Human input ----------------------------┐
Participant B  ChatGPT strategy -> Jev -> controller --┤
Participant C  Claude strategy -> rules -> controller -┤
Participant D  Jev-only decision -> controller --------┤
Participant E  existing Room Bot layered driver -------┤
                                                      v
                                 same F1 Racer room + physics paths
```

The room server sees participants, tokens and control calls. It must never need
to know which provider/model/strategist is behind them.

## New provider-neutral concepts

### StrategyProvider

```text
StrategyProvider.decideStrategy(
  DrivingObservation,
  RaceContext
) -> StrategyDirective
```

Candidate variants:
- `StaticStrategyProvider` — deterministic/default test baseline;
- `ChatGptStrategyProvider` — future remote adapter;
- `ClaudeStrategyProvider` — future remote adapter;
- event/rules strategy variant.

### DecisionProvider

```text
DecisionProvider.decide(
  DrivingObservation,
  StrategyDirective,
  DecisionContext
) -> DrivingIntent
```

Candidate variants:
- `RulesDecisionProvider`;
- `JevDecisionProvider`;
- generic structured-LLM provider;
- direct remote reasoning provider.

### ModelClient

Infrastructure family. It knows model API/protocol but no track geometry or
race semantics.

```text
ModelClient
  +-- SystemOneModelClient
  +-- OpenAICompatibleModelClient
  +-- future protocol clients
```

### AgentPort

Transport family. It knows how to reach one F1 participant but no model.

```text
AgentPort
  +-- RelayAgentPort
  +-- McpAgentPort
  +-- future transports
```

## Composition, not provider switches

One composition/factory point may build a stack:

```text
new DriverOrchestrator({
  strategist,
  decisionProvider,
  agentPort
})
```

After construction there must not be code such as:

```text
if (provider === "jev") ...
if (strategist === "chatgpt") ...
if (transport === "mcp") ...
```

The only provider-specific code belongs inside the concrete adapter/client.

## Same-room sequence

```text
EVENT / SLOW LOOP
observe race
  -> strategist updates StrategyDirective

FAST DECISION LOOP
observe car
  + current StrategyDirective
  -> DecisionProvider
  -> DrivingIntent
  -> AgentPort

LOCAL FRAME LOOP
latest DrivingIntent
  -> DriveController
  -> steer/throttle/brake
  -> existing race-input
  -> existing physics
  -> multiplayer car_state
```

## Safety and authority

- Strategy may expire or be absent; the decision provider has a safe default.
- DrivingIntent has a bounded horizon/lease.
- Missing/late decisions do not imply unbounded stale steering.
- Human input still wins immediately.
- Provider/strategist failure cannot break the room server.
- F1 Racer remains the only authority applying inputs and physics.
- Direct low-level MCP tools remain available for experiments and recovery.

## Development implication

The generic infrastructure should be built before Jev-specific behavior:

1. domain value objects;
2. `StrategyProvider`, `DecisionProvider`, `AgentPort` interfaces;
3. deterministic baseline implementations;
4. local `DriveController`;
5. full end-to-end lap through the existing Render relay;
6. System One `ModelClient` + Jev provider adapter;
7. optional remote strategist adapters (ChatGPT / Claude);
8. heterogeneous-room experiments.

This order makes each new intelligence source replaceable and benchmarkable.
