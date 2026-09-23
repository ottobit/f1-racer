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
- `race-audio.js`: gear mapping and synthesized engine/shift-click Web Audio,
  gated by a `getRaceState` getter rather than a shared module variable.
- `track-geometry.js`: pure centerline sampling/query rules, framework-
  agnostic (takes a curve object rather than importing three.js), shared
  between `main.js` and `tools/validate-circuits.mjs` (#6).

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

The garage previews setup families visually and persists the selected livery.
The race reads that livery for the player car while AI cars keep their team
color pairs.

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
