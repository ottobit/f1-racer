---
type: overview
updated: 2026-10-04
sources: []
---

# Overview

F1 Racer is a static browser racing game (plain HTML/CSS/JavaScript and
Three.js, no bundler) published on GitHub Pages, played mostly on phones.

- **Solo**: qualifying then race against AI rivals on 9 circuits, in two
  series: F1 (12 drivers, 6 teams) and Classiche (road cars, one-make).
  See [entities/race-systems.md](entities/race-systems.md),
  [entities/classic-series.md](entities/classic-series.md).
- **Garage and free drive**: [entities/garage.md](entities/garage.md),
  [entities/free-drive.md](entities/free-drive.md).
- **Multiplayer**: rooms on a Node WebSocket server (Render), race voice
  over a public MoQ relay. See
  [entities/multiplayer-protocol.md](entities/multiplayer-protocol.md),
  [comparisons/c4-voice.md](comparisons/c4-voice.md).
- **Agents**: bots drive through the `window._ENVIRONMENT_` contract,
  locally or over MCP. See [entities/agent-api.md](entities/agent-api.md),
  [entities/agent-bots.md](entities/agent-bots.md).

How the code is organised: [synthesis/architecture.md](synthesis/architecture.md)
and [synthesis/c4-model.md](synthesis/c4-model.md). How we write it:
[concepts/oop.md](concepts/oop.md). Why things are as they are:
[synthesis/decisions.md](synthesis/decisions.md).

User preferences that shape the work: the user plays on `master` and
reports (no browser tests by default); phones must keep full frame rate;
no service that can bill without a hard cap.
