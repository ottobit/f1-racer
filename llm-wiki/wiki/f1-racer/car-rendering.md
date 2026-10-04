# Car rendering, liveries and drivers

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

## Atelier / shared car rendering

`core/client/shared/car-model.js` owns the procedural car used by both race and garage. Elliptical
body sections, multi-element wings, halo, suspension, diffuser and wheel details
replace the duplicated primitive models. `buildCar(color, {scale, detail, showDriver})` keeps
+Z forward, four rolling wheel groups and the original scaled 0.4 wheel radius.
The race uses material-batched static geometry; the garage enables additional
spokes, cooling slots and a procedural carbon bump texture. Materials belong to
each car, so ghost transparency does not affect the player or opponents.

`createStudioEnvironment` produces a one-time PMREM from procedural light cards.
Race cars receive it locally without changing track materials. `core/client/garage/showroom.js`
uses the same environment, ACES tone mapping, a shadowed spotlight, cool/warm
fill lights, a circular metal platform and an architectural studio backdrop.
No external model, HDR texture or new package dependency is required.

The atelier supports pointer/touch orbit, four camera presets, optional automatic
rotation (disabled by reduced-motion preference). Since #30 there is no livery
picker: the car wears the team colours of the driver chosen on the home page
(`playerLivery()` in `core/client/shared/garage-setup.js`), in the Garage and in the race.
Setup choices persist under `f1racer-garage-v1`; `loadGarageSetup()` keeps only
known part/variant pairs, so older saves' `livery` field is dropped. The five named drop targets appear during component dragging;
click/tap remains the mounting fallback. Complete front/rear wing assemblies
respond to setup selection. DPR is capped at 1.5 on compact viewports and 2 on
desktop; shadow maps use 1024/2048 respectively. Hidden tabs skip rendering.


> Living technical reference for the current F1 Racer implementation.
> Source of truth: the code in this repository.
>
> Broader project memory lives in `llm-wiki/wiki/f1-racer/`, following the
> repository's LLM Wiki workflow.

## 4. Player car model

Player state currently includes:
- `x`, `z`
- `heading`
- `speed`
- `lap`
- `lapStartTime`
- `currentLapTime`
- `bestLapTime`
- `prevRawProgress`
- `totalProgress`
- `damage`
- `drsActive`
- `wasOffTrack`
- track-limit violation count
- last lap penalty

The visual car is updated separately through `applyToMesh()`.

### Visual model
The player car is still generated directly in Three.js rather than loaded from an external GLB/GLTF asset. Its current visual model includes:
- tapered tub and nose;
- sidepods;
- front and rear wings with additional flap planes;
- open wheels and rims;
- halo structure;
- simplified suspension wishbones;
- engine-cover/shark-fin profile;
- rear exhaust/crash-structure detail;
- driver helmet;
- team sponsor decals on the sidepods, nose and rear wing;
- simplified floor/floor-edge aero;
- wheel hub detail.

The player car also has a dedicated visual scale (`PLAYER_VISUAL_SCALE`) applied only to the rendered group. Shared car scale, physics state and collision behaviour remain separate, so visual size changes do not implicitly change handling or collision dimensions.

## Race art, controls and persistent garage preview

`core/client/race/track-art.js` generates seeded asphalt/grass textures and circuit dressing:
painted track margins, rubber deposits, runoff, welded kerbs, swept guardrails,
instanced posts/trees, low mountains and pit-straight structures. Candidate scenery locations are kept
away from adjacent road segments. These remain decorative, not new collision
objects. The race uses ACES tone mapping and one 1024 shadow map centered around
the player; track meshes receive car shadows. Wet asphalt has lower roughness.
Marzamemi selects a dedicated mobile-conscious branch instead: sandy shoulders,
sea and beach planes, low stucco villas, walls, gates, utility poles and wires,
palms, oleanders and bougainvillea. Repeated objects remain instanced, and the
urban course uses red/white racing kerbs, without generic guardrails or mountains.
Kerbs on every circuit (#28; originally Marzamemi only) are two continuous
indexed ribbons per circuit (`weldedKerb`) sharing the road's sampled
cross-sections, with a low tapered profile — Marzamemi keeps its narrower
street profile, the other eight a wider one with shorter stripes. Red/white
paint uses edge-distance UVs and an integer repeat count; independent tangent
boxes must not return, because they leave wedges and X-shaped overlaps in the
tight corners. Guardrails likewise are one swept rectangular section per
continuous run (`sweptRails`), kept only where the rail's own stretch of track
is the closest one — which also removes rails that used to cross each other
where two legs run close.

The road, kerbs, runoff and painted lines are meshed from `visualCenterline`
(`core/client/race/main.js`: the same curve sampled 4x denser than the 360-sample gameplay
`centerline`) so tight hairpins render smooth, and every edge comes from
`offsetEdge()` (`core/client/shared/track-geometry.js`), which cuts the self-intersecting loop an
inner offset forms wherever the curve bends tighter than the offset (miter
join) — without it those apexes folded into dark bow-tie shards. Scenery
placement still steps through the coarse centerline, so object spacing is
unchanged. `ribbon()` strips were back-face culled until #28 (reversed
winding), so runoff and painted lines only became visible then; the ground
plane is now subdivided and depth-offset so those millimetre-thin strips and
the road always win over it at low camera angles.
Its map-traced angular layout uses local corner supports and tension 0.18;
the narrow shared central corridor is separated for racing clearance.
The upper HUD markup and existing `core/client/style.css` are unchanged; lower control styles
are isolated in `core/client/race/race-controls.css`.

