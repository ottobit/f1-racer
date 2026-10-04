---
type: entity
updated: 2026-10-04
sources: []
---

# Multiplayer protocol and room server

C4 views:
- [c4-multiplayer.md](../synthesis/c4-multiplayer.md): rooms and the race;
- [c4-voice.md](../comparisons/c4-voice.md): voice;
- [c4-mcp.md](../synthesis/c4-mcp.md): the agent relay.

Design choices (client-authoritative, no AI padding, no solo championship)
are in [decisions.md](../synthesis/decisions.md). Solo play never opens a socket:
`race/main.js`'s `multiplayer` is `null`.

## Room state machine (`core/server/rooms.mjs`)

- **Pure functions.** Each takes a `store` plus plain data and returns plain
  data, with no sockets and no database:
  - `createRoom`, `joinRoom`, `reconnectParticipant`;
  - `reserveDriver` / `releaseDriver`, `setReady`;
  - `setCircuit` (circuit, difficulty, `qualifying` true/false);
  - `startRace`, `finishQualifying`, `reportQualiTime`;
  - `reportFinish`, `rematch`, `leaveRoom`, `markDisconnected`;
  - `toPublicRoom`.
- **Memory only.** State lives in memory and resets when the process
  restarts. This is deliberate for casual rooms.
- **Driver ids.** The reservable ids are the 12 `rival-*` entries of
  `core/shared/driver-roster.js` (`MAX_PARTICIPANTS`). The solo pseudo-id
  `"player"` is never valid. Solo and room identities use separate storage
  keys.
- **Phases:** `lobby` → `qualifying` → `racing`.
  - **`startRace`** is host-only. It needs a circuit, a chosen format, and
    every participant reserved and ready.
  - **Race only** (`qualifying: false`, #107): the grid is shuffled and
    racing starts at once.
  - **With qualifying:** the server's own timer (`ROOM_QUALI_MS`, default
    `QUALIFYING_DURATION_MS` = 60 s) calls `finishQualifying()`. The grid
    is fastest first, and drivers with no time go to the back.
  - **`reportFinish`** (#113): the first report wins, so the shared result
    is the order in which finishes reached the server.
  - **`rematch`** (#113): host-only. It goes back to the lobby, keeping
    drivers and circuit and resetting ready, times and finishes.
- **Disconnect grace.** A closed socket starts a grace timer
  (`ROOM_GRACE_MS`, default 30 s).
  - A reconnect within it reclaims the slot.
  - When it expires, the participant is removed. If they were host, the
    longest-connected participant is promoted.
  - Clients grey out a disconnected driver (nameplate, timing tower).
  - An empty room is deleted and its 4-character code freed.

## Transport (`core/server/room-server.mjs`)

- **Envelopes.** Messages are JSON `{type, reqId, ...}`. Every request gets
  a `reqId`-correlated reply or `error{code,message}`.
- **Room state.** Every change broadcasts a full `room_state` to the room.
- **Message types:**
  - **Room:** `create_room`, `join_room`, `reconnect`, `reserve_driver`,
    `release_driver`, `set_ready`, `set_circuit` (host),
    `start_race` (host), `rematch` (host), `leave_room`.
  - **Session:** `report_quali_time`, `report_finish`.
  - **Relayed, never stored:**
    - `car_state`: ~12/s per client;
    - `voice_signal`: forwarded `{to, data}` unchanged.
  - **Agent relay:** `agent_bridge_register`, `agent_attach`, `agent_call`,
    `agent_result` ([c4-mcp.md](../synthesis/c4-mcp.md)).
  - **Heartbeat:** `ping` / `pong`.
- **Running it:**
  - locally: `npm run start:room-server` from `core/`, with `PORT`,
    `ROOM_GRACE_MS` and `ROOM_QUALI_MS` optional;
  - hosted: on Render (`service/README.md`);
  - the free plan sleeps after 15 idle minutes and takes ~1 minute to wake.

## Browser side (`core/client/multiplayer/`)

- **`room-server.js` (#333): which server a page uses.**
  - The public site uses `HOSTED_ROOM_SERVER` (`wss://f1-racer-rooms.onrender.com`).
  - A page served from localhost uses `ws://localhost:8787`.
  - `?roomServer=` overrides both. It accepts `https://`, `http://` or a
    bare host.
  - `wakeRoomServer()` pings `/health` as soon as the page opens.
- **`room-client.js`: the protocol client.**
  - It uses `reqId` promises.
  - It saves the session (`roomCode`, `participantId`, `reconnectToken`)
    under `f1racer-room-session-v1`.
  - `tryResume()` does nothing when no session is saved.
- **`room.html` / `room.js`: the lobby.**
  - Nickname, create or join, and the participant list (driver, ready,
    host crown, "riconnessione…").
  - A driver grid with taken slots disabled.
  - Host-only pickers for circuit, difficulty and format, plus "Avvia".
  - When the race starts, every tab goes to
    `race.html?circuit=…&difficulty=…&room=…`.
- **`race-bootstrap.js`: `race.html`'s real entry point.**
  - With `?room=`, it awaits the WebSocket reconnect first.
  - It hands over the client through the one-shot `window.__mpClient`.
  - Only then does it `import()` `main.js`, which stays synchronous.
- **`race-multiplayer.js`: what `main.js` calls.** `setupMultiplayer()`
  returns:
  - `getRemoteDrivers()`, `getRemoteSample(id)`;
  - `broadcastState()`, throttled to ~12/s;
  - `reportQualiTime()`, `onGridReady(cb)`, `isDriverDisconnected(id)`.

## Inside the race (`race/main.js`)

- **Rivals.** The rivals are the other participants, with no AI padding.
- **Remote cars.** Each one is an `aiCars` entry with `isRemote` and
  `participantId`. `updateRemoteCar()` smoothly pulls it towards the latest
  `car_state` sample. After that, the shared code handles it like any other
  car: progress, order, DRS, collisions, HUD and nameplates.
- **Qualifying.** It runs locally as in solo play. Each better lap is
  reported to the room, and only `onGridReady()` moves the session to the
  race.
- **Lights.** The hold of the start lights is seeded from `raceStartedAt`
  ([audio.md](audio.md#start-procedure)).
- **Championship.** `finishRace()` skips the solo championship.

## Security

Threat model: a hobby game among friends on a public server; no accounts,
no personal data beyond nicknames (decided with the user, #371, instead of
OTP logins that need SMS/email and risk billing).

- Room codes: 6 chars from a 31-symbol alphabet (~887M), `crypto.randomInt`.
  Reconnect tokens (`randomBytes`) and participant ids also come from
  `node:crypto`.
- Brute force: `core/server/join-limiter.mjs` (`JoinLimiter`) refuses
  `join_room` / `reconnect` with `too_many_attempts` after 10 wrong codes or
  tokens per address per minute, plus a global ceiling of 200 per minute
  because `X-Forwarded-For` can be forged. In memory, resets on restart.
- Voice: each room has a `voiceKey` (`crypto.randomUUID`) in the room
  snapshot, sent only to members; the MoQ path is
  `f1-racer/<voiceKey>/<participantId>.hang` ([c4-voice.md](../comparisons/c4-voice.md)).
  Limit: the public relay itself still sees the audio.

## Verification status

- **Verified:**
  - two headless browser contexts against the real server, from room
    creation through the qualifying-to-race switch, live order and the
    disconnect grey-out;
  - a real phone and a PC on separate networks through a tunnel (Stage 1,
    2026-09-23).
- **Not verified:**
  - a full race to the flag driven by a script;
  - a contact between a local car and a remote car, watched by eye.
