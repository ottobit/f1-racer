# Raw discussion — provider-agnostic AI race driver, 2026-10-04

Raw notes from the conversation that followed the Jev/System One discussion.
This file preserves the design reasoning as discussed; it is not a statement
that every hypothesis below is already implemented or verified.

Tags:
- **[Existing]** already present in F1 Racer on `master`.
- **[Proposed]** architecture we want to add.
- **[External]** outside F1 Racer.
- **[Open]** needs validation or a later decision.

## Trigger

The user shared a video in which Jev from TypeSafe AI was described as a
"diffusion model" and asked whether that kind of model could be used to race
inside F1 Racer.

The exact "diffusion model" claim has **not** been verified from a primary
TypeSafe source in this work. It must stay marked **[Open]**. The useful
architectural question does not depend on that claim: can a fast external
decision engine drive an F1 Racer car without making the game depend on that
specific engine?

The user's explicit requirement is **provider agnosticism**. Jev may be the
first experiment, but F1 Racer must not know or care whether decisions come
from Jev, Claude, a local model, a rules engine or a future provider.

## Reasoning captured from the discussion

1. **Do not ask a remote model to be the 60 Hz physics controller.**
   A remote decision call has variable latency. Steering, throttle and braking
   need a stable local loop even when a model is late for one decision.

2. **Split the system into two clocks.**
   - [Existing] game/input/physics loop: roughly 60 Hz;
   - [Proposed] decision loop: initially target roughly 5–10 Hz;
   - [Proposed] a local deterministic controller keeps driving between two
     model decisions.

3. **The model should produce intent, not mutate physics.**
   A provider can choose a target such as lateral position / target speed /
   manoeuvre horizon. The browser remains the only component that turns that
   intent into low-level controls and applies the existing physics.

4. **Keep the existing paths.**
   Human input, Room Bot and direct MCP low-level control remain valid peers.
   The decision-driver path is additive. It must not replace `f1_act`,
   `f1_enqueue` or the normal multiplayer flow.

5. **Separate provider from transport.**
   "Who decides?" and "how do we reach the car?" are different concerns.
   A Jev adapter should not know WebSocket room messages; an MCP transport
   should not know Jev schemas.

6. **Use an OOP family for variants.**
   The decision engine is a concept with variants. Callers depend on one
   interface; adding a provider means adding a new implementation, not adding
   `if (provider === "jev")` throughout the project.

7. **Jev is an adapter/example, not the architecture.**
   Its provider-specific state projection and output parsing stay behind the
   common decision-provider contract.

## Existing F1 Racer capabilities we can reuse

- [Existing] `window._ENVIRONMENT_.getState()` produces a fresh structured
  race snapshot.
- [Existing] Agent API has `act`, `enqueue`, `release`.
- [Existing] WebMCP / remote MCP expose `f1_observe`, `f1_act`,
  `f1_enqueue`, `f1_radio`, `f1_release`.
- [Existing] agent token binds external control to one participant.
- [Existing] Room server relays agent calls but does not drive.
- [Existing] browser race input and player physics are the single authority
  for the controlled car.
- [Existing] human input can take control back.

## Proposed provider-neutral contracts

Names are architectural names, not committed code/API names yet.

### DecisionProvider

One interface implemented by provider variants:

```text
DecisionProvider.decide(DrivingObservation, DecisionContext)
    -> DrivingIntent
```

Candidate implementations:

```text
DecisionProvider
  ├─ JevDecisionProvider       [first experiment]
  ├─ ClaudeDecisionProvider    [future]
  ├─ LocalModelDecisionProvider
  └─ RulesDecisionProvider     [baseline / benchmark]
```

The orchestrator must never branch on provider type after construction.
A factory may select the implementation once at composition time.

### DrivingObservation

The canonical input is the F1 Racer observation, based on the current
`getState()` contract. Provider adapters may compress/project it, but the game
does not adopt a provider's request schema.

Useful fields already available include:

```text
speedKmh
lateralOffsetMeters
headingErrorRad
onTrack
returnHeadingErrorRad
nextCorner
nearbyCars
damage / tyre / DRS / race state
lap / position / totalProgress
```

### DrivingIntent

Provider-neutral high-level target. First useful shape to validate:

```json
{
  "targetOffsetMeters": -1.2,
  "targetSpeedKmh": 185,
  "horizonMs": 250,
  "confidence": 0.82
}
```

The exact schema is **[Open]**. The important invariant is that it expresses
a target/intention, not direct writes into physics.

A discrete provider such as Jev can choose between candidates and its adapter
maps the chosen candidate to a `DrivingIntent`.

### AgentPort

Transport-neutral port used by the orchestration loop:

```text
observe() -> DrivingObservation
drive(DrivingIntent) -> acknowledgement/state
release()
```

Possible implementations:

```text
AgentPort
  ├─ McpAgentPort          [wraps the remote MCP path]
  └─ BrowserAgentPort      [future/direct local facade if needed]
```

