# F1 Racer multiplayer — C4 levels 1 to 4

> Current architecture. This model follows a room from its invitation URL down
> to WebSocket messages, in-memory state and peer-to-peer audio.

## Visual legend

```mermaid
flowchart LR
  person["Person"]:::person
  system["System / container"]:::container
  component["Component / code"]:::component
  data[("Data store")]:::data
  external["External dependency"]:::external
  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef component fill:#438dd5,color:#fff,stroke:#246b9e
  classDef data fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef external fill:#666,color:#fff,stroke:#444
```

## C4 Level 1 — System context

```mermaid
flowchart TB
  host["Host player<br/>Runs the room service and controls room setup"]:::person
  guest["Guest player<br/>Joins from an invitation URL"]:::person
  agent["Agent operator<br/>May join an automated driver"]:::person

  multi["F1 Racer multiplayer system<br/>Shared lobby, qualifying, race state,<br/>remote cars and broadcast voice"]:::container

  pages["GitHub Pages<br/>Delivers the same static browser game"]:::external
  tunnel["Public tunnel<br/>Maps public WSS to the host process"]:::external
  stun["STUN service<br/>Assists WebRTC connectivity"]:::external

  host -->|"Creates and races in a room"| multi
  guest -->|"Joins and races"| multi
  agent -->|"Joins as an ordinary participant"| multi
  pages -->|"Serves every browser client"| multi
  multi -->|"Uses for public WebSocket reachability"| tunnel
  multi -->|"Uses for voice peer discovery"| stun

  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef external fill:#666,color:#fff,stroke:#444
```

### Context boundary

F1 Racer multiplayer coordinates friendly sessions; it is not an authoritative
competitive simulation. Each participant's browser simulates and declares its
own car state.

## C4 Level 2 — Containers

```mermaid
flowchart TB
  host["Host player"]:::person
  guest["Guest players"]:::person
  operator["Agent operator"]:::person

  subgraph system["F1 Racer multiplayer"]
    hostClient["Host browser client<br/>Local simulation + room protocol + WebRTC"]:::container
    guestClient["Guest browser clients<br/>Local simulation + room protocol + WebRTC"]:::container
    roomServer["Room server<br/>Node.js + ws<br/>Lifecycle, shared phase and relay"]:::container
    roomStore[("In-memory room store<br/>Rooms, participants, grid,<br/>socket index and timers")]:::data
    roomBot["Optional Room Bot<br/>Node.js + Playwright + Chromium"]:::container
  end

  pages["GitHub Pages"]:::external
  edge["ngrok or equivalent tunnel"]:::external
  stun["STUN service"]:::external

  host --> hostClient
  guest --> guestClient
  operator --> roomBot
  pages -->|"Static application"| hostClient
  pages -->|"Static application"| guestClient
  hostClient <-->|"JSON over WSS"| edge
  guestClient <-->|"JSON over WSS"| edge
  roomBot <-->|"Same room protocol"| edge
  edge <-->|"Forwards to WS :8787"| roomServer
  roomServer <-->|"Owns until process exit"| roomStore
  hostClient <-->|"WebRTC audio mesh"| guestClient
  hostClient --> stun
  guestClient --> stun

  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef data fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef external fill:#666,color:#fff,stroke:#444
```

### Container boundaries

- The room server is optional and is never imported by the static pages.
- The tunnel is infrastructure, not application logic.
- Room Bot uses the actual page and protocol instead of a privileged server
  endpoint.
- The server stores no voice media and no per-frame car history.

## C4 Level 3 — Multiplayer components

```mermaid
flowchart TB
  subgraph browser["Each browser client"]
    lobby["Lobby UI<br/>room.js"]:::component
    protocol["Room protocol client<br/>room-client.js"]:::component
    bootstrap["Pre-race reconnect<br/>race-bootstrap.js"]:::component
    adapter["Race sync adapter<br/>race-multiplayer.js"]:::component
    race["Local race simulation<br/>race/main.js"]:::container
    voice["Voice mesh<br/>voice-chat.js"]:::component
    session[("Reconnect session<br/>localStorage")]:::data
  end

  subgraph server["Room server process"]
    transport["WebSocket transport<br/>room-server.mjs"]:::component
    stateMachine["Room state machine<br/>rooms.mjs"]:::component
    rooms[("Room + participant maps")]:::data
    sockets[("Socket map + qualifying timers")]:::data
  end

  peer["Other browser clients"]:::external

  lobby --> protocol
  bootstrap --> protocol
  bootstrap --> race
  race <--> adapter
  adapter <--> protocol
  voice <--> protocol
  protocol <--> session
  protocol <-->|"Commands, room_state,<br/>car_state, voice_signal"| transport
  transport <--> stateMachine
  stateMachine <--> rooms
  transport <--> sockets
  transport <-->|"Ephemeral relay"| peer
  voice <-->|"Audio after signaling"| peer

  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef component fill:#438dd5,color:#fff,stroke:#246b9e
  classDef data fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef external fill:#666,color:#fff,stroke:#444
```

