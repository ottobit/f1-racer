# Free drive

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

## Free drive (`free.html`, `core/client/free/`, #274)

A separate mode from the championship and multiplayer: one car on a wide
banked oval, no rivals, qualifying, race, lap limit or results. Home has a
"Guida libera" card; the page has an exit link and Esc.

- `free.html` + `free/free.js` are their own page (not `race.html` with
  flags), so the race flow is untouched. They reuse the race's input, camera,
  audio and car model; the HUD is a small speed/gear/bank readout.
- `free/oval.js`: `FREE_OVAL`, NOT in `CIRCUITS` (menu, championship, rooms
  and bots never see it): a stadium shape, 720-unit straights, R 150, width 30.
- `free/banking.js` (pure): bank from the signed curvature of the centerline
  (smoothed), full 24° in the turns, flat straights. The road pivots on its
  inside edge (ground level), so the outside is the high side, up to ~13 units.
  `surfaceAt` gives height, gradient and bank; `poseOnSurface` gives pitch and
  roll; `bankGripFactor` a small lateral-grip bonus (`BANK_GRIP_GAIN` 0.5).
- `free/free-sim.js`: the same `setupPlayerPhysics` as the race, still 2D; the
  banked pose (`state.y/pitch/roll/bank`) is derived every frame. No tyre wear.
- `race-camera.js` adds `state.y` to its heights (undefined = 0 in the race).
- `node tools/validate-free-oval.mjs` (from `core/`) checks the shape, the
  banking and that the autopilot laps inside the road.
- Limits: not run in a browser (look, feel, mobile touch drag untested); the
  outside edge is a wall, there is no runoff on the high side.
- Vehicles and rivals (#311, #313, #315): a select under the circuit name
  picks the car (F1, Cinquino, Pandina, Spider, Pulmino, Muscle, Familiare;
  saved in `f1racer-free-car`, `?car=` wins) and reloads.
  `shared/vehicle-models.js` builds the road cars from extruded side profiles
  (`bodyShaper` rounds plan and tumblehome after extrusion) with the
  `buildCar` contract plus an optional `cockpitEye` (read by `race-camera.js`;
  the van's cab sits high and forward). `shared/road-cars.js` holds each road
  car's name, colours and physics (115-250 km/h; shared with the coming
  Classiche race); `free/vehicles.js` adds the F1 and `RIVAL_SLOTS`. All the
  other cars line up just ahead and start on your first throttle: each is
  its own `createFreeSim` driven by `createAutopilotProvider`, on an inside
  lane (the slow cars run wide in the turns: outside lanes left the road).
  No contact between cars. Generic shapes, no badges.
  `validate-free-oval.mjs` laps every car on every lane.