Whether `drive(intent)` becomes a new additive MCP tool or maps to another
transport is deliberately not fixed in this raw note.

### Local DriveController

[Proposed] Runs next to the real race input/physics, not inside the remote
decision provider.

Responsibilities:
- receive the latest `DrivingIntent`;
- smoothly converge towards target lateral offset / target speed;
- emit low-level steering/throttle/brake continuously;
- keep using the existing input/physics path;
- hold a bounded lease and fail neutral if intent expires;
- yield immediately to human takeover.

This is the key latency boundary: a 5–10 Hz decision stream can still feed a
60 Hz local control loop.

## Runtime flow — status included

```text
                       DECISION LOOP (~5–10 Hz)

[Existing] f1_observe / getState
              |
              v
[Existing] canonical DrivingObservation
              |
              v
[Proposed] DecisionProvider interface
              |
              +---- [External] Jev
              +---- [External] Claude / other model
              +---- [Local] rules / local model
              |
              v
[Proposed] provider-neutral DrivingIntent
              |
              v
[Proposed] AgentPort.drive(intent)
              |
              v
[Proposed] browser-local DriveController
              |
              | target held/interpolated
              v

                       CONTROL LOOP (~60 Hz)

[Existing] race-input external control
              |
              v
[Existing] player physics / main game loop
              |
              v
[Existing] multiplayer car_state + rendering
              |
              +---------------------------> next observation
```

## Why the DriveController belongs locally

Rejected shape:

```text
remote model -> 60 remote MCP calls/sec -> f1_act -> physics
```

Reasons:
- network/model jitter becomes steering jitter;
- a slow decision directly delays vehicle control;
- it couples model throughput to game frame rate;
- it wastes MCP/room relay calls;
- it makes provider latency a physics concern.

Preferred shape:

```text
model 5–10 Hz -> intent -> local controller 60 Hz -> existing physics
```

The remote provider decides *what the car should try to do*.
F1 Racer decides *how the car physically gets there*.

## C4 sketch

### C1 — context

```text
Human players -----------------------> F1 Racer
External decision engine -----------> Driver integration ----> F1 Racer
                                      ^
                                      |
                              Jev is one adapter
```

### C2 — containers

```text
[External Decision Engine]
          |
[DecisionProvider adapter]       NEW
          |
[Driver Orchestrator]            NEW
          |
[AgentPort / MCP]                existing path wrapped by NEW abstraction
          |
[Browser Agent Runtime]          EXISTING
          |
[Local DriveController]          NEW
          |
[Race Input + Physics]           EXISTING
```

### C3 — components

```text
DrivingObservation
       |
DecisionProvider.decide()
       |
DrivingIntent
       |
AgentPort.drive()
       |
DriveController
       |
ControlCommand (steer/throttle/brake)
       |
existing Agent API / race-input / physics
```

### C4 — code direction (proposed, not filenames yet)

```text
decision/
  decision-provider.js           abstract/interface family
  driving-intent.js              canonical intent value object
  driver-orchestrator.js         provider + port composition
  providers/
    jev-decision-provider.js     Jev-specific adapter only

race/
  drive-controller.js            local deterministic controller

transport/
  agent-port.js                  transport-neutral contract
  mcp-agent-port.js              MCP implementation
```

Exact paths are **[Open]** until implementation so that we can fit the current
module boundaries without creating a parallel architecture.

## Provider-agnostic acceptance rules

A future implementation is acceptable only if:

1. F1 Racer runs normally with no decision provider configured.
2. Human-only multiplayer needs no MCP or model process.
3. Existing Room Bot remains valid.
4. Existing direct low-level MCP tools remain valid.
5. Replacing Jev with another `DecisionProvider` does not modify physics,
   multiplayer or race UI.
6. Replacing MCP with another `AgentPort` does not modify decision-provider
   implementations.
7. The room server never evaluates provider decisions.
8. The provider never writes car position/velocity/physics state directly.
9. Human takeover and bounded-control safety remain effective.
10. A provider timeout degrades to bounded/local control then neutral, not to
    stale unbounded input.

## Jev-specific experiment, without architectural coupling

Jev is a good first experiment because its decision API can select among
bounded options. A Jev adapter could:

1. project the canonical observation into a compact Jev state;
2. generate safe candidate intents (for example left/center/right target
   offsets plus target speed);
3. ask Jev to select/score candidates;
4. map the selected candidate back to `DrivingIntent`;
5. return it through the common provider interface.

The same orchestrator and local controller should then work unchanged with a
different provider.

## Open questions

- Verify from a primary TypeSafe source whether Jev itself is actually a
  diffusion model. This label is not needed for the integration.
- Measure real Jev median and p95 latency on the hardware that will run it.
- Define the smallest useful `DrivingIntent` schema.
- Decide whether provider confidence belongs in the control contract or only
  in telemetry/diagnostics.
- Decide whether the transport exposes a new high-level MCP tool or keeps the
  high-level loop entirely local to a driver process.
- Benchmark Jev against a deterministic rules provider on identical recorded
  observations before judging quality.
