# Raw discussion — OOP implementation and Render test topology, 2026-10-04

Continuation of the provider-agnostic decision-driver discussion.

## User intent

- Proceed with the architecture documentation.
- Implement the future runtime carefully with the project's OOP rules.
- Reuse the existing F1 Racer backend on Render during testing if feasible.

## Feasibility conclusion

**Yes, with an important boundary.**

Reuse the existing Render service as the **room/agent relay backend**. Do not
put provider inference or driving policy inside `room-server.mjs`.

The current deployed service already:
- accepts ordinary multiplayer WebSocket clients;
- owns the room lifecycle;
- supports the agent bridge token;
- relays `agent_attach / agent_call / agent_result`;
- remains provider-neutral.

That is exactly the backend role needed by the decision-driver experiment.

## Recommended first test topology

```text
GitHub Pages
  race.html?agent=1
       |
       | normal room socket + agent bridge
       v
Existing Render room backend
  f1-racer-rooms.onrender.com
       ^
       | agent relay WebSocket
       |
Local test runner on developer PC
  DriverOrchestrator
       |
       +-- DecisionProvider
       |     +-- RulesDecisionProvider first
       |     +-- JevDecisionProvider second
       |
       +-- AgentPort
             +-- RelayAgentPort / existing AgentBridgeClient
       |
       +-- receives DrivingObservation
       +-- sends DrivingIntent
       
Browser-local DriveController
       |
       v
existing race-input -> physics
```

The model/runtime can therefore stay local while the multiplayer backend stays
on Render. This avoids needing a second cloud service for the first experiment.

## Why not host Jev on the existing Render room service

The current Render service is intentionally thin and provider-neutral. It also
uses the free service budget almost continuously to keep the room server awake.

Adding Jev/model inference there would:
- mix room authority with decision policy;
- couple deployment to one provider/runtime;
- consume CPU/memory needed by multiplayer;
- make provider failures capable of hurting human rooms;
- work against the existing C4 boundary.

For the first test, inference belongs outside Render.

## MCP process and the free Render plan

The existing `agent-mcp-http.mjs` is a separate process by design. The current
free Render service exposes one web process/port and already consumes roughly
the account's monthly free-hour budget.

Therefore the first test should **not require a second Render service**.

Two valid transport implementations behind `AgentPort`:

1. **RelayAgentPort** — local runner reuses the existing
   `AgentBridgeClient` directly against the Render room server. This is the
   leanest path for local Jev testing.
2. **McpAgentPort** — use the existing MCP HTTP process when the caller itself
   needs MCP (for example a remote ChatGPT/Claude client). It can run locally
   or on another suitable host.

Both ports expose the same domain-facing operations, so providers do not know
which transport is active.

## OOP direction

The implementation should use small families with one composition point:

```text
DecisionProvider
  +-- RulesDecisionProvider
  +-- JevDecisionProvider
  +-- future provider

AgentPort
  +-- RelayAgentPort
  +-- McpAgentPort
  +-- future transport

DriveController
  +-- one provider-neutral deterministic controller
```

`DriverOrchestrator` receives a `DecisionProvider` and an `AgentPort`
through construction/composition. It never switches on their concrete types.

A factory may choose concrete implementations once from configuration. No
`if (provider === "jev")` or `if (transport === "mcp")` belongs in the
orchestrator, race loop or physics.

## Development order proposed

1. Define value objects/contracts: `DrivingObservation`, `DrivingIntent`.
2. Define `DecisionProvider` and `AgentPort` abstractions.
3. Implement `RulesDecisionProvider` first as deterministic baseline.
4. Implement `RelayAgentPort` over the existing Render agent relay.
5. Implement the browser-local `DriveController`.
6. Prove one full lap with rules provider.
7. Add `JevDecisionProvider` only after the neutral path works.
8. Compare rules vs Jev using the same observations and controller.
9. Add/retain `McpAgentPort` for remote model clients where MCP is useful.

## Test criterion

The first architecture test succeeds when changing only the
`DecisionProvider` changes who decides, while:
- the same Render backend is used;
- the same `AgentPort` is used;
- the same DriveController is used;
- the same browser input/physics pipeline is used.

That proves provider agnosticism rather than merely documenting it.
