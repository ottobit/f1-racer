# F1 Racer Architecture

## Runtime

`race.html` loads the race experience directly in the browser.
There is no bundler requirement.

**#46 restructure:** all JS/CSS source (client, server, tools) now lives
under `core/`, in a standard `client/`/`server/`/`tools/` split — see
"Source layout (#46)" near the end of this file for the full map and why.
Every path below is given relative to `core/client/` unless noted
otherwise.

The current race runtime is coordinated by `race/main.js`, with focused
helpers (all under `race/` unless noted):

- `race-input.js`: keyboard, touch pedals and analog steering input.
- `race-input.js` also owns opt-in device-orientation steering, permission,
  screen-axis projection, calibration and stale-data fallback. Rotation and
  backgrounding require explicit reactivation; pedals remain independent.
  Motion uses atan2 of screen-plane gravity to avoid pitch-dependent gain,
  averages a stable 500 ms neutral pose and wraps angle differences. Near-flat
  poses neutralize steering and request a lifted screen. A small direction meter
  displays the final smoothed command shared with the wheel and vehicle.
- `steering.js`: pure steering shaping and smoothing math.
- `player-physics.js`: player movement integration and grip behavior.
- `race-ai.js`: AI car controller and tactical movement.
- `race-hud.js`: HUD rendering and status formatting.
- `race-camera.js`: chase/cockpit camera behavior.
- `race-progress.js`: lap counting and race classification.
- `race-systems.js`: race systems such as DRS, tyres, damage and caution.
- `race-collisions.js`: bilateral car contact impulse, separation and damage.
- `race-nameplates.js`: screen-space labels projected from visible AI cars.
- `race-car-view.js`: visual race car mounting and updates.
- `race-commands.js`: command bindings and race UI actions.
- `agent-api.js` (#8/#9): `window._ENVIRONMENT_` (`getState`/`step`/`release`)
  for an external agent to drive the player car without simulating touch or
  keyboard events. Opt-in only via `?agent=1` in `main.js` — never imported
  in a normal session. `step()` drives the same `input.forward`/`input.back`
  booleans and `setExternalSteer()` (a `race-input.js` addition) the human
  player uses, neutralizes them when the step's duration elapses, and
  rejects a second concurrent `step()`. `race-input.js`'s real DOM handlers
  call an `onHumanInput` callback synchronously on any real touch/key/wheel
  input, which hands control back immediately even mid-step. `getState()`
  returns a compact, freshly-built snapshot (mutating it cannot affect
  internal state): session phase, speed, lap/position/progress, lateral
  offset and heading error from the ideal line, next-corner heuristic
  (direction/distance/curvature over a lookahead window shared with the AI's
  own centerline sampling), up to 5 nearby cars, damage/tyres/DRS, and the
  final result once the race is over.
- `race-audio.js`: gear mapping, synthesized engine/shift-click Web Audio and
  an ambient AI "grid chorus", gated by a `getEngineActive` getter (true in
  both racing and an in-progress qualifying lap, not race-only) rather than
  a shared module variable (#10).
- `race-weather.js`: sky cloud billboards, rain particle field and impact
  spark FX, gated by a `getPlayerState` getter for the same reason.
- `../shared/track-geometry.js`: pure centerline sampling/query rules,
  framework-agnostic (takes a curve object rather than importing three.js),
  shared between `race/main.js` and `tools/validate-circuits.mjs` (#6) — the
  reason it lives in `shared/`, not `race/`. Also `offsetEdge()` (#28):
  miter-cut offset edges used by the road mesh and by `track-art.js`'s
  kerbs/runoff/lines, so tight apexes never fold.
- `track-art.js`: circuit dressing. `dressCircuit(..., detail)` places
  scenery on the coarse gameplay centerline but meshes road-hugging strips
  from the denser render-only `visualCenterline` (#28).
- `../shared/graphics-profiles.js`: automatic, persisted, device-signal-based
  rendering-cost profile (DPR/shadows/particle counts only — never physics
  or race visibility). No new UI (#2). Lives in `shared/` because both
  `race/main.js` and `garage/garage.js` read it.
- `race-diagnostics.js`: dev-only FPS/`renderer.info` overlay, a no-op
  unless explicitly enabled (#2). Also used by `garage/garage.js` — see
  Garage section.

## Shared Car Model

`shared/car-model.js` builds the procedural open-wheel car used by both race
and garage. It keeps gameplay scale separate from visual scale and exposes
wheel groups so steering and rolling can be animated.

`shared/driver-roster.js` owns the canonical ten identities.
`shared/driver-themes.js` owns shared livery and cockpit theme data.
`car-model.js` tags paint materials by role, so race and garage can apply
the same primary and secondary colors without rebuilding separate car
definitions. The same livery records carry fictional team sponsor pairs;
cached canvas textures place small wordmarks on sidepods, nose and rear
wing in both race and Garage models.

`race/race-progress.js` counts a lap at the painted finish-line offset
rather than at the spline origin and locks finish positions as cars
complete the configured distance. AI automatic pit service is intentionally
disabled while there is no visible pit lane; player-requested service
remains available.

Race cars include a lightweight seated driver built from the shared
procedural model. The suit material carries the primary livery role;
helmet accents carry the secondary color. A dynamic race steering-wheel
group owns both gloves and rotates from the same input used for the front
wheels. The detailed Garage path keeps `showDriver: false`.

## Garage

`garage.html` (root), `garage/garage.js`, `garage/showroom.js`,
`garage/garage.css` and `shared/garage-setup.js` implement the setup bay.
(`garage-setup.js` lives in `shared/`, not `garage/`, because `race/main.js`
reads it too — see Source layout below.) Setup data is persisted under
`f1racer-garage-v1` and read by race startup.

The garage previews setup families visually. The player car's livery comes
from the selected driver's team (`playerLivery()` in `garage-setup.js`), in
both the Garage and the race, matching how AI cars get theirs.

`showroom.js`'s `createShowroom` takes an optional `graphicsProfile`
(`garage.js` passes `loadGraphicsProfile()`, #2) applied to its own
renderer's DPR cap and shadow map — the same profile the race applies to
its own renderer, so a device set to "basso" gets that treatment in both
places, not just the race. Falls back to its own old viewport-width check
if no profile is passed. It also takes an optional `onFrame(dt)` from its
`setAnimationLoop`, which `garage.js` uses to drive the same
`../race/race-diagnostics.js` overlay the race uses (`?diag=1`, off by
default) — a cross-folder import, `garage/` reaching into `race/`, because
this overlay is genuinely race-owned tooling reused by garage, not shared
data.

`shared/circuits.js` also owns each track's recommended five-component
setup and its rationale. `home/menu.js` persists the active carousel
circuit; `garage.js` reads it, renders current-to-recommended differences
and applies the preset only after an explicit user action.

The detailed showroom car is built with `showDriver: false`. Its exposed
cockpit interior includes a seat, headrest, harness, bolsters, dashboard,
display and steering wheel; the lightweight race cars still include a driver.

## Multiplayer Stage 1 (rooms)

`server/rooms.mjs` (pure state machine, no sockets) and
`server/room-server.mjs` (thin `ws`-based WebSocket transport around it,
both under `core/server/`) are this project's first backend, ever (#36,
part of #1) — a new, separate opt-in Node process (`npm run
start:room-server`, run from inside `core/`), not something the shipped
static site loads. State is in-memory only, resets on restart; deliberate
for Stage 1's casual rooms, not a database stand-in. Reservable driver ids
are exactly `shared/driver-roster.js`'s ten `rival-*` entries;
`shared/driver-selection.js`'s client-only `"player"` id is never valid
here — solo and room identity never touch each other's `localStorage` key.

`multiplayer/room-client.js` (browser) and `room.html` (root)/
`multiplayer/room.js` (lobby UI) are the only client-side additions;
race/garage/qualifying are entirely untouched *when no room is involved*
(see Stage 2 below for how a room actually reaches the race itself now).
See `F1-RACER-WIKI.md`'s "Multiplayer" section for the message protocol,
grace/reconnect/host-handoff rules, and what was and wasn't verified
without a live public deployment.

Voice is a separate future issue with its own protocol/infra decisions —
not designed here.

## Multiplayer Stage 2 (qualifying and race sync)

`server/rooms.mjs` gained `sessionPhase` ("lobby" → "qualifying" →
"racing"), `circuitId`/`difficulty` (host-chosen, see `setCircuit()`),
per-participant `qualiBestTime`, and `grid` (set once by
`finishQualifying()`, called by `room-server.mjs`'s own `setTimeout` —
`ROOM_QUALI_MS`, defaults to 60s — not by any client, so every
participant's browser transitions off the same clock). `room-server.mjs`
also relays a new ephemeral, unstored message, `car_state`, straight to a
room's other sockets — the client-authoritative position broadcast this
stage is built on (see decisions.md).

Two files under `multiplayer/` bridge a room into an actual race:
- `race-bootstrap.js`: `race.html`'s real entry point now (not
  `race/main.js` directly). If `?room=CODE` is present and a saved room
  session exists, it resolves the WebSocket reconnect *before* `main.js`
  loads — `main.js`'s own top-level code is entirely synchronous (builds
  the whole scene top-to-bottom in one pass) and was never made async;
  this bootstrap is what keeps that true while still needing an async
  reconnect first. Hands the already-connected client to `main.js` via a
  one-shot `window.__mpClient`.
- `race-multiplayer.js`: `setupMultiplayer()` wraps that already-connected
  client into the small synchronous API `main.js` actually calls
  (`getRemoteDrivers()`, `getRemoteSample()`, `broadcastState()`,
  `reportQualiTime()`, `onGridReady()`, `isDriverDisconnected()`). Returns
  `null` for solo play (no `?room=`, or an unresumable session) — every
  integration point in `main.js` is an explicit `if (multiplayer)` branch
  on this one value, never a silently-shared code path. Lives in
  `multiplayer/` (grouped with `room-client.js`) even though only
  `race/main.js` imports it — a conceptual grouping choice, see #46's
  Source layout section.

Inside `race/main.js`: multiplayer's `AI_DRIVERS` come from the room's
other participants' reserved driver ids instead of `DRIVER_ROSTER`-minus-
self — no AI padding (see decisions.md). Each resulting `aiCars` entry is
tagged `isRemote: true` and `participantId`, and driven every frame by
`updateRemoteCar()` (pulls toward the latest `car_state` sample, smoothed,
then calls the same `advanceProgress()` everyone else's lap/position
bookkeeping uses) instead of `updateAiCar()`'s real steering AI — everything
downstream (`currentRaceOrder`, `applyGridPositions`, DRS eligibility, car
collisions, the HUD/nameplate rendering) already worked generically over
`aiCars` and needed no changes to accept remote-driven entries. Qualifying
itself runs locally exactly like solo (own flying laps, own best time
tracked, own lap-completion detection) but reports each improved time to
the room (`reportQualiTime`) instead of only using it locally, and never
self-triggers the qualifying-to-racing transition — that only ever happens
from `multiplayer.onGridReady()`, fired once when the server's own timer
broadcasts the real grid. `finishRace()` skips the solo championship
entirely for a multiplayer session (see decisions.md).

## Championship and Drivers

`shared/championship.js` owns championship state and scoring.
`shared/driver-selection.js` maps the selected identity to the player
display name. Race startup removes that identity from `DRIVER_ROSTER` and
creates the nine AI cars from the remainder, guaranteeing ten unique names
on the grid.

`race/race-camera.js` builds a lightweight cockpit overlay from the
selected driver's theme when cockpit camera mode is active.

## Circuit Selection

`home/menu.js` renders a single active circuit at a time using an inline
map derived from the same control points consumed by the race.
`index.html` (root) and `client/style.css` provide the swipeable carousel
viewport, arrow controls, keyboard navigation, large launch target and
mobile layout.

`shared/circuits.js` includes the real-route-inspired Marzamemi dogbone as
the sixth round. Its `theme: "marzamemi"` switches `race/track-art.js` from
generic autodrome dressing to an instanced coastal streetscape based on the
supplied map and street video; the geometry remains procedural and
static-site friendly.

## Source layout (#46)

All JS/CSS source lives under `core/`, split into a standard
`client/`/`server/`/`tools/` layout — a deliberate restructure requested by
the user after the flat repo root grew to 37 files, not an incident to
"simplify" back to flat later:

```
core/
  package.json, package-lock.json, node_modules/   (three.js pinned for
                                                      tools/, ws for server/
                                                      — see package.json's
                                                      own description)
  client/
    style.css                                       (shared by all 4 pages)
    race/         main.js and everything only race.html's runtime uses
    garage/       garage.js, showroom.js, garage.css
    multiplayer/  room.js, room-client.js, race-bootstrap.js,
                  race-multiplayer.js (client-side multiplayer only —
                  server/ is the backend, kept separate)
    shared/       anything used by 2+ of race/garage/home/tools:
                  car-model.js, circuits.js, driver-roster.js,
                  driver-selection.js, driver-themes.js, championship.js,
                  graphics-profiles.js, track-geometry.js, garage-setup.js
                  (garage-setup.js is here, not garage/, because
                  race/main.js reads it too, for the player's setup effects)
    home/         menu.js
  server/         rooms.mjs, room-server.mjs
  tools/          validate-circuits.mjs
```

The 4 HTML entry points (`index.html`, `race.html`, `garage.html`,
`room.html`) and `assets/` **stay at the repo root** — GitHub Pages in this
repo serves the branch root as-is (no GitHub Action build step), and does
not support serving from an arbitrary subfolder like `/core`; moving the
HTML would break the live site without a Pages reconfiguration the user
would have to do manually. `llm-wiki/` and the project's own top-level docs
(`F1-RACER-WIKI.md`, `RELEASE-CHECKLIST.md`) also stay at the root — they
are documentation, not source.

`npm run validate:circuits` and `npm run start:room-server` must be run
from inside `core/` (or with `npm --prefix core run <script>`) now that
`package.json` lives there — it moved there, not to `server/` alone,
because `three` (pinned for `tools/validate-circuits.mjs`) and `ws`
(for `server/room-server.mjs`) are two distinct consumers of the same
`package.json`, confirmed by re-reading its own `devDependencies` before
deciding; putting it inside `server/` alone would have broken `tools/`'s
access to `node_modules`.

Every cross-folder import in the moved files keeps its own `?vNN` cache-
busting query string unchanged from before the move — the move itself
isn't a functional change. Note (pre-existing, not fixed by #46): not every
import carries a version query even today — some do, some don't — so this
isn't a fully consistent cache-busting scheme; out of #46's scope.

## Constraints

- Keep the game static-site friendly. **Update (#36):** the shipped race/
  garage/menu pages themselves still have zero build step and no server
  dependency; the multiplayer room server is a genuinely new, separate,
  opt-in backend, not an exception to this constraint for the game itself.
- Avoid adding a build system unless a future feature clearly requires it.
- Keep structural checks cheap by default.
- Do not alter the top HUD panel without a specific user request.
