# Multiplayer protocol and room server

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

## Multiplayer: rooms, driver reservation, qualifying and race sync (`server/`, `core/client/multiplayer/room-client.js`, `room.html`, `core/client/multiplayer/race-bootstrap.js`, `core/client/multiplayer/race-multiplayer.js`)

Two of #1's staged deliveries so far. Stage 1 (#36): rooms and driver
reservation. Stage 2 (#44): a real, synced qualifying session and race —
what Stage 1 deliberately stopped short of. Voice is still a separate
future issue with its own protocol/infrastructure decisions. This is the
**first backend this project has ever had**; everything else in this
codebase is still a zero-build static site, and solo race/garage/qualifying
stay entirely local-only regardless of whether the room server is
reachable — see `core/client/race/main.js`'s `multiplayer` variable (`null` for solo).

`core/server/rooms.mjs` is a pure room/participant state machine — plain JS
`Map`s in memory, no sockets, no database, no framework. State resets on
process restart; that's a deliberate Stage 1 limitation (casual, short-lived
rooms among friends), not an oversight to fix later without saying so.
Every function takes a `store` plus plain data and returns plain data, so
it's directly unit-testable (`createStore`, `createRoom`, `joinRoom`,
`reconnectParticipant`, `reserveDriver`/`releaseDriver`, `setReady`,
`startRace`, `leaveRoom`, `markDisconnected`, `toPublicRoom`). Reservable
driver ids are exactly `core/shared/driver-roster.js`'s ten `rival-*` entries — the
client-only `"player"` pseudo-id `core/client/shared/driver-selection.js` uses for solo play is
never a valid room driverId; solo and room identity are deliberately
independent, neither reads nor writes the other's `localStorage` key.

