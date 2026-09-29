# F1 Racer agent control — C4 levels 1 to 4

> Current/additive architecture for human multiplayer, existing Room Bot
> strategy and remote MCP control. The central constraint is coexistence:
> MCP is an optional adapter and does **not** replace human multiplayer,
> the existing Room Bot strategy workflow, local physics or the room protocol.

## Visual legend

```mermaid
flowchart LR
  person["Person"]:::person
  system["System / container"]:::container
  component["Component / code"]:::component
  data[("Data / runtime state")]:::data
  external["External client / infrastructure"]:::external
  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef component fill:#438dd5,color:#fff,stroke:#246b9e
  classDef data fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef external fill:#666,color:#fff,stroke:#444
```

## C4 Level 1 — System context

```mermaid
flowchart TB
  human["Person: Human player<br/>Plays normally with friends"]:::person
  strategist["Person / agent strategist<br/>Uses the existing Room Bot strategy workflow"]:::person
  remoteAgent["External AI client<br/>Claude, ChatGPT or another MCP client"]:::external

  f1["Software system: F1 Racer<br/>One game, three optional control entry paths"]:::container

  pages["GitHub Pages<br/>Static game delivery"]:::external
  tunnel["Public HTTPS/WSS tunnel or reverse proxy"]:::external

  human -->|"Normal browser controls"| f1
  strategist -->|"Existing strategy files / Room Bot workflow"| f1
  remoteAgent -->|"Remote Streamable HTTP MCP"| f1
  pages -->|"Serves browser game"| f1
  f1 <-->|"Optional public reachability"| tunnel

  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef external fill:#666,color:#fff,stroke:#444
```

### Context rule

All three modes are peers, not generations of the same feature:

1. **Human multiplayer** stays the default path and needs no agent flags.
2. **Existing Room Bot + strategy** stays intact and keeps its current
   Playwright/headless + `strategy.json` / `state.json` workflow.
3. **Remote MCP** is an opt-in additional control adapter for one participant
   opened with `?agent=1`.

No path owns F1 physics or room state; they only feed control/strategy into the
same game runtime.

## C4 Level 2 — Containers

```mermaid
flowchart TB
  human["Human player / friends"]:::person
  strategist["Agent strategist"]:::person
  mcpClient["Claude / ChatGPT / MCP client"]:::external

  subgraph f1["F1 Racer"]
    browserHuman["Browser game — human session<br/>Normal input + local physics"]:::container
    browserAgent["Browser game — agent session<br/>Same local physics + agent facade"]:::container
    roomBot["Existing Room Bot<br/>Playwright/headless driver + strategy files"]:::container
    roomServer["Room server<br/>Node.js + ws<br/>Room lifecycle and relays"]:::container
    mcpHttp["Remote MCP endpoint<br/>Streamable HTTP /mcp"]:::container
    mcpStdio["Optional stdio MCP fallback<br/>Local tooling only"]:::container
    roomState[("In-memory room state")]:::data
  end

  edge["HTTPS/WSS reverse proxy or tunnel"]:::external

  human --> browserHuman
  strategist -->|"Reads state / writes strategy"| roomBot
  mcpClient -->|"Streamable HTTP<br/>https://host/mcp"| edge
  edge --> mcpHttp

  browserHuman <-->|"Ordinary room WebSocket"| roomServer
  browserAgent <-->|"Ordinary room WebSocket + agent relay"| roomServer
  roomBot <-->|"Ordinary participant protocol"| roomServer
  roomServer <--> roomState

  mcpHttp -->|"agent_attach / agent_call"| roomServer
  mcpStdio -->|"Optional same relay"| roomServer

  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef data fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef external fill:#666,color:#fff,stroke:#444
```

### Container responsibilities

| Container | Responsibility | Must not do |
|---|---|---|
| Human browser game | Human input, rendering, physics, multiplayer participation | Depend on MCP or bot tooling |
| Agent browser game | Same rendering/physics plus opt-in `agent-api.js` | Simulate a second physics model |
| Existing Room Bot | Current autonomous driving + live strategy workflow | Be replaced by MCP |
| Room server | Room authority, car-state relay, agent-call relay | Decide steering, braking or strategy |
| Remote MCP endpoint | Translate remote MCP calls to the existing four `f1_*` tools | Own room state or another participant |
| stdio MCP fallback | Optional local access to the same relay | Become the required Claude path |

## C4 Level 3 — Control components

```mermaid
flowchart TB
  humanInput["Human input<br/>keyboard / touch / gamepad / gyro"]:::component
  roomBotStrategy["Existing strategy workflow<br/>strategy.json + state.json"]:::component
  remoteMcp["Remote MCP transport<br/>agent-mcp-http.mjs"]:::component
  stdioMcp["Optional stdio transport<br/>agent-mcp-server.mjs"]:::component

  sharedMcp["Shared MCP bridge primitives<br/>agent-mcp-common.mjs"]:::component
  relay["Agent relay<br/>room-server.mjs"]:::component
  mpClient["Room client / multiplayer adapter<br/>room-client.js + race-multiplayer.js"]:::component
  facade["Agent facade<br/>agent-api.js"]:::component
  input["Race input controller<br/>race-input.js"]:::component
  providers["Existing Room Bot driver/providers"]:::component
  physics["Single player physics path<br/>player-physics.js + main.js"]:::component
  sync["Ordinary multiplayer car_state sync"]:::component

  humanInput --> input
  roomBotStrategy --> providers
  providers --> input

  remoteMcp --> sharedMcp
  stdioMcp --> sharedMcp
  sharedMcp -->|"agent_attach / agent_call"| relay
  relay -->|"agent_command"| mpClient
  mpClient --> facade
  facade --> input

  input --> physics
  physics --> sync

  classDef component fill:#438dd5,color:#fff,stroke:#246b9e
```

