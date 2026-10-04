---
type: source
updated: 2026-10-04
raw:
  - ../../raw/2026-10-04-provider-agnostic-decision-driver-discussion.md
---

# Source Note: provider-agnostic AI race driver discussion

Source: [raw discussion](../../raw/2026-10-04-provider-agnostic-decision-driver-discussion.md)  
Captured: 2026-10-04

## What the discussion established

The user wants to experiment with Jev-like fast decision models as racing
drivers, but only behind a provider-neutral architecture. Jev must be an
adapter, never a dependency of F1 Racer's physics, multiplayer or UI.

The central design is a **two-rate loop**:

- the existing browser input/physics loop stays near 60 Hz;
- an external decision provider may run much more slowly (initial target
  roughly 5–10 Hz);
- a new deterministic browser-local controller holds/interpolates the latest
  high-level intent between provider decisions.

This avoids making network/model latency part of steering physics.

## Reuse vs new work

Already present:
- structured `getState()` / `f1_observe`;
- low-level `act`, `enqueue`, `release`;
- remote MCP relay and one-participant agent token;
- race input, physics, multiplayer state sync and human takeover.

Proposed:
- a `DecisionProvider` family for Jev / Claude / local model / rules;
- a provider-neutral `DrivingIntent`;
- a transport-neutral `AgentPort`;
- a local `DriveController` that converts intent to low-level controls at
  frame rate;
- an orchestrator that composes provider and port without type switches.

## Jev-specific status

Jev is the first intended adapter/example, not the architecture.

The claim heard in the shared video that Jev is a "diffusion model" remains
**Needs verification**. None of the provider-neutral design depends on that
classification.

## Design boundary

The model chooses intent. F1 Racer remains the only authority that applies
input and physics. Existing human, Room Bot and direct low-level MCP paths are
preserved.
