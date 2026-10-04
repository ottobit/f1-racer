# F1 Racer voice — two flows, C4 levels 1 to 4

> Status (2026-10-04, #369):
> - **Flow B, the MoQ relay on `cdn.moq.dev/anon`, is current** and the only
>   transport: `core/client/multiplayer/voice-moq.js` (`MoqVoiceChat`).
> - **Flow A, the WebRTC mesh, was removed** (user's call): a fallback phone
>   could hear only other fallback phones. A browser without AudioWorklet
>   shows "Audio non disponibile". Flow A stays below as history.
> - `voice-chat.js` picks the transport behind the `VoiceChat` interface in
>   `voice-transport.js` ([oop.md](oop.md)); a new transport is one subclass.
> - Probe history: only moq.dev worked (#361); iPhone ↔ iPhone confirmed
>   after #367. iOS keeps a player's AudioContext suspended until a tap
>   after the audio arrives; racing gives one at once.

## Why two flows

- **Flow A** sends audio directly between browsers, and the only server it
  uses is STUN.
  - The room server relays signaling only; it never carries audio.
  - No TURN server is configured. When both peers sit behind mobile or
    carrier-grade NAT, ICE finds no route. The peer ends up `failed`, and the
    HUD shows the red "Audio non disponibile" icon (bug seen 2026-10-04).
- **Flow B** sends audio through a public Media over QUIC relay. Each phone
  uploads its microphone once, and the relay fans it out, like an SFU.
  - Every connection is outbound to the relay, so NAT type does not matter.
  - It also removes the N×(N-1) mesh load that heats phones at 12 drivers.
- **Fallback if flow B fails on iOS:** add TURN with anti-abuse gating on the
  room server. Credentials go only to active racers, with a short TTL and a
  daily cap. See [decisions.md](decisions.md).

## Visual legend

```mermaid
flowchart LR
  person["Person"]:::person
  system["System / container"]:::container
  component["Component / code"]:::component
  external["External dependency"]:::external
  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef component fill:#438dd5,color:#fff,stroke:#246b9e
  classDef external fill:#666,color:#fff,stroke:#444
```

---

## Flow A — WebRTC peer mesh (removed in #369)

### A · Level 1 — System context

```mermaid
flowchart TB
  drivers["Drivers in a room<br/>Up to 12 browsers, mostly phones"]:::person
  f1["F1 Racer voice<br/>Radio between drivers"]:::container
  stun["Google STUN<br/>stun.l.google.com:19302<br/>Tells each browser its public address"]:::external
  room["Room server<br/>Render, WebSocket"]:::external

  drivers -->|"Talk and listen"| f1
  f1 -->|"Asks for public IP:port"| stun
  f1 -->|"Relays signaling only (voice_signal)"| room

  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef external fill:#666,color:#fff,stroke:#444
```

### A · Level 2 — Containers

```mermaid
flowchart LR
  subgraph phoneA["Phone A — browser"]
    gameA["Race page<br/>race.html"]:::container
  end
  subgraph phoneB["Phone B — browser"]
    gameB["Race page<br/>race.html"]:::container
  end
  server["Room server<br/>core/server/room-server.mjs<br/>WebSocket"]:::container
  stun["STUN"]:::external

  gameA <-->|"WSS: car_state, voice_signal<br/>(offer / answer / ice)"| server
  gameB <-->|"WSS: car_state, voice_signal"| server
  gameA -.->|"Binding request"| stun
  gameB -.->|"Binding request"| stun
  gameA <==>|"SRTP Opus audio, direct UDP<br/>works only if NATs allow it"| gameB

  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef external fill:#666,color:#fff,stroke:#444
```

With N drivers, each phone holds N-1 `RTCPeerConnection`s. It encodes once
and sends N-1 streams. At 12 drivers that is 11 uploads and 11 downloads per
phone.

### A · Level 3 — Components

```mermaid
flowchart TB
  hud["Voice HUD<br/>race/race-hud.js<br/>icon per driver: ok / muted / error"]:::component
  voice["Voice mesh<br/>multiplayer/voice-chat.js<br/>startVoiceChat()"]:::component
  client["Room client<br/>multiplayer/room-client.js<br/>sendVoiceSignal(), onVoiceSignal"]:::component
  relay["voice_signal relay<br/>core/server/room-server.mjs<br/>forwards {to, data} unchanged"]:::component
  pc["RTCPeerConnection ×(N-1)<br/>browser built-in"]:::external

  hud -->|"getState(id)"| voice
  voice -->|"hello / offer / answer / ice / voice_state"| client
  client <-->|"WebSocket"| relay
  voice -->|"creates, one per peer"| pc

  classDef component fill:#438dd5,color:#fff,stroke:#246b9e
  classDef external fill:#666,color:#fff,stroke:#444
```

### A · Level 4 — Code and sequence

These are the key points of `voice-chat.js`:
- `ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }]`. There is no
  TURN entry.
- `isOfferer(id)` decides which side of each pair offers, so the two sides
  never collide.
- `hello` / `hello_reply` restart a stale pair after a page reload.
- Connection states `failed`, `closed` and `disconnected` are dead states.
  For those, `getState(id)` returns `status: "error"`. The HUD then shows
  "Audio non disponibile", in red (`#f78787`, `race-controls.css`).
- Without a mic the peer still joins as `recvonly`, so it can listen.

```mermaid
sequenceDiagram
  participant A as Phone A (offerer)
  participant S as Room server
  participant B as Phone B
  participant T as STUN
  A->>S: voice_signal {kind: hello}
  S->>B: voice_signal from A
  B->>S: voice_signal {kind: hello_reply}
  S->>A: voice_signal from B
  A->>A: createOffer + setLocalDescription
  A->>S: voice_signal {kind: offer, sdp}
  S->>B: offer
  B->>S: voice_signal {kind: answer, sdp}
  S->>A: answer
  A->>T: what is my public address?
  B->>T: what is my public address?
  A-->>S: ice candidates
  S-->>B: ice candidates
  B-->>S: ice candidates
  S-->>A: ice candidates
  alt NATs let UDP through
    A->>B: Opus audio, direct
    B->>A: Opus audio, direct
  else both behind mobile / CGNAT, no TURN
    Note over A,B: ICE fails → connectionState = failed<br/>HUD: red "Audio non disponibile"
  end
```

---

## Flow B — MoQ relay (current)

### B · Level 1 — System context

```mermaid
flowchart TB
  drivers["Drivers in a room<br/>Phones"]:::person
  f1["F1 Racer voice over MoQ<br/>voice-probe.html today"]:::container
  relay["Public MoQ relay<br/>cdn.moq.dev/anon (works)<br/>Cloudflare relay failed the probe<br/>No account, no billing"]:::external
  cdn["esm.sh<br/>@moq/publish 0.5.1, @moq/watch 0.6.1"]:::external

  drivers -->|"Talk and listen"| f1
  f1 -->|"Publishes and subscribes audio"| relay
  f1 -->|"Loads libraries"| cdn

  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef external fill:#666,color:#fff,stroke:#444
```

### B · Level 2 — Containers

```mermaid
flowchart LR
  subgraph phoneA["Phone A — browser"]
    pageA["Voice page<br/>voice-probe.html (role A)"]:::container
  end
  subgraph phoneB["Phone B — browser"]
    pageB["Voice page<br/>voice-probe.html (role B)"]:::container
  end
  relay["MoQ relay<br/>pub/sub fan-out"]:::external

  pageA -->|"publish f1-racer-probe/CODE/a.hang<br/>WebTransport, WebSocket fallback"| relay
  pageB -->|"publish f1-racer-probe/CODE/b.hang"| relay
  relay -->|"a.hang to subscribers"| pageB
  relay -->|"b.hang to subscribers"| pageA

  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef external fill:#666,color:#fff,stroke:#444
```

Each phone uploads once whatever the number of drivers, and downloads N-1
streams. Every connection is opened from the phone to the relay, so NAT
traversal is not needed. iOS Safari has no working WebTransport, so on iPhone
the library falls back to WebSocket. **Needs verification** on a real
iPhone.

### B · Level 3 — Components (`core/client/multiplayer/voice-probe.js`)

```mermaid
flowchart TB
  ui["Probe form<br/>relay, code, role A/B, Eco"]:::component
  support["SupportReport<br/>WebTransport, WebSocket, AudioWorklet,<br/>Opus encoder/decoder, mic"]:::component
  probe["MoqVoiceProbe<br/>start() / stop()"]:::component
  pub["Publish side<br/>Net.Connection → Broadcast<br/>Microphone → Audio.Capture → Audio.Encoder (Opus)"]:::component
  watch["Watch side<br/>own Net.Connection → Watch.Player<br/>(audio only, canvas hidden)"]:::component
  relay["MoQ relay"]:::external

  ui --> support
  ui -->|"submit toggles"| probe
  probe --> pub
  probe --> watch
  pub -->|"own connection"| relay
  watch -->|"separate connection"| relay

  classDef component fill:#438dd5,color:#fff,stroke:#246b9e
  classDef external fill:#666,color:#fff,stroke:#444
```

### B · Level 4 — Code and sequence

These are the key points of `voice-probe.js`:
- Broadcast path: `f1-racer-probe/<code>/<role>.hang`.
- The listening role is `OTHER_ROLE[role]`. With Eco on, it is the phone's
  own role, so the sound makes a full round trip through the relay.
- Libraries are preloaded at page load. The tap that starts the probe then
  reaches the mic prompt inside the user gesture, which iOS requires.
- Publish and watch use **separate** connections (`share: false`). This
  mirrors two different phones.

```mermaid
sequenceDiagram
  participant A as Phone A (role a)
  participant R as MoQ relay
  participant B as Phone B (role b)
  A->>R: connect (WebTransport or WebSocket)
  B->>R: connect
  A->>R: announce f1-racer-probe/CODE/a.hang
  B->>R: announce f1-racer-probe/CODE/b.hang
  A->>R: subscribe .../b.hang
  B->>R: subscribe .../a.hang
  Note over A: encoder active only once someone listens
  loop every Opus frame
    A->>R: audio group (a.hang)
    R->>B: forward
    B->>R: audio group (b.hang)
    R->>A: forward
  end
```

### Step 2 if the probe passes (planned, not built)

These pieces do not exist yet:
- `voice-chat.js` would publish `f1-racer/<roomCode>/<participantId>.hang`,
  and subscribe to each other participant listed in `room_state`.
- The same `getState(id)` contract would feed the HUD unchanged.
- WebRTC would stay as a fallback. Following [oop.md](oop.md), the two
  transports would be two subclasses behind one voice interface.
- `voice_signal` would carry only `voice_state` (mute, has mic). The room
  server would still never carry audio.

## Comparison

| | Flow A — WebRTC mesh | Flow B — MoQ relay |
|---|---|---|
| Audio path | Phone ↔ phone direct | Phone → relay → phones |
| Uploads per phone at 12 drivers | 11 | 1 |
| Mobile / CGNAT | Fails without TURN | Works (outbound only) |
| Server we run | Room server (signaling) | None for audio |
| Cost / account | Free (STUN) | Public relay, no account; no SLA |
| Phone test | Fails across mobile NAT | Works on moq.dev only (2026-10-04) |
| Latency | Lowest when it connects | One relay hop more |
| Privacy | Encrypted end to end (DTLS-SRTP) | TLS to the relay; relay sees the audio |

## Code map

| Concern | File |
|---|---|
| Transport choice | `core/client/multiplayer/voice-chat.js` |
| Interface + speaking meter | `core/client/multiplayer/voice-transport.js` |
| MoQ transport (default) | `core/client/multiplayer/voice-moq.js` |
| Signaling client | `core/client/multiplayer/room-client.js` (`sendVoiceSignal`) |
| Signaling relay | `core/server/room-server.mjs` (`case "voice_signal"`) |
| Voice HUD icon | `core/client/race/race-hud.js`, `race-controls.css` |
| MoQ probe | `voice-probe.html`, `core/client/multiplayer/voice-probe.js` |

Related pages: [c4-multiplayer.md](c4-multiplayer.md),
[c4-model.md](c4-model.md), [decisions.md](decisions.md).
