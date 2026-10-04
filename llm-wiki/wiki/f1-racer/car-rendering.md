# Car rendering, liveries and drivers

Vehicle objects (`Vehicle`, `F1Car`, `RoadCar`) are described in
[architecture.md](architecture.md#source-layout-46). This page covers how cars
look. Road cars: `core/client/shared/vehicle-models.js`
([free-drive.md](free-drive.md)).

## Procedural F1 car (`core/client/shared/car-model.js`)

- `buildCar(color, { scale, detail, showDriver })` builds the open-wheel
  car with no GLB asset:
  - the car faces +Z;
  - it has four rolling wheel groups;
  - the wheel radius is 0.4 (scaled).
- Bodywork: elliptical body sections, multi-element wings, halo, suspension,
  diffuser and wheel details.
- `detail: true` is used by the garage. It adds spokes, cooling slots and a
  carbon bump texture.
- Race cars use material-batched static geometry.
- Each car owns its materials, so ghost transparency never leaks onto other
  cars.
- Paint materials are tagged by role (`primary` / `secondary`). Race and
  garage apply the same livery without rebuilding the car.
- `createStudioEnvironment` makes a one-time procedural PMREM, used by race
  cars and the showroom.
- The player car has a visual-only scale, `PLAYER_VISUAL_SCALE = 1.25`
  (`race/main.js`). Physics and collision size are unchanged.

## Liveries and sponsors (`core/client/shared/driver-themes.js`)

- `TEAM_LIVERIES` holds **six** teams. Each has a fictional sponsor pair:
  - Fenice: IGNIX / TORQ LABS;
  - Nettuno: PELAGOS / AZUR SYSTEMS;
  - Solare: LUMENZA / ORBITA ENERGY;
  - Smeraldo: VIREON / CANOPY TECH;
  - Artica: NIVALIS / BOREAL DATA;
  - Ossidiana: ONYX / NOCTIS LABS.
- Sponsor wordmarks are cached canvas decals on the sidepods, nose and rear
  wing.
- The player's livery is derived, not chosen: `playerLivery(driverId)` is
  the selected driver's team livery. The player therefore shares colours with
  their teammate. The garage picker was removed in #30.
- Cockpit themes per driver (rails, dash glow, name and motto badge) are
  drawn by `race/race-camera.js` in cockpit view.

## Grid identities

`core/shared/driver-roster.js` holds **12** drivers, 2 per team. The selected
identity becomes the player, and `main.js` removes it from the rival list, so
names are never duplicated. Championship points go only to the first ten.

## Drivers in the cars and nameplates

- `showDriver: true` (race cars) adds a seated driver:
  - the suit uses the primary livery role and the helmet the secondary;
  - the gloves sit on a steering-wheel group that `race/race-car-view.js`
    rotates with the same steering value as the front wheels.
- `showDriver: false` (showroom) exposes the cockpit instead: rim, seat,
  headrest, harness, dashboard and wheel. The garage camera preset for this
  is `Abitacolo`.
- `race/race-nameplates.js` projects a label above each visible rival:
  - each label has a team-colour marker;
  - it fades with distance and hides beyond 72 units or off screen;
  - it never captures input;
  - the player car has no label.
