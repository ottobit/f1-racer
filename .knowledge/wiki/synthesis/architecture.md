---
type: synthesis
updated: 2026-10-04
sources: []
---

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
- Motion steering, touch and camera details: [hud-camera-mobile.md](../entities/hud-camera-mobile.md).
- `steering.js`: pure steering shaping and smoothing math.
- `player-physics.js`: player movement integration and grip behavior.
- `race-ai.js`, `rival-ai.js`: AI controller and rival parameters — see
  [race-systems.md](../entities/race-systems.md).
- `race-rules.js`: tyre grip, track boundary and runoff drag.
- `race-hud.js`: HUD rendering and status formatting.
- `race-camera.js`: chase/cockpit camera behavior.
- `race-progress.js`: lap counting and race classification.
- `race-systems.js`: race systems such as DRS, tyres, damage and caution.
- `race-collisions.js`: bilateral car contact impulse, separation and damage.
- `race-nameplates.js`: screen-space labels projected from visible AI cars.
- `race-car-view.js`: visual race car mounting and updates.
- `race-commands.js`: command bindings and race UI actions.
- `agent-api.js` (#8/#9): `window._ENVIRONMENT_`, opt-in via `?agent=1` —
  see [agent-api.md](../entities/agent-api.md).
- `race-audio.js`: synthesized engines and start procedure — see
  [audio.md](../entities/audio.md).
- `race-weather.js`: sky cloud billboards, rain particle field and impact
  spark FX; takes a `getPlayerState` getter because it is wired before the
  player state exists.
- `../shared/track-geometry.js` and `track-art.js`: see [tracks.md](../entities/tracks.md).
- `../shared/graphics-profiles.js`, `race-diagnostics.js`: see
  [performance.md](../concepts/performance.md).

## Shared Car Model

Car construction, liveries and drivers: [car-rendering.md](../entities/car-rendering.md).
Lap counting: [tracks.md](../entities/tracks.md).

`shared/pit-lane.js` assigns six service bays in canonical `TEAM_LIVERIES`
order along the flat lane section. `buildPitLane(..., teamId)` selects the
same stopping distance for both team drivers, browser and headless bots.
Around the box, `pitLanePose` shifts the car `PIT_LANE.bay` sideways onto a
working apron in front of its garage (#258), so the lane stays free for
cars driving through; garages stand `PIT_LANE.apron` behind the lane edge.
`track-art.js` labels the six garages; `pit-crew.js` animates the local
player's ten mechanics at their team's bay. They sit on stools watching the
race, stand up and carry the fresh set out when the box is requested, and
sit down again after the stop; other teams' crews stay seated. Four removers take the used
wheels away, four fitters install a separate set, and two mechanics lift
the car. Wheel geometry is reused across stops; the newly mounted objects
replace `playerCar.wheels` so rolling and steering keep working. Red,
yellow and white sidewalls follow the selected compound; the removed set
keeps its original colour. No multiplayer protocol or shared-box queue is
introduced: remote crew animation and simultaneous teammate service are
outside this visual cycle (#250). Visual checks remain manual.

## Garage

See [garage.md](../entities/garage.md).

## Multiplayer

Rooms, protocol, race bridge: [multiplayer-protocol.md](../entities/multiplayer-protocol.md).
Voice: [c4-voice.md](../comparisons/c4-voice.md).

## Championship and Drivers

`shared/championship.js` owns championship state and scoring: a
`Championship` class (storage key, roster, player id; `record()`, `reset()`,
`standings()`, `nextUnraced()`, `inProgress()`), one instance per series in
`CHAMPIONSHIPS` (#345). Each `Series` carries its own as `championship`.
`shared/driver-selection.js` maps the selected identity to the player
display name. Race startup removes that identity from `DRIVER_ROSTER` and
creates the rival cars from the remainder (12 drivers in all), so no name
is duplicated.

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
    shared/       browser-only code used by 2+ of race/garage/home:
                  car-model.js, driver-selection.js, driver-themes.js,
                  championship.js, graphics-profiles.js, track-geometry.js,
                  garage-setup.js
                  (garage-setup.js is here, not garage/, because
                  race/main.js reads it too, for the player's setup effects)
    home/         menu.js
  shared/         code both the browser and the room server load (#335):
                  circuits.js (+ race format: laps, tyre life, qualifying
                  length), driver-roster.js — no DOM, no three, no packages
  server/         rooms.mjs, room-server.mjs
  tools/          validate-circuits.mjs, check-boundaries.mjs, ...
```

**Vehicles (#339):** every drivable car is a `Vehicle` object
(`client/shared/vehicle.js`): `F1Car` and `RoadCar` (one per entry in
`road-cars.js`), registry `VEHICLES` / `vehicleById()`. Callers ask the car
(`stockParams(isRaining)` for rivals, `playerParams(isRaining, garage)` with
the player's garage, `stockColors()`, `paint()`, `showroomScale`,
`playerDetail`, `exhaustFlames`) instead of branching on `id === "f1"`. The
3D model is built by `client/shared/vehicle-view.js` (`buildVehicleModel`,
one builder per `kind`), so `vehicle.js` stays three-free and Node tools
(`validate-free-oval.mjs`) load it. The F1 and road
garages stay separate UIs (different parts).

**Series (#341):** a solo race runs as a `Series` (`client/shared/series.js`):
`F1Series` and `ClassicSeries`, registry `SERIES` / `seriesById()`, home's
pick via `loadSeries()` / `saveSeries()`. The series answers who the player
drives (`loadDriverId()`, `vehicle()`, `playerColors()`), the field
(`rivals()`), `driverName()`, `driverColors()`, `raceTitle()`, `championship` (#345), `drsErs` and the
home link (`query`, `launchLabel`); `race/main.js`, `home/menu.js` and
`garage/garage.js` no longer branch on `"classic"`. A room is always
`SERIES.f1`. `classic-series.js` keeps only the Classiche roster and driver
pick.

**Boundary rule (#335):** the backend never imports the frontend.
`server/` and `shared/` import only `shared/`, node built-ins and (server
only) npm packages; `client/` and `tools/` may import anything.
`npm run check:boundaries` (`tools/check-boundaries.mjs`) enforces it. A
module moves to `core/shared/` only when the server needs it; browser-only
shared code stays in `client/shared/`.

The 4 HTML entry points (`index.html`, `race.html`, `garage.html`,
`room.html`) and `assets/` **stay at the repo root** — GitHub Pages in this
repo serves the branch root as-is (no GitHub Action build step), and does
not support serving from an arbitrary subfolder like `/core`; moving the
HTML would break the live site without a Pages reconfiguration the user
would have to do manually. The maintainer docs (
`docs/RELEASE-CHECKLIST.md`, `docs/WORK-HANDOFF.md`, `docs/procedure.md`) live in
`docs/` (#300); the racing-agent procedure lives next to its skill in
`.claude/skills/procedure-racing/`. The root keeps only what a convention or an
external service expects there: the HTML pages, `CLAUDE.md`, `README.md`,
`LICENSE`, `package.json`, `manifest.webmanifest`.

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

## Driver capacity and voice status (#230–#231)

- `driver-roster.js` is the source of truth for selectable identities,
  multiplayer capacity and physical grid slots (`race-rules.js`). The
  Ossidiana pair expands the field to 12; championship points still go
  only to the first ten. Livries and cockpit themes remain in
  `driver-themes.js`; garage paint follows the selected driver's team.
- Voice status per participant (connection, mic, mute, speaking) and its
  HUD icons: [c4-voice.md](../comparisons/c4-voice.md).
- Gameplay, mobile layout, audio permissions and microphone behavior need
  manual validation; this change set received structural checks only.
