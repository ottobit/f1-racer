---
type: source
updated: 2026-10-04
raw:
  - ../../raw/2026-10-04-decision-driver-render-test.md
---

# Source Note: OOP implementation and Render test topology

Source: [raw discussion](../../raw/2026-10-04-decision-driver-render-test.md)  
Captured: 2026-10-04

## Decision

The existing Render room server is reusable for decision-driver tests as the
multiplayer/agent relay. Provider inference and driving policy stay outside the
room server.

For the first implementation, a local runner can connect to the existing
Render agent relay through an `AgentPort` implementation and drive a browser
participant on GitHub Pages. This avoids requiring a second free Render
service.

## OOP boundary

Two independent variant families are proposed:

- `DecisionProvider`: rules, Jev, future models;
- `AgentPort`: direct relay, MCP, future transports.

`DriverOrchestrator` composes one of each and does not branch on concrete
types. The browser-local `DriveController` is provider-neutral and remains
the only new component responsible for turning high-level intent into smooth
low-level controls.

## Test order

Start with a deterministic rules provider, prove the complete path through the
existing Render backend and the local controller, then add Jev as a provider
adapter. This makes the Jev comparison meaningful and proves the abstraction
before introducing model variability.
