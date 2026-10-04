# Index

Catalog of every wiki page, one line each (Karpathy LLM Wiki `index.md`).
Start from [overview.md](overview.md); the history is in [log.md](log.md);
the rules are in [../AGENTS.md](../AGENTS.md). Update this file whenever a
page is added, renamed or removed.

## Overview

- [overview.md](overview.md) — the game in one page: what it is, how it runs, where to start

## Entities — the concrete parts of the game

- [entities/tracks.md](entities/tracks.md) — circuits, track geometry, lap counting, carousel
- [entities/car-rendering.md](entities/car-rendering.md) — procedural F1 car, liveries, drivers, nameplates
- [entities/garage.md](entities/garage.md) — garage setup, showroom, road garage
- [entities/audio.md](entities/audio.md) — engine sound and start procedure
- [entities/hud-camera-mobile.md](entities/hud-camera-mobile.md) — HUD, input, camera, touch controls
- [entities/race-systems.md](entities/race-systems.md) — AI, qualifying, ghost, championship
- [entities/classic-series.md](entities/classic-series.md) — Classiche series (road cars, one-make)
- [entities/free-drive.md](entities/free-drive.md) — free drive page
- [entities/multiplayer-protocol.md](entities/multiplayer-protocol.md) — room server, messages, sync, security
- [entities/agent-api.md](entities/agent-api.md) — `window._ENVIRONMENT_` agent contract
- [entities/agent-bots.md](entities/agent-bots.md) — browser vs headless bots, how to run them
- [entities/tooling.md](entities/tooling.md) — publishing workflow (patch-based, contents-API fallback)

## Concepts — ideas that cut across the code

- [concepts/oop.md](concepts/oop.md) — object-oriented design rules (apply before writing code)
- [concepts/runtime-overview.md](concepts/runtime-overview.md) — frame loop and session phases
- [concepts/driving-model.md](concepts/driving-model.md) — physics, DRS, tyres, damage
- [concepts/performance.md](concepts/performance.md) — graphics profiles and phone budget

## Synthesis — the whole picture

- [synthesis/architecture.md](synthesis/architecture.md) — module map and source layout
- [synthesis/decisions.md](synthesis/decisions.md) — decisions with status and reasons
- [synthesis/roadmap.md](synthesis/roadmap.md) — open product and technical work
- [synthesis/c4-model.md](synthesis/c4-model.md) — combined C4 map of game and multiplayer
- [synthesis/c4-local.md](synthesis/c4-local.md) — solo play, C4 levels 1 to 4
- [synthesis/c4-multiplayer.md](synthesis/c4-multiplayer.md) — multiplayer, C4 levels 1 to 4
- [synthesis/c4-agent-control.md](synthesis/c4-agent-control.md) — humans, room bots and MCP coexisting
- [synthesis/c4-mcp.md](synthesis/c4-mcp.md) — remote MCP control path
- [synthesis/c4-decision-driver.md](synthesis/c4-decision-driver.md) — provider-agnostic decision driver, C4 and two-rate runtime flow

## Comparisons

- [comparisons/c4-voice.md](comparisons/c4-voice.md) — race voice: WebRTC mesh (removed) vs MoQ relay (current)

## Sources — one summary per source

- [sources/karpathy-llm-wiki.md](sources/karpathy-llm-wiki.md) — the LLM Wiki pattern this wiki follows
- [sources/2026-09-27-agent-bots-session.md](sources/2026-09-27-agent-bots-session.md) — agent bots in play sessions
- [sources/2026-09-27-browser-bot-capacity.md](sources/2026-09-27-browser-bot-capacity.md) — browser bot capacity (HBKY, XK5Z races)
- [sources/2026-09-27-twelve-car-bot-races.md](sources/2026-09-27-twelve-car-bot-races.md) — 12-car bot races
- [sources/2026-09-28-race-vsn2-local-pc.md](sources/2026-09-28-race-vsn2-local-pc.md) — race VSN2 from the player's PC
- [sources/2026-10-01-ollama-jev-decision-models.md](sources/2026-10-01-ollama-jev-decision-models.md) — Ollama Jev-style decision models
- [sources/2026-10-04-oop-principles.md](sources/2026-10-04-oop-principles.md) — object-oriented principles
- [sources/2026-10-04-provider-agnostic-decision-driver-discussion.md](sources/2026-10-04-provider-agnostic-decision-driver-discussion.md) — discussion and rationale for an agnostic high-level AI race driver
- [sources/2026-10-04-decision-driver-render-test.md](sources/2026-10-04-decision-driver-render-test.md) — OOP implementation order and reuse of the Render room backend for testing
- [sources/2026-10-04-layered-ai-driver-discussion.md](sources/2026-10-04-layered-ai-driver-discussion.md) — three-rate agent stack, generic model client and ChatGPT strategist role

Raw, immutable inputs behind the sources live in [../raw/](../raw/).

## Operational docs (outside the wiki)

- [`docs/procedure.md`](../../docs/procedure.md), [`docs/WORK-HANDOFF.md`](../../docs/WORK-HANDOFF.md), [`docs/RELEASE-CHECKLIST.md`](../../docs/RELEASE-CHECKLIST.md)
