# F1 Racer — Technical Wiki

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

## 1. Project map

```
├── index.html          # race setup / circuit and difficulty selection
├── menu.js             # menu state and navigation
├── race.html           # race-page DOM/HUD shell
├── main.js             # Three.js scene + game loop + gameplay systems
├── circuits.js         # circuit definitions and track geometry data
├── championship.js     # championship persistence and scoring
└── style.css           # visual presentation, HUD and responsive controls
```

There is currently no application bundler requirement for the race page: the game loads its browser dependencies directly and can remain a static web game.

## 2. Runtime architecture

`core/client/race/main.js` currently acts as the game engine and orchestration layer.

Main responsibilities currently living there:
- Three.js scene, camera, renderer and world objects.
- Player car and AI car state.
- Track queries and boundaries.
- Player movement integration.
- AI movement.
- Collision resolution.
- Lap/race progress.
- Qualifying and race state machines.
- DRS, tyre grip, damage and caution behaviour.
- Ghost-lap recording/playback.
- HUD updates and minimap.
- Camera modes.
- Main animation loop.

### Main loop

The runtime is driven by:

1. `clock.getDelta()`
2. `update(dt)`
3. scene/cloud updates
4. `renderer.render(scene, camera)`
5. `requestAnimationFrame(animate)`

`dt` is capped at 0.1 seconds to avoid very large simulation steps.

## 3. Session state

The game has two high-level phases:

- `sessionPhase = "qualifying"`
- `sessionPhase = "race"`

Qualifying has:
- countdown;
- solo player driving;
- a 60-second session;
- multiple flying laps;
- best lap time;
- synthesized AI qualifying times;
- grid ordering.

Race has:
- countdown;
- racing;
- finished state.

The same player-motion integration is shared between qualifying and racing.

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

## 5. Current driving model

Player movement is currently concentrated in `integratePlayerMotion(dt)`.

### Longitudinal behaviour
- throttle increases speed using `CAR.accel`;
- brake/reverse uses `CAR.brakeDecel`;
- coasting uses `CAR.coastDecel`;
- speed is clamped to forward/reverse limits;
- maximum speed is affected by damage, DRS and caution state.

### Steering
- keyboard steering is digital;
- touch steering is analog;
- steering authority decreases with speed;
- tyre grip multiplies steering authority;
- heading is directly integrated from steering input.

### Track interaction
`applyTrackBoundary()` applies progressive runoff drag once the car leaves the asphalt/kerb edge. Runoff remains traversable: it slows the car without snapping it back to an invisible track-width boundary or reducing momentum to zero. Hard collision behaviour should be tied to explicit physical barrier geometry rather than generic distance from the centerline.

### Current limitation
The model now has a lightweight dynamic layer: explicit lateral velocity, finite yaw response and grip-limited cornering. Excess lateral motion feeds a corner-drag penalty into longitudinal speed. This is still an arcade-oriented model rather than a full tyre-force simulation; explicit slip-angle/load-transfer modelling remains a future refinement.

## 6. Track system

Circuit geometry is defined in `core/client/shared/circuits.js`.

The runtime builds a centerline sampled into track points and uses Catmull-Rom spline geometry.

The track query system provides:
- nearest centerline point;
- distance from track;
- local track direction;
- side normal;
- progress index.

The track is also used for:
- grid placement;
- AI targeting;
- lap progress;
- track limits;
- minimap;
- camera context.

`marzamemi` is the sixth circuit and the first adapted from a supplied real
route. Its separated dogbone spline preserves the long parallel street legs
and both end loops while leaving enough clearance for a closed racing surface.
It uses a narrow nine-unit urban road and its own Garage recommendation.

