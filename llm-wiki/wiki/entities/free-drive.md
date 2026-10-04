---
type: entity
updated: 2026-10-04
sources: []
---

# Free drive

`free.html` and `core/client/free/` (#274) form a separate mode, outside the
championship and multiplayer:
- one banked oval;
- no qualifying, race, lap limit or results;
- an exit link plus `Esc`.

## Code

- **Separate page.** `free.html` and `free/free.js` are a page of their own,
  not `race.html` with flags, so the race flow is untouched.
- **Reused race parts:** input, camera, audio and car model.
- **HUD:** a small speed, gear and bank readout.
- **The oval (`free/oval.js`):**
  - `FREE_OVAL` (`ovale-sopraelevato`) is a stadium shape: 720-unit
    straights, R 150, width 30;
  - it is not in `CIRCUITS`, so the menu, championship, rooms and bots never
    see it.
- **Banking (`free/banking.js`, pure):**
  - the bank angle follows the signed, smoothed curvature: full 24° in the
    turns, flat on the straights;
  - the road pivots on its inside edge, so the outside rises up to ~13
    units;
  - `surfaceAt` and `poseOnSurface` give height, pitch and roll;
  - `bankGripFactor` adds a small lateral grip bonus (`BANK_GRIP_GAIN` 0.5).
- **Physics (`free/free-sim.js`):**
  - the same `setupPlayerPhysics` as the race, still 2D, with the banked
    pose derived each frame;
  - no tyre wear.
- **Camera:** `race-camera.js` adds `state.y` to its heights; it is
  `undefined`, i.e. 0, in the race.
- **Cars (#311, #313, #315):**
  - a select picks F1, Cinquino, Pandina, Spider, Pulmino, Muscle or
    Familiare;
  - the choice is saved in `f1racer-free-car`, and `?car=` overrides it;
  - every other car lines up ahead and starts on the first throttle, each
    with its own `createFreeSim` and autopilot on an inside lane
    (`RIVAL_SLOTS`);
  - cars do not touch each other.
- **Road-car models (`shared/vehicle-models.js`):**
  - extruded side profiles with `bodyShaper`;
  - an optional `cockpitEye`;
  - no badges.
- **Road-car data (`shared/road-cars.js`):** names, colours and physics,
  115–250 km/h.
- **Validator:** `node tools/validate-free-oval.mjs` (run from `core/`)
  checks the shape and the banking. It also laps every car on every lane.

## Limits

- The outside edge is a wall, with no runoff on the high side.
- Look, feel and mobile touch drag are checked only by the user playing.
