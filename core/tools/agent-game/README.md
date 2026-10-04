# Agent Game Runtime

Generic runtime for pairing a supported game (X) with an agent/model stack (Y).

## Contract

A compatible remote game exposes:

- `game_describe`
- `game_observe`
- `game_frame`
- `game_act`
- `game_release`

The runtime never branches on the game id or action names.

## Composition

```text
GameAdapter X
    |
GameAgentRuntime
    |
StrategyProvider
DecisionProvider
ModelClient Y
```

F1 Racer is the first game plugin. Its browser-side `F1RacerGameAdapter`
owns racing semantics and converts generic `GameIntent` objects into the
existing local `DriveController`.

## Run

From `core/`:

```bash
GAME_SERVER=https://f1-racer-rooms.onrender.com \
GAME_TOKEN=<agent-token> \
AGENT_DECISION_PROVIDER=default \
npm run start:agent-game
```

For a System One model:

```bash
GAME_SERVER=https://f1-racer-rooms.onrender.com \
GAME_TOKEN=<agent-token> \
AGENT_DECISION_PROVIDER=model \
AGENT_MODEL_CLIENT=systemone \
AGENT_MODEL_BASE_URL=http://localhost:11434 \
AGENT_MODEL=nimble \
npm run start:agent-game
```

A different game should implement the same `game_*` contract. A different
model protocol should implement `ModelClient`. Neither change should require
editing `GameAgentRuntime`.