`pianalago`, `serramonte` and `baiadoro` (#5) bring the roster to nine. Unlike
the first six's hand-placed points, all three were generated procedurally
(star-convex placement with a per-circuit angular radius profile — a smooth
low-amplitude one for Pianalago's sweeps, higher-frequency corners for
Serramonte's hairpins, one dominant long-straight harmonic for Baiadoro) and
accepted only once `core/tools/validate-circuits.mjs` (#6) reported zero errors
and warnings — see each entry's comment in `core/client/shared/circuits.js` for the exact
command. Every circuit in the roster now has a distinct integer width, 9
through 17. Serramonte is now the tightest/narrowest circuit overall
(Montenero's comment was updated to stop claiming that superlative); Baiadoro
is the widest, pairing a long straight with a tighter technical final complex
rather than uniform sweeps.

All three were reworked again for #26: the initial star-convex shapes were
too round (smooth wave harmonics only, no corner near the wall-margin
threshold), so each now also gets a hairpin-insertion pass — a base point
replaced by a tight approach/apex/exit triple of closely-angle-spaced
points, the same technique Marzamemi's real-street corners already used —
tuned per circuit (`spreadDeg`/`depthFactor`) and re-validated until the
minimum curvature radius sits comfortably (~15-18%, not borderline) above
the wall margin. Pianalago keeps two corners tightened this way (still the
most flowing of the three); Serramonte gets three real hairpins; Baiadoro
gets one deep hairpin at the end of its long straight.

### Shared geometry rules and offline validation

`core/client/shared/track-geometry.js` owns the pure, framework-agnostic rules used to turn a
circuit's raw control points into the runtime's centerline: sampling the
closed curve, deriving heading/side-normal at a sample, finding the
nearest sample to a point, and building fold-free offset edges for the
road-hugging meshes (`offsetEdge`). It takes an already-built curve object rather
than importing three.js itself, so the exact same rules run both in
`core/client/race/main.js` (fed the browser's CDN three.js build) and in
`core/tools/validate-circuits.mjs` (fed the pinned npm `three` build — see
`package.json`, a dev-only dependency never shipped with the static site).

`node tools/validate-circuits.mjs [ids...] [--svg [outDir]]` (#6) checks
every circuit in `core/client/shared/circuits.js` for a broken closure, a self-crossing or
reversed loop, degenerate/oversized sampled segments, corners tighter than
the runtime's own wall margin (`width/2 + 4`, same formula as `WALL_LIMIT`
in `core/client/race/main.js` — a corner this tight is also where a kerb ribbon would
detach), and two unrelated parts of the track running closer together than
their wall margins allow. A circuit can declare a documented, narrower
floor for the last check when it's intentionally close (Marzamemi's shared
coastal corridor is the current example) — still flagged as a warning, not
silently skipped, so a further regression is still caught. `--svg` writes a
top-down diagnostic preview per circuit to `tools/out/` (gitignored,
dev-only, not referenced by the shipped game).

Known gap (found in #28, **Open**): the curvature check measures a 3-point
circumradius over a 5-sample window of the 360-sample centerline, which
smooths away near-cusps. Measured on a dense sampling, the spline's true
minimum radius is ~1 unit at some apexes of Marzamemi (by design, tension
0.18) and of the #26 hairpin-insertion corners on Serramonte and Baiadoro
(Pianalago ~5) — so the "+15–18% above wall margin" figures recorded for #26
describe the smoothed stencil, not the actual apex, which is closer to a V
than a rounded hairpin. Rendering is now immune (`offsetEdge`); whether to
round those apexes and make the validator check true curvature is a separate
decision.

## 7. Race progress and lap counting

Race position is based on `totalProgress`, a monotonic travelled-distance accumulator.

This avoids comparing raw centerline fractions for cars that start at different physical grid offsets.

The same progress concept drives:
- lap counting;
- race ordering;
- player position HUD;
- finish condition.

## 8. AI

AI cars currently have:
- acceleration;
- maximum speed;
- steering/turn rate;
- damage;
- DRS;
- tyre grip;
- caution speed multiplier;
- collision avoidance.

The controller now has three layers:
1. preview the centerline and estimate upcoming corner severity;
2. choose a dynamic lookahead and a racing-line offset;
3. use a corner-speed target to brake before bends and accelerate once the preview clears.

Traffic is also considered tactically:
- a nearby car ahead can trigger a passing-side line;
- a nearby car behind can trigger a defensive line;
- the existing short-range collision avoidance remains as a safety layer.

### Current limitation

AI is now a lightweight racing controller, but it is not yet a full driver model. It does not simulate explicit tyre temperature, individual driver error profiles, multi-lap strategic decisions, or a detailed overtaking state machine.

Those are future refinements for the race-systems phase.

## 9. Qualifying

Qualifying is a solo session.

The player can complete multiple laps and the best completed lap is retained.

AI qualifying times are synthesized from track length, AI top speed and controlled variance rather than simulated in real time.

The resulting order is applied to fixed physical grid slots.

## 10. Race systems

Already present:
- standing start;
- laps;
- race classification;
- championship points;
- DRS;
- tyre grip/wear representation;
- damage;
- track-limit penalties;
- caution state;
- ghost lap;
- minimap;
- camera modes.

The current race is intentionally lightweight and browser-friendly.

## 11. DRS / tyres / damage

### DRS
DRS modifies maximum speed when the current eligibility logic permits it.

### Tyres
Tyre grip is exposed through `tireGripFactor()` and affects driving behaviour. The system is currently a simplified grip model rather than a full compound/temperature/pressure simulation.

### Damage
Hard impacts increase damage and reduce effective maximum speed.

## 12. Ghost lap

The player's best lap is sampled approximately every 100 ms.

Samples contain:
- time;
- x;
- z;
- heading.

The best lap is persisted in `localStorage` per circuit and replayed against the current lap clock.

This is a useful foundation for future delta/ghost features.

## 13. HUD and input

HUD currently exposes:
- circuit;
- position;
- lap;
- current lap time;
- best time;
- speed;
- speed bar;
- gear;
- shift LEDs;
- DRS;
- tyre grip;
- damage;
- caution;
- penalty notification;
- minimap.

The main gear/speed instrument cluster (shift LEDs, DRS/ERS, speed bar, gear and speed readout) is positioned at the **top center** of the viewport, keeping it in the forward sight line and away from the bottom-corner touch controls.

Qualifying keeps only its countdown in the upper HUD. The phase banner and
label are intentionally omitted to preserve the forward view on landscape
phones. The compact center instrument cluster uses the original speed bar and
digital readout without an analog dial.

Input:
- Optional phone motion steering: activate from the lower controls, hold the
  phone steady for 500 ms to average neutral. Screen-plane roll compensates
  pitch; nearly horizontal screens prompt lifting the phone. SX/DX feedback
  shows actual smoothed steering, and mode changes preserve pedal holds.
  Then hold the
  comfortable neutral position, then use Centra to recalibrate. Three sensitivity
  choices share the existing steering dead zone/smoothing. Touching the wheel
  immediately restores touch steering. No sensor listener runs before consent;
  missing/stale data, screen rotation or backgrounding restores touch controls.
  Verify direction and feel on physical iOS/Android devices before claiming
  device compatibility; structural checks cannot establish sensor behavior.
- Arrow keys / WASD;
- touch gas/brake;
- analog touch steering wheel;
- C toggles chase/cockpit camera.

## 14. Camera

Two modes currently exist:

### Chase
Third-person camera follows behind the player, with speed-dependent FOV.
Its desired position is constrained to the track-and-runoff corridor so tight
corners cannot place the camera behind scenery. Compact-landscape framing keeps
enough distance and height to show the rear of the player car.

### Cockpit
First-person camera is attached directly to the car.

The player's visual car is hidden in cockpit mode.

## 15. Audio

`core/client/race/race-audio.js` owns gear mapping and the synthesized engine/shift sound
(`setupRaceAudio`), wired from `core/client/race/main.js` through a `getEngineActive` getter
rather than a shared module variable — true while racing or while actually
driving a qualifying lap, not just during the race phase, so the player's
engine is audible in both sessions (#10; previously silent for all of
qualifying). `core/client/race/race-hud.js` calls the returned `updateEngineSound`/
`playShiftClick`/`updateAmbientChorus` each frame; `core/client/race/main.js` only owns lazy
initialization on first input. The engine sound is synthesized with Web
Audio rather than external audio assets.

A second, cheap "grid chorus" voice (two detuned low oscillators, not a
per-car chain) hints at the other cars' engines: `updateAmbientChorus`
scales its volume by how many AI cars are within a fixed radius of the
player (capped at 6 counted voices) and their average speed, so it swells
at a bunched-up standing start and thins out as the pack spreads around the
lap (#10).

It uses:
- three layered oscillators/harmonics;
- low-pass and high-pass filtering;
- dynamics compression;
- speed ratio for volume;
- gear-relative RPM ratio for pitch/filter;
- shift click sound.

Audio initializes lazily after user interaction to satisfy browser autoplay restrictions.

## 16. Championship and persistence

`core/client/shared/championship.js` stores championship progress/results locally.

The race reports final classification and points, then determines the next unraced circuit.

This means the game remains fully client-side.

## 17. Mobile

Touch controls are implemented in `core/client/race/main.js` and styled in `core/client/style.css`.

On the race page, browser zoom/gesture handling is explicitly suppressed for gameplay surfaces on touch devices. CSS `touch-action: none` is combined with iOS Safari gesture-event and rapid-double-tap guards, while normal link interaction remains available.

The steering wheel uses pointer capture and an analog horizontal position rather than two binary left/right buttons.
Its touch surface is 184 px in ordinary mobile layouts, 164 px in compact
landscape and 168 px on very narrow screens, while the upper HUD is unchanged.

This is important to preserve when refactoring input.

## 18. Known architectural limitations

### Monolithic engine file
`core/client/race/main.js` currently contains most engine systems. This is the biggest maintainability risk.

### Physics abstraction
Player physics is still mostly direct speed/heading integration.

### AI abstraction
AI has no explicit racing-line, corner-speed or tactical layer.

### UI coupling
Gameplay code directly queries and updates DOM elements.

### Data/model separation
Car state, simulation logic and presentation are close together.

### Testing
There is no dedicated automated gameplay test layer visible in the current F1 Racer structure. Release verification therefore needs an explicit browser/regression checklist.

## 19. Development principles

For future work:

1. Preserve working gameplay unless an issue explicitly changes it.
2. Prefer small, reversible changes.
3. Keep simulation state separate from visual presentation when practical.
4. Do not introduce a build system merely for the sake of it.
5. Keep the game deployable as a static site.
6. Update this wiki when an architectural decision changes.
7. Every feature issue should be developed, tested, committed/pushed, reviewed through a PR, release-tested, merged, and only then followed by the next issue.

## 20. Planned evolution

### Issue #41 — Physics
Implemented a first dynamic layer with lateral velocity, finite yaw response, grip-limited cornering and corner-drag feedback.

### Issue #42 — HUD
Expose the richer driving model through a better racing interface.

### Issue #43 — AI
Implemented corner preview, dynamic lookahead, pre-corner speed control, racing-line offsets and basic attack/defence behaviour.

### Issue #44 — Race systems
Implemented lightweight tyre compounds and degradation, manual ERS with recharge/deployment, player pit service and stronger wet-grip effects. Automatic AI stops are disabled until a visible pit lane exists; stopping every rival on the racing surface after lap one was confusing and unrealistic. DRS remains integrated with the new ERS layer.

### Issue #45 — Presentation
Implemented lightweight rain particles, impact sparks, camera-impact shake and retained the synthesized engine audio as the core audio layer. Further asset-level art/audio can be added later without changing the simulation model.

### Issue #46 — Release hardening
Added `RELEASE-CHECKLIST.md` with source-level gates and desktop/mobile browser smoke tests. Automated browser/physics CI remains a future infrastructure improvement.


## Garage setup

`garage.html` + `core/client/garage/garage.js` provide an interactive Three.js setup bay with a 360° rotatable open-wheel car. Components can be mounted by drag-and-drop or click/tap. `core/client/shared/garage-setup.js` is the shared data/physics contract and persists the setup under `f1racer-garage-v1`.

Five component families each expose three trade-off variants: front wing, rear wing, floor/diffuser, brakes and suspension. The setup produces modifiers for speed, downforce, braking, stability, traction and runoff behaviour. `core/client/race/main.js` reads these modifiers at race startup, so Garage choices alter actual race physics rather than only UI stats. Front/rear wing choices also alter the Garage car geometry for immediate visual feedback.

Each circuit carries a data-driven recommended setup and a short rationale.
The selected carousel circuit is persisted and passed into the Garage, which
compares all five current components with the recommendation. Applying the
preset is explicit; manual tuning remains free.
The five live setup parameters are rendered as a compact translucent overlay on
the car stage, with label, bar and numeric value, rather than consuming vertical
space in the scrolling component panel.


## Evolved driving dynamics

Player physics uses a lightweight combined-grip model rather than independent steering/throttle/brake channels. Lateral demand consumes part of the longitudinal grip budget, so braking and accelerating while cornering are less effective. Simplified longitudinal load transfer sharpens front response under braking and reduces it under power; lateral recovery is progressive and rear stability changes with braking/throttle. This produces controllable understeer/oversteer tendencies, trail-braking consequences and cleaner-exit rewards without a full rigid-body tyre simulation. Garage modifiers remain layered into the base car constants.


## Camera, race completion, collisions and Garage coherence

The chase camera uses a materially close base framing (6.4 units, capped at 5.2 on compact landscape) while remaining inside the track corridor. Race completion is gated by validated completed laps: a lap requires reaching the opposite half of the circuit and then crossing the painted start/finish line forward; raw accumulated progress alone can no longer trigger the results overlay. Each car's finishing position is locked at that crossing, so cars that have already finished cannot distort the result by continuing to accumulate distance. Car-to-car contacts use overlap correction plus relative closing velocity along the contact normal instead of multiplying both cars' speed on every overlap, reducing repeated bouncing and sticky side contact.

The Garage renders the same procedural F1 car construction used by the race branch, including the richer modern-F1 visual cues. Five labelled mounting zones make the drag target explicit and only the matching zone highlights during a drag; tap/click remains the mobile fallback.


## ChatGPT Work handoff

For a fresh ChatGPT Work session, start with `WORK-HANDOFF.md`. It is a compact operational entry point that links this wiki, the repository procedure and release checklist without duplicating the full architecture here.

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

## Circuit carousel and bilateral contact

The home circuit grid is now a single map-led carousel. `core/client/home/menu.js` normalizes
each circuit's control points into an inline SVG map and keeps swipe, arrow,
keyboard and dot navigation on one selected index. The active slide combines
track character, weather, race status and a large launch action; mobile arrows
and dots keep 44–48 px touch targets.

`core/client/race/race-collisions.js` owns car-to-car overlap correction and equal-mass impulse
transfer. Both player and AI cars can lose forward speed, gain a damped lateral
slide and yaw, and receive the same capped damage from hard relative impacts.
Sparks and player camera shake expose meaningful contact while a short cooldown
prevents continuous damage from one lingering overlap. AI lateral/yaw recovery
is integrated in `core/client/race/race-ai.js`; the existing HUD already reveals player damage.

The home follows an action-first order. A prominent Garage command and a direct
race shortcut sit immediately below the hero; difficulty and driver are grouped
as one session setup. Circuit selection remains the main interactive stage, and
championship standings come afterward as reference information. This keeps the
Garage discoverable before users commit to a circuit, especially on mobile.

The mobile session setup uses two explicit steps. Difficulty is a three-column
segmented control with a short explanation per level; the ten drivers use a
numbered three-column grid with 54 px touch targets, switching to two columns below
365 px. Active choices combine border, inset marker and background rather than
depending on color alone.

The circuit slide itself is not a link. Its only navigation target is the
thumb-sized `Scendi in pista` CTA, which carries the selected circuit and
difficulty in its URL. This prevents accidental race launches during swipe and
avoids presenting two competing start buttons.

The swipe handler ignores mouse pointers and any pointer that begins on the
CTA. Desktop navigation therefore remains a standard link click, while touch
and pen can still swipe from the rest of the circuit card.

## Unique grid and exposed Garage cockpit

`core/client/shared/driver-roster.js` defines ten identities: the nine supplied friend names plus
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

## Performance and graphics profiles

`core/client/shared/graphics-profiles.js` (`loadGraphicsProfile`) picks a rendering cost profile
— DPR cap, shadow map enabled/size, rain particle count and cloud count —
from cheap, synchronous device signals (coarse-pointer media query, CPU core
count, native device pixel ratio), no benchmarking pass. It never touches
`CAR`/`AI` tuning, `TRACK_WIDTH`, `GRASS_LIMIT`/`WALL_LIMIT` or any other
gameplay-visible constant: only rendering cost changes, never physics or race
visibility (#2). The choice persists in `localStorage`
(`f1racer-graphics-profile-v1`); a `?gfx=low|medium|high` URL param overrides
and re-persists it, for testing. There is deliberately no new UI for this on
the home screen — the session-setup panel's "two choices" (difficulty,
driver) is an established, deliberate layout (see
`llm-wiki/wiki/f1-racer/decisions.md`) that a third control would disturb.

Coverage so far is the DPR/shadow/particle-count levers with the clearest
performance-per-risk payoff. Distant-scenery density (`core/client/race/track-art.js`
instancing) and reflections (`core/client/shared/car-model.js`'s studio PMREM environment) are
still not profile-aware — deliberately: without a real measured bottleneck
(the issue's own required first step, still blocked — see below), changing
either would be tuning against a guess, not a finding. See
`llm-wiki/wiki/f1-racer/roadmap.md`.

The Garage now reads the same profile (`core/client/garage/showroom.js`'s `createShowroom`
takes an optional `graphicsProfile`; `core/client/garage/garage.js` passes
`loadGraphicsProfile()`) and applies it to its own renderer's DPR cap and
shadow map, instead of the old viewport-width-only heuristic
(`matchMedia('(max-width: 760px)')`, still the fallback when no profile is
passed). This is a straight extension of an already-decided level system to
a second scene with the same characteristics, not new tuning.

`core/client/race/race-diagnostics.js` (`setupDiagnosticsOverlay`) is a dev-only FPS/frame-time
and `renderer.info` (draw calls, triangles, geometries, textures) overlay.
Off by default — no DOM node is created unless explicitly enabled via
`?diag=1` (persisted in `localStorage` so it survives navigating from
qualifying into the race; `?diag=0` clears it) — so normal play never creates
or sees it. Also wired into the Garage (`core/client/garage/showroom.js` takes an optional
`onFrame(dt)` callback from its own `setAnimationLoop`), covering the
issue's "misurare... più garage" activity the same way the race scene
already was.

Real-device measurement (the issue's own acceptance bar: a measured
before/after on at least one real smartphone and one desktop) has not been
done from this environment, which has no real mobile hardware or GPU
rendering — left for the user's own pass with the diagnostics overlay.

## Agent API (`window._ENVIRONMENT_`)

`core/client/race/agent-api.js` (#8/#9) lets an external agent drive the player car from an
already-open race page, without simulating touch/keyboard events. It's
opt-in only, via `?agent=1` on `race.html`; `core/client/race/main.js` never imports it
otherwise, so a normal human session pays nothing for it. Once wired up it
sets `window._ENVIRONMENT_ = { getState, step, release }` and fires
`f1-environment-ready` on `window`.

```js
const s = window._ENVIRONMENT_.getState();
await window._ENVIRONMENT_.step({ throttle: 1, durationMs: 800 });                 // straight-line accel
await window._ENVIRONMENT_.step({ steer: -0.4, throttle: 0.6, durationMs: 600 });  // turn left into a corner
window._ENVIRONMENT_.release();                                                     // hand control back
```

`getState()` returns a compact, freshly-built (never-shared) snapshot, so
mutating the returned object cannot affect internal state: session
phase/state, `speedKmh`, lap/laps, race position, `totalProgress`,
`lateralOffsetMeters` and `headingErrorRad` from the ideal line, `onTrack`,
damage/tyre/DRS status, a `nextCorner` heuristic (direction/distance/
curvature — the largest heading change found within a fixed lookahead window
over the same centerline samples the AI steers by, not a real geometric
radius), up to 5 `nearbyCars` (relative distance/lateral offset, closest
first), and `finished`/`raceResult` once the race ends.

`step(action)` validates and clamps `steer` (-1..1), `throttle`/`brake`
(0..1) and `durationMs` (50–3000ms, default 500) rather than throwing on bad
input; a second `step()` while one is in flight is rejected. It drives the
exact same input the human player uses — `input.forward`/`input.back`
booleans (pedals are digital in this game, so 0..1 throttle/brake are
thresholded to on/off) and a new `setExternalSteer()` in `core/client/race/race-input.js` that
overrides `steering.value` without being reset to 0 by the keyboard/wheel/
motion smoothing that runs every frame. When the step's duration elapses it
neutralizes throttle/brake/steer and returns the new `getState()` — so one
`step()` call is both the action and the next observation. There is no `drs`
action: DRS is fully automatic here (gap-based), so `getState()` only
reports `drsActive` read-only.

Human control always wins immediately: `core/client/race/race-input.js`'s real DOM handlers
(keydown, pointer, motion) call an `onHumanInput` callback synchronously —
never the agent itself — which the agent API uses to abort its current step,
clear the external steer override and release any pedal it was holding, all
before the human's own input is applied. `release()` does the same
explicitly, for an agent that wants to hand back control without waiting for
a step to finish.

Verified in a real headless browser (Playwright, Chromium): the API appears
and matches this contract, `getState()` snapshots are JSON-serializable and
isolated from mutation, out-of-range `step()` input is clamped rather than
throwing, a concurrent `step()` is rejected, and a step neutralizes its
inputs once its duration elapses.

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
driver ids are exactly `core/client/shared/driver-roster.js`'s ten `rival-*` entries — the
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
of the two dominant `home-command` cards ("Gioca con altri", #40) — see
`decisions.md`'s "Home and Circuit Selection" section for that history.

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
