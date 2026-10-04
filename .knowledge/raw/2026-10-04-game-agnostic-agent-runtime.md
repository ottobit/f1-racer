# Raw discussion — game-agnostic Agent Game Runtime, 2026-10-04

Continuation of the provider-agnostic driver discussion.

## New target

The user wants to move one abstraction level above F1 Racer:

"play F1 with Jev" should become "play X with Y"

where:
- X is any supported game;
- Y is any model/agent stack.

The two axes must be independent.

## Core decision

Do **not** try to invent one universal game state containing concepts such as
speed, corner, enemy or weapon. Those concepts belong to game adapters.

Make the **runtime and protocol** generic instead.

~~~text
Game X
  -> GameAdapter
  -> generic GameObservation / decision frame / GameIntent
  -> GameAgentRuntime
  -> Agent Y
~~~

The game adapter owns domain semantics. The runtime never branches on game id.

## Generic game contract

The agreed remote contract is:

~~~text
game_describe
game_observe
game_frame
game_act
game_release
~~~

Meaning:

- game_describe: declares game identity, actions and strategy capabilities;
- game_observe: returns the current observation envelope;
- game_frame: converts live game state + current strategy into a bounded
  decision frame with candidate intents;
- game_act: applies one generic GameIntent;
- game_release: releases control.

Existing F1-specific low-level tools remain available. The game_* surface is
additive.

## Why game_frame exists

A fully generic agent cannot know how to safely turn arbitrary game state into
valid short-horizon options.

Therefore the game adapter supplies:

~~~text
state
instruction
candidate intents
default candidate
~~~

A generic model-backed agent can choose among those candidates without knowing
whether the game is racing, shooting or platforming.

This keeps:
- game semantics inside the game plugin;
- model protocol inside ModelClient;
- orchestration inside GameAgentRuntime.

## Generic intent

GameIntent is intentionally small:

~~~text
action
parameters
horizonMs
confidence
~~~

For F1 Racer:

~~~json
{
  "action": "drive",
  "parameters": {
    "pace": 0.94,
    "line": -0.75
  },
  "horizonMs": 650
}
~~~

A different game may expose actions such as move, aim, fire, jump or interact.
The runtime does not interpret the action name.

## Architecture after extraction

~~~text
                     AGENT AXIS (Y)

 StrategyProvider
       |
 DecisionProvider
       |
 ModelClient
       |
       v
 +-------------------+
 | GameAgentRuntime  |
 +-------------------+
       |
       v
 RemoteGameAdapter
       |
 generic game_* tools
       |
       v

                     GAME AXIS (X)

 +-----------------------+
 | game-specific adapter |
 +-----------------------+
       |
       +-- F1RacerGameAdapter
       +-- future Doom adapter
       +-- future kart adapter
       +-- future platform adapter
       |
       v
 native game input / physics
~~~

## F1 Racer becomes plugin #1

F1-specific behavior remains in:
- F1RacerGameAdapter;
- DriveController;
- existing F1 Agent API;
- existing F1 input/physics.

The Node-side GameAgentRuntime, CandidateDecisionProvider and
RemoteGameAdapter contain no F1 racing decisions.

## OOP rule

GameAdapter is now a real class family.

Adding game Z should require:
1. implementing the generic game contract in Z;
2. no modification to GameAgentRuntime;
3. no modification to CandidateDecisionProvider;
4. no modification to SystemOneModelClient.

Adding agent/model Y should require:
1. adding/configuring a StrategyProvider, DecisionProvider or ModelClient;
2. no modification to F1RacerGameAdapter or another game adapter.

Only the composition root may select variants.

## Concrete runtime extraction in #377/#378

The draft runtime was immediately generalized before merge:

- shared game-agnostic contracts moved to core/shared/agent-game.js;
- F1RacerGameAdapter created in the browser;
- generic game_* MCP/relay surface added;
- RemoteGameAdapter introduced for any compatible game endpoint;
- DriverOrchestrator evolved into GameAgentRuntime;
- Racing-specific candidate generation moved out of CandidateDecisionProvider
  and into F1RacerGameAdapter;
- CandidateDecisionProvider became game-agnostic;
- RulesDecisionProvider became DefaultDecisionProvider: it simply selects the
  default bounded candidate supplied by the game adapter;
- decision-driver runner evolved into agent-game runner.

## Target matrix

~~~text
                Jev     ChatGPT     Claude     Local     Rules
F1 Racer         x         x          x          x         x
Doom             x         x          x          x         x
Game Z           x         x          x          x         x
~~~

Support for a matrix cell means compatible adapters exist on both axes; it
must not require a special-case pair implementation.

## Important boundary

We still should not generalize the game physics/controller itself into one
universal controller.

A local frame-rate controller may remain game-specific:
- F1 -> DriveController;
- shooter -> aim/movement controller;
- platformer -> movement/jump controller.

The generic runtime sends bounded GameIntent. The game plugin decides how to
execute it safely at native frame rate.

## Acceptance rule

The architecture is truly X x Y when:

- changing F1 Racer to another game does not modify agent/model code;
- changing Jev to another agent does not modify game code;
- no pair-specific if(game, agent) condition exists;
- the runtime only sees GameAdapter, StrategyProvider, DecisionProvider and
  ModelClient contracts.