`core/server/room-server.mjs` is a thin WebSocket transport (`ws` package) around
`core/server/rooms.mjs`: parses JSON envelopes (`{type, reqId, ...}`), calls straight
into the pure state machine, sends a direct `reqId`-correlated response or
`error{code,message}`, and broadcasts a full `room_state` snapshot to every
socket bound to that room on any change. Message types: `create_room`,
`join_room`, `reconnect` (needs the saved `{roomCode, participantId,
reconnectToken}`), `reserve_driver`/`release_driver`, `set_ready`,
`set_circuit` (**host-only**, Stage 2), `start_race` (**host-only**; Stage 2
requires a chosen circuit and every participant driver-reserved + ready,
and now genuinely begins a timed qualifying session — see below — not just
a bare confirmation), `report_quali_time` (Stage 2, keeps only a
participant's best), `car_state` (Stage 2, ephemeral — relayed straight to
the room's other sockets, never stored in `core/server/rooms.mjs`), `leave_room`
(immediate slot release), `ping`/`pong` (heartbeat). A closed socket doesn't
release its slot immediately: `markDisconnected` starts a grace timer
(`ROOM_GRACE_MS`, default 30s) during which the participant's `driverId` is
retained; a `reconnect` within that window cancels the timer and reclaims
the slot, while an expiry deletes the participant outright (freeing their
driver) and, if they were host, promotes the longest-connected remaining
participant so a room is never stuck without start authority — and, during
a race, is what a client-side "disconnected" grey-out (nameplate, timing
tower) is keyed off, unchanged from Stage 1. An emptied room is deleted and
its 4-character code freed for reuse. Qualifying itself is timed by this
transport layer's own `setTimeout` (`ROOM_QUALI_MS`, defaults to matching
solo's 60s) — see `finishQualifying()` below — so every client transitions
to racing off one server clock, not whichever browser's local countdown
happens to reach zero first. Run locally with `npm run start:room-server`
(`PORT`, `ROOM_GRACE_MS`, `ROOM_QUALI_MS` env vars optional) — opt-in,
separate Node process, never imported by `race.html`/`garage.html`/
`index.html`.

`core/client/multiplayer/room-client.js` is the browser-side protocol client — plain WebSocket,
`reqId`-correlated promises, a `roomCode/participantId/reconnectToken`
session persisted under its own `f1racer-room-session-v1` localStorage key
(never touching `f1racer-selected-driver-v1` or championship state), and a
`tryResume()` that silently no-ops if nothing was saved, so a first-time
visitor never opens a socket before choosing to create or join. The server
URL comes from `?roomServer=` (default `ws://localhost:8787` — a
placeholder until Stage 1 is actually deployed somewhere reachable),
mirroring the existing `?agent=1`/`?diag=1`/`?gfx=` query-param convention.

`room.html`/`core/client/multiplayer/room.js` is the lobby page: nickname, create/join, a live
participant list (name, reserved driver, ready state, host crown, a
"riconnessione…" tag during another participant's grace period), a driver
grid modeled on `core/client/home/menu.js`'s `renderDriverSelect()` (taken slots disabled and
labeled, a livery colour dot per driver via `core/client/shared/driver-themes.js`'s
`liveryById`), a ready toggle, a host-only circuit/difficulty picker (Stage
2 — plain `<select>`s, not the home's carousel), and a host-only "Avvia"
button (disabled until a circuit is chosen and everyone is ready) that now
navigates every participant's tab to `race.html?circuit=...&difficulty=...
&room=...` once qualifying actually begins. `index.html` promotes it to one
of the two dominant `home-command` cards ("Corri in multiplayer", #40) —
see `decisions.md`'s "Home and Circuit Selection" section for that history.

**Stage 2's bridge into the actual race** — `core/client/multiplayer/race-bootstrap.js` and
`core/client/multiplayer/race-multiplayer.js`, both new:
- `core/client/multiplayer/race-bootstrap.js` is `race.html`'s real script entry point now (not
  `core/client/race/main.js` directly). `core/client/race/main.js`'s own top-level code is entirely
  synchronous — it builds the whole Three.js scene top-to-bottom in one
  pass — and was never rewritten to be async. So if `?room=CODE` is present
  and a saved room session exists, this bootstrap `await`s the WebSocket
  reconnect *first*, hands the already-connected client to `core/client/race/main.js` via a
  one-shot `window.__mpClient`, and only then dynamically `import()`s
  `core/client/race/main.js`. Solo play (no `?room=`) skips straight to importing it.
- `core/client/multiplayer/race-multiplayer.js`'s `setupMultiplayer()` wraps that already-connected
  client into the small synchronous API `core/client/race/main.js` actually calls:
  `getRemoteDrivers()`, `getRemoteSample(participantId)`,
  `broadcastState(data)` (throttled to ~12/s internally),
  `reportQualiTime(ms)`, `onGridReady(cb)`, `isDriverDisconnected(driverId)`.
  Returns `null` for solo play or an unresumable session — mirrors
  `core/client/race/agent-api.js`'s `?agent=1` opt-in shape.

Inside `core/client/race/main.js`, every multiplayer touchpoint is an explicit branch on one
`multiplayer` variable (`null` for solo): `AI_DRIVERS` comes from the room's
other participants instead of `DRIVER_ROSTER`-minus-self (no AI padding —
see decisions.md); each resulting `aiCars` entry is tagged `isRemote`/
`participantId` and updated every frame by `updateRemoteCar()` (pulls
smoothly toward the latest `car_state` sample, then calls the same
`advanceProgress()` everyone else's lap/position bookkeeping already used)
instead of `updateAiCar()`'s steering AI. `currentRaceOrder`,
`applyGridPositions`, DRS eligibility, car collisions, the HUD position/
timing tower and the nameplates all already worked generically over
`aiCars` and needed no structural changes — `core/client/race/race-hud.js` and
`core/client/race/race-nameplates.js` only gained an optional `isDisconnected` check for the
grey-out treatment, and `core/client/race/race-hud.js` gained a `getQualifyingRivals` getter
alongside its old static `qualifyingRivals` array, since multiplayer's live
participant times change over the session where solo's synthesized AI times
don't. Qualifying itself still runs locally exactly like solo (own flying
laps, own best time, own lap-completion detection) but reports each
improved time to the room instead of only keeping it locally, and never
self-triggers the qualifying-to-racing transition — that only ever fires
from `multiplayer.onGridReady()`, once, when the server's own timer
broadcasts the real grid. `finishRace()` skips the solo championship
entirely for a multiplayer session — see decisions.md for why.

Verified with a real WebSocket server and real headless-browser clients
(Playwright, two separate browser contexts against the actual
`core/server/room-server.mjs` process, `three.js` served from the local `node_modules`
copy since this sandbox's network policy blocks the CDN it normally loads
from): room creation/join, live broadcast of a driver reservation, a taken
driver rejected with a clear error, "Avvia" staying disabled until a
circuit is chosen and everyone is ready, both participants navigating to
`race.html` with matching circuit/difficulty/room params, the
server-timed qualifying-to-racing transition actually firing, a real
computed grid, the race position/timing tower showing genuine live
classification for both cars, the remote participant's nameplate visible
and moving, and — after closing one browser context mid-race — the
remaining client's nameplate and timing-tower row for that participant
turning grey once the existing grace window expired. A separate real-
browser run confirmed solo play (no `?room=`) is completely unaffected: no
page errors, the qualifying HUD/tower/synthesized-AI list all render, and
acceleration responds normally. `core/server/rooms.mjs`'s pure functions are
additionally covered by direct unit checks (`setCircuit` host/validation
gating, `startRace`'s new "everyone driver-reserved and ready" requirement,
`reportQualiTime` keeping only the best, `finishQualifying`'s DNF-to-the-
back grid ordering, idempotency once already racing) — 12/12 passing,
alongside Stage 1's original 20/20.

**What this still hasn't verified, and isn't hiding**: no test here actually
drove a multiplayer race to its final lap (would need sustained scripted
driving matching each circuit's line, not just holding the accelerator) —
the transition and live sync are verified, the finish line isn't. Real
phones/separate networks were verified for Stage 1's rooms (see below) but
not re-verified for Stage 2's qualifying/race sync specifically — this
round reused the same sandbox two-browser-context method. Collision
behavior between the local car and a network-driven remote car hasn't been
watched by eye (expected to be a harmless one-frame jitter, corrected by
the next network sample — see `architecture.md`).

**What Stage 1's rooms verified live, beyond this sandbox**: on
2026-09-23 the user connected a real phone and a real PC, on separate
networks, to the same room through the room server tunneled with `ngrok
http` (not Render itself yet, but the same `wss://` path a real deployment
uses) — real cross-device reachability, not just two browser contexts on
one machine. See `roadmap.md` for the hosting decision (Render, chosen by
the user) that stays open until this goes properly live.
