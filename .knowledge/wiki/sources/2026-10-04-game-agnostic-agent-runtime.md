---
type: source
updated: 2026-10-04
raw:
  - ../../raw/2026-10-04-game-agnostic-agent-runtime.md
---

# Source Note: game-agnostic Agent Game Runtime

Source: [raw discussion](../../raw/2026-10-04-game-agnostic-agent-runtime.md)  
Captured: 2026-10-04

## Target

Generalize "F1 Racer with Jev" into the independent product axes
**Game X × Agent Y**.

## Decision

The universal abstraction is the runtime/protocol, not the game state.

A supported game exposes the generic surface:
game_describe, game_observe, game_frame, game_act and game_release.

The game adapter owns its semantics and bounded candidate intents. Generic
decision providers choose among those candidates, and ModelClient owns only
the model protocol.

## First implementation

The draft runtime in #377/#378 was refactored before merge so F1 Racer is the
first game plugin rather than the runtime's built-in domain.