### Control invariants

- There is **one** local race input/physics path.
- Human input keeps precedence over an active agent command.
- `f1_act` uses leases; expiry or `f1_release` returns controls to neutral.
- MCP can control only the participant that registered its bearer token.
- Existing Room Bot providers keep driving exactly as before; MCP does not
  intercept their `strategy.json` / `state.json` contract.
- Human-only rooms never initialize the agent bridge because `?agent=1` is
  absent.

## C4 Level 4 — Key code path

```mermaid
flowchart LR
  subgraph remote["Remote MCP path — optional"]
    http["agent-mcp-http.mjs<br/>POST /mcp"]
    common["agent-mcp-common.mjs<br/>MCP_TOOLS + AgentBridgeClient"]
  end

  subgraph room["Room transport"]
    server["room-server.mjs<br/>agent_bridge_register<br/>agent_attach<br/>agent_call<br/>agent_result"]
    roomClient["room-client.js<br/>onAgentCommand / sendAgentResult"]
    raceMp["race-multiplayer.js<br/>registerAgentBridge()"]
  end

  subgraph race["Browser race runtime"]
    api["agent-api.js<br/>invokeAgentTool()"]
    control["act / enqueue / release<br/>single controller + lease"]
    input["race-input.js<br/>setExternalSteer + human takeover"]
    physics["player-physics.js / main.js<br/>single simulation"]
  end

  http --> common
  common --> server
  server --> roomClient
  roomClient --> raceMp
  raceMp --> api
  api --> control
  control --> input
  input --> physics
  physics -. "car_state, same multiplayer path" .-> server
```

### Existing paths deliberately bypassing MCP

```mermaid
flowchart LR
  friend["Friend browser"]:::person --> humanInput["Normal race input"]:::component --> physics["Same local physics"]:::component
  strategy["Existing Room Bot strategy"]:::external --> bot["Room Bot driver/provider"]:::component --> physics
  mcp["Remote MCP client"]:::external --> adapter["MCP adapter"]:::component --> physics

  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef component fill:#438dd5,color:#fff,stroke:#246b9e
  classDef external fill:#666,color:#fff,stroke:#444
```

That last view is the architectural guardrail: **three entry paths, one race
runtime**. Removing either of the first two paths in order to simplify MCP is
a regression.

## Dynamic view — remote MCP control

```mermaid
sequenceDiagram
  participant C as Claude / ChatGPT
  participant M as Remote MCP /mcp
  participant R as Room server
  participant B as Agent browser
  participant P as Local race physics

  Note over B,R: Browser joined as an ordinary room participant
  B->>R: agent_bridge_register(token)
  C->>M: tools/list
  M-->>C: f1_observe, f1_act, f1_enqueue, f1_release
  C->>M: tools/call f1_observe
  M->>R: agent_attach(token), agent_call
  R->>B: agent_command(f1_observe)
  B->>P: getState()
  P-->>B: snapshot
  B->>R: agent_result(snapshot)
  R-->>M: agent_result(snapshot)
  M-->>C: MCP tool result

  loop Driving decisions
    C->>M: tools/call f1_act
    M->>R: agent_call(f1_act)
    R->>B: agent_command
    B->>P: apply steer/throttle/brake lease
    P-->>B: updated state
    B-->>R: agent_result
    R-->>M: agent_result
    M-->>C: MCP tool result
  end
```

## Deployment view

```mermaid
flowchart TB
  friends["Human browsers"]:::person
  claude["Claude / ChatGPT"]:::external

  subgraph host["Host / deployment"]
    game["Static F1 Racer site"]:::container
    room["room-server.mjs<br/>:8787"]:::container
    mcp["agent-mcp-http.mjs<br/>:8790 /mcp"]:::container
  end

  public["HTTPS/WSS reverse proxy / tunnel"]:::external

  friends -->|"HTTPS game + WSS multiplayer"| public
  claude -->|"HTTPS Streamable HTTP /mcp"| public
  public --> game
  public --> room
  public --> mcp
  mcp -->|"WebSocket agent relay"| room

  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef external fill:#666,color:#fff,stroke:#444
```

A deployment may expose room and MCP endpoints through the same public host or
through separate hosts/tunnels. They remain separate processes and protocols.

## Regression boundary

Any future change to the agent integration must preserve these acceptance
rules:

- a room with only human friends works with no MCP process running;
- the existing Room Bot/strategy workflow works with no MCP process running;
- enabling remote MCP affects only the browser participant that opted in with
  `?agent=1` and registered the matching token;
- room lifecycle, qualifying, race sync, voice and normal `car_state` relays
  remain independent of MCP availability;
- physics/input code is shared rather than duplicated.