### Two data paths

1. **Reliable room commands:** request/response messages carry a `reqId`; the
   server validates them through `rooms.mjs` and broadcasts a complete public
   room snapshot.
2. **Ephemeral realtime relay:** `car_state` and `voice_signal` are forwarded
   without entering the room state machine. Car samples are not acknowledged or
   stored.

## C4 Level 4 — Protocol and server code

```mermaid
classDiagram
  direction LR

  class RoomClient {
    session
    pendingRequests
    clockOffsetMs
    createRoom()
    joinRoom()
    tryResume()
    sendCarState()
    sendVoiceSignal()
  }

  class RaceMultiplayer {
    remoteSamples
    disconnectedDrivers
    broadcastState()
    getRemoteSample()
    reportQualiTime()
    reportFinish()
  }

  class VoiceChat {
    peerConnections
    localTrack
    startVoiceChat()
    handleSignal()
  }

  class RoomServerTransport {
    socketsByRoom
    qualifyingTimers
    handleMessage(type)
    broadcastRoom()
    relayCarState()
    relayVoiceSignal()
  }

  class RoomStateMachine {
    createRoom()
    joinRoom()
    reserveDriver()
    setCircuit()
    startRace()
    finishQualifying()
    reportFinish()
    markDisconnected()
  }

  class Room {
    code
    hostParticipantId
    circuitId
    difficulty
    sessionPhase
    grid
    participants
  }

  class Participant {
    participantId
    reconnectToken
    driverId
    ready
    qualiBestTime
    finishedAt
    connectionState
  }

  RoomClient --> RaceMultiplayer : supplies room events
  RoomClient --> VoiceChat : carries signaling
  RoomClient --> RoomServerTransport : JSON WebSocket
  RoomServerTransport --> RoomStateMachine : validated commands
  RoomStateMachine --> Room : mutates
  Room "1" *-- "1..10" Participant
  RaceMultiplayer --> RoomClient : sends car state / reports
  VoiceChat --> RoomClient : sends SDP / ICE / hello
```

### Message ownership

| Message family | Handler | Stored? | Authority |
|---|---|---:|---|
| `create_room`, `join_room`, `reconnect` | Transport + state machine | Yes | Room server |
| `reserve_driver`, `set_ready`, `set_circuit` | State machine | Yes | Room server |
| `start_race`, qualifying timer, `rematch` | State machine + transport timer | Yes | Room server |
| `report_quali_time`, `report_finish` | State machine | Yes | Client value trusted by server |
| `car_state` | Direct transport relay | No | Originating browser |
| `voice_signal` | Direct transport relay | No | Browser peers |
| WebRTC audio | Never reaches server | No | Browser peers |

## Multiplayer dynamic view

```mermaid
sequenceDiagram
  participant H as Host browser
  participant S as Room server
  participant G as Guest browser
  participant R as Race runtimes

  H->>S: create_room
  H->>S: reserve_driver + set_circuit + set_ready
  G->>S: join_room + reserve_driver + set_ready
  S-->>H: room_state
  S-->>G: room_state
  H->>S: start_race
  S-->>H: phase=qualifying, serverNow
  S-->>G: phase=qualifying, serverNow
  H->>R: race.html reconnects before main.js
  G->>R: race.html reconnects before main.js
  loop Local simulation; broadcast about every 80 ms
    R->>S: car_state
    S-->>R: peers' car_state
  end
  R->>S: report_quali_time(best)
  Note over S: Server qualifying timer expires
  S-->>R: grid + phase=racing + raceStartedAt
  Note over R: Every browser simulates its own car
  R->>S: report_finish
  S-->>R: shared finish order in room_state
```

## Multiplayer authority map

```mermaid
flowchart LR
  browser["Browser authority<br/>Own car physics, input,<br/>position and progress"]:::container
  server["Server authority<br/>Membership, driver reservation,<br/>host, phase, grid and finish reports"]:::container
  peers["Peer authority<br/>Microphone stream and<br/>WebRTC media connection"]:::container
  trust["Trusted client declarations<br/>Qualifying time, car_state<br/>and finish event"]:::external

  browser -->|"Declares"| trust
  trust -->|"Relayed or recorded"| server
  server -->|"Broadcasts shared snapshot"| browser
  peers <-->|"Audio P2P"| browser

  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef external fill:#666,color:#fff,stroke:#444
```

## Multiplayer architectural consequences

- The design is lightweight and appropriate for friendly rooms of up to ten
  participants.
- It does not provide anti-cheat, server reconciliation or deterministic shared
  physics.
- Room recovery cannot survive a room-server restart because there is no durable
  store.
- Finish order is the order in which reports reach the server, not a
  server-observed finish-line crossing.
- The WebRTC full mesh grows quadratically and currently has STUN but no TURN.
- Browser Copilot and future agents must join through the same participant and
  control boundaries; they must not gain direct authority over other cars.

