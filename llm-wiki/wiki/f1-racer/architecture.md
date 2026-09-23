# F1 Racer Architecture

## Runtime

`race.html` loads the race experience directly in the browser.
There is no bundler requirement.

The current race runtime is coordinated by `main.js`, with focused helpers:

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
- `track-geometry.js`: pure centerline sampling/query rules, framework-
  agnostic (takes a curve object rather than importing three.js), shared
  between `main.js` and `tools/validate-circuits.mjs` (#6). Also
  `offsetEdge()` (#28): miter-cut offset edges used by the road mesh and by
  `track-art.js`'s kerbs/runoff/lines, so tight apexes never fold.
- `track-art.js`: circuit dressing. `dressCircuit(..., detail)` places
  scenery on the coarse gameplay centerline but meshes road-hugging strips
  from the denser render-only `visualCenterline` (#28).
- `graphics-profiles.js`: automatic, persisted, device-signal-based
  rendering-cost profile (DPR/shadows/particle counts only — never physics
  or race visibility). No new UI (#2).
- `race-diagnostics.js`: dev-only FPS/`renderer.info` overlay, a no-op
  unless explicitly enabled (#2).

## Shared Car Model

`car-model.js` builds the procedural open-wheel car used by both race and
garage. It keeps gameplay scale separate from visual scale and exposes wheel
groups so steering and rolling can be animated.

`driver-roster.js` owns the canonical ten identities. `driver-themes.js` owns
shared livery and cockpit theme data. `car-model.js`
tags paint materials by role, so race and garage can apply the same primary and
secondary colors without rebuilding separate car definitions. The same livery
records carry fictional team sponsor pairs; cached canvas textures place small
wordmarks on sidepods, nose and rear wing in both race and Garage models.

`race-progress.js` counts a lap at the painted finish-line offset rather than
at the spline origin and locks finish positions as cars complete the configured
distance. AI automatic pit service is intentionally disabled while there is no
visible pit lane; player-requested service remains available.

Race cars include a lightweight seated driver built from the shared procedural
model. The suit material carries the primary livery role; helmet accents carry
the secondary color. A dynamic race steering-wheel group owns both gloves and
rotates from the same input used for the front wheels. The detailed Garage path
keeps `showDriver: false`.

## Garage

`garage.html`, `garage.js`, `showroom.js`, `garage.css` and
`garage-setup.js` implement the setup bay. Setup data is persisted under
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
`race-diagnostics.js` overlay the race uses (`?diag=1`, off by default).

`circuits.js` also owns each track's recommended five-component setup and its
rationale. `menu.js` persists the active carousel circuit; `garage.js` reads it,
renders current-to-recommended differences and applies the preset only after an
explicit user action.

The detailed showroom car is built with `showDriver: false`. Its exposed
cockpit interior includes a seat, headrest, harness, bolsters, dashboard,
display and steering wheel; the lightweight race cars still include a driver.

## Championship and Drivers

`championship.js` owns championship state and scoring. `driver-selection.js`
maps the selected identity to the player display name. Race startup removes
that identity from `DRIVER_ROSTER` and creates the nine AI cars from the
remainder, guaranteeing ten unique names on the grid.

`race-camera.js` builds a lightweight cockpit overlay from the selected driver's
theme when cockpit camera mode is active.

## Circuit Selection

`menu.js` renders a single active circuit at a time using an inline map derived
from the same control points consumed by the race. `index.html` and `style.css`
provide the swipeable carousel viewport, arrow controls, keyboard navigation,
large launch target and mobile layout.

`circuits.js` includes the real-route-inspired Marzamemi dogbone as the sixth
round. Its `theme: "marzamemi"` switches `track-art.js` from generic autodrome
dressing to an instanced coastal streetscape based on the supplied map and
street video; the geometry remains procedural and static-site friendly.

## Constraints

- Keep the game static-site friendly.
- Avoid adding a build system unless a future feature clearly requires it.
- Keep structural checks cheap by default.
- Do not alter the top HUD panel without a specific user request.