`core/client/race/race-weather.js` owns sky cloud billboards, the rain particle field and
impact spark FX — self-contained scene objects that nothing outside
`core/client/race/main.js` references. It takes a `getPlayerState` getter rather than the
player state object directly, since it is wired up before that object
exists in `core/client/race/main.js`; only its rain recycling needs it, once actually
called per frame.

`core/client/race/steering.js` owns dead-zone shaping, exponential input smoothing and a
speed-sensitive yaw target. A touch starts at neutral wherever the thumb lands;
horizontal travel from that contact point requests steering. Only one pointer
owns the wheel, independently of the pedal pointers. Capture, cancellation,
lost capture, window blur and backgrounding clear held state. The visual wheel
rotates with the filtered command; yaw becomes zero at zero speed and reverses
in reverse gear. No automated test currently exercises this pure math in
this repository (a prior `tests/steering.test.mjs` claim here did not carry
over from the `portfolio-arcade` extraction and does not exist — see #6's
`core/tools/validate-circuits.mjs` for the repo's first Node-runnable check, on
circuit geometry rather than steering).

The garage fills the available dynamic viewport. On desktop the configuration
pane scrolls beside the fixed car stage; portrait mobile uses a stage above a
separately scrolling setup pane. Selecting a part automatically frames that
assembly. Front/rear wing geometry, floor width/diffuser height, spring spacing
and caliper finish preview each setup family. These are representative visual
cues: mechanical effects still come from `core/client/shared/garage-setup.js`. No change to storage
keys or setup effect values is made.

## Driver themes and real liveries

`core/client/shared/driver-themes.js` centralizes the five team liveries and the cockpit themes for
the custom friend names. The player's livery is derived, not chosen:
`playerLivery(driverId)` returns `liveryById(driver.team)` for the selected
driver, the same source the AI grid uses, so the player shares colours with
their AI teammate (#30 removed the old five-way Garage picker).

The `Posteriore` and rear-wing presets remain inside the modeled studio back
wall. A preset must not orbit beyond z=-8, where the opaque backdrop would sit
between the camera and the car.

`core/client/race/main.js` applies `playerLivery(SELECTED_DRIVER_ID)` to the player car at race
startup. AI cars use their team liveries from the same shared theme data. `core/client/race/race-camera.js` adds a small cockpit-view overlay with themed rails,
dash glow and name/motto badge for the selected driver; the top HUD remains
unchanged.

Each team livery also carries a fictional sponsor pair in `core/client/shared/driver-themes.js`:
IGNIX / TORQ LABS, PELAGOS / AZUR SYSTEMS, LUMENZA / ORBITA ENERGY, VIREON /
CANOPY TECH and NIVALIS / BOREAL DATA. `core/client/shared/car-model.js` turns those values into
small cached canvas decals for both teammates. Placement stays limited to the sidepods, nose and rear wing.

## Unique grid and exposed Garage cockpit

`core/shared/driver-roster.js` defines ten identities: the nine supplied friend names plus
Eddy Nitro. The selected identity becomes the player; `core/client/race/main.js` filters it out
before building the other nine cars, eliminating duplicate names while keeping
a full ten-car grid. Championship scoring normalizes the runtime `player` slot
back to the selected identity and ignores duplicate legacy entries.

The detailed showroom calls `buildCar(..., { showDriver: false })`. With the
helmet and visor absent, the model exposes a carbon cockpit rim, seat, headrest,
side bolsters, red harness, buckle, dashboard display and steering wheel. The
Garage view formerly called `Dettaglio` is now the closer `Abitacolo` preset.

## Visible race drivers and nameplates

When `showDriver` is enabled, `core/client/shared/car-model.js` builds a seated procedural driver:
torso, shoulders and arms use a matte material tagged with the primary livery
role, while gloves stay dark and the helmet keeps the secondary team color.
Race cars also expose a compact steering-wheel group. Both gloves are children
of that group at the grips, and `core/client/race/race-car-view.js` rotates the wheel and hands
from the same analog steering value that drives the front-wheel pivots.
These static pieces remain compatible with race-car geometry batching.

`core/client/race/race-nameplates.js` projects a point above each visible AI car through the
active Three.js camera and positions a small DOM label in screen space. Labels
inherit a team-color marker, fade with distance, disappear outside the frustum
or beyond 72 units, and never intercept input. The player car intentionally has
no label so chase and cockpit views remain clean.

During qualifying, landscape layouts show a compact timing list on the left.
It lists all ten drivers, highlights the player and uses the same single set of
synthetic rival lap times later consumed by the starting-grid calculation.
It has no enclosing panel and portrait layouts omit it to preserve driving area.
After the start, the same tower becomes the live race order and changes when
cars overtake, while preserving the player's highlighted row.
The top-right qualifying summary shows the player's provisional grid position
beside the lap time, rather than labeling a merely personal best as “Migliore”.
