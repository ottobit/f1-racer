---
type: source
updated: 2026-10-04
raw:
  - ../../raw/2026-10-04-layered-ai-driver-discussion.md
---

# Source Note: layered AI drivers and strategist role

Source: [raw discussion](../../raw/2026-10-04-layered-ai-driver-discussion.md)  
Captured: 2026-10-04

## Target state

A single multiplayer room may contain humans and heterogeneous agent stacks:
ChatGPT, Claude, Jev/System One, deterministic rules and existing Room Bots.
F1 Racer should see only participants and provider-neutral driving contracts.

## Architectural refinement

The control stack has three different cadences:

- **strategy** (~0.1–1 Hz or event-driven): semantic race decisions, suitable
  for ChatGPT/Claude;
- **decision** (~5–10 Hz): short-horizon driving intent, suitable for a fast
  decision model such as Jev/System One;
- **control** (~60 Hz): deterministic local conversion of intent into
  steer/throttle/brake, owned by F1 Racer.

A second abstraction, `ModelClient`, separates model protocol from racing
semantics. A `DecisionProvider` understands racing; a `ModelClient`
understands a model API. This allows model changes behind one protocol to be
configuration-only and protocol changes to remain outside the race domain.

## ChatGPT role

The preferred role for ChatGPT is `StrategyProvider`, not the frame-rate
controller. ChatGPT can periodically or event-by-event produce a
`StrategyDirective` consumed by the faster decision provider. The contracts
still permit ChatGPT to be used directly as a decision provider for
experimentation.

## Invariant

Human input, existing Room Bot, direct MCP control and the new layered
decision-driver remain peer entry paths into the same race/input/physics
runtime.
