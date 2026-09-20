# F1 Racer — Technical Wiki

## Atelier / shared car rendering

`car-model.js` owns the procedural car used by both race and garage. Elliptical
body sections, multi-element wings, halo, suspension, diffuser and wheel details
replace the duplicated primitive models. `buildCar(color, {scale, detail})` keeps
+Z forward, four rolling wheel groups and the original scaled 0.4 wheel radius.
The race uses material-batched static geometry; the garage enables additional
spokes, cooling slots and a procedural carbon bump texture. Materials belong to
each car, so ghost transparency does not affect the player or opponents.

`createStudioEnvironment` produces a one-time PMREM from procedural light cards.
Race cars receive it locally without changing track materials. `showroom.js`
uses the same environment, ACES tone mapping, a shadowed spotlight, cool/warm
fill lights, a circular metal platform and an architectural studio backdrop.
No external model, HDR texture or new package dependency is required.

The atelier supports pointer/touch orbit, four camera presets, optional automatic
rotation (disabled by reduced-motion preference), and preview-only paint finishes.
Setup choices still persist under `f1racer-garage-v1`; finish colors do not change
the race livery. The five named drop targets appear during component dragging;
click/tap remains the mounting fallback. Complete front/rear wing assemblies
respond to setup selection. DPR is capped at 1.5 on compact viewports and 2 on
desktop; shadow maps use 1024/2048 respectively. Hidden tabs skip rendering.


> Living technical reference for the current F1 Racer implementation.  
> Source of truth: the code in `games/f1-racer/`.

## 1. Project map

```
games/f1-racer/
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

`main.js` currently acts as the game engine and orchestration layer.

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
- Engine audio synthesis.
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

Circuit geometry is defined in `circuits.js`.

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

Input:
- Arrow keys / WASD;
- touch gas/brake;
- analog touch steering wheel;
- C toggles chase/cockpit camera.

## 14. Camera

Two modes currently exist:

### Chase
Third-person camera follows behind the player, with speed-dependent FOV.

### Cockpit
First-person camera is attached directly to the car.

The player's visual car is hidden in cockpit mode.

## 15. Audio

The engine sound is synthesized with Web Audio rather than external audio assets.

It uses:
- three layered oscillators/harmonics;
- low-pass and high-pass filtering;
- dynamics compression;
- speed ratio for volume;
- gear-relative RPM ratio for pitch/filter;
- shift click sound.

Audio initializes lazily after user interaction to satisfy browser autoplay restrictions.

## 16. Championship and persistence

`championship.js` stores championship progress/results locally.

The race reports final classification and points, then determines the next unraced circuit.

This means the game remains fully client-side.

## 17. Mobile

Touch controls are implemented in `main.js` and styled in `style.css`.

On the race page, browser zoom/gesture handling is explicitly suppressed for gameplay surfaces on touch devices. CSS `touch-action: none` is combined with iOS Safari gesture-event and rapid-double-tap guards, while normal link interaction remains available.

The steering wheel uses pointer capture and an analog horizontal position rather than two binary left/right buttons.

This is important to preserve when refactoring input.

## 18. Known architectural limitations

### Monolithic engine file
`main.js` currently contains most engine systems. This is the biggest maintainability risk.

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
Implemented lightweight tyre compounds and degradation, manual ERS with recharge/deployment, player pit service, simple AI pit strategy, and stronger wet-grip effects. DRS remains integrated with the new ERS layer.

### Issue #45 — Presentation
Implemented lightweight rain particles, impact sparks, camera-impact shake and retained the synthesized engine audio as the core audio layer. Further asset-level art/audio can be added later without changing the simulation model.

### Issue #46 — Release hardening
Added `RELEASE-CHECKLIST.md` with source-level gates and desktop/mobile browser smoke tests. Automated browser/physics CI remains a future infrastructure improvement.


## Garage setup

`garage.html` + `garage.js` provide an interactive Three.js setup bay with a 360° rotatable open-wheel car. Components can be mounted by drag-and-drop or click/tap. `garage-setup.js` is the shared data/physics contract and persists the setup under `f1racer-garage-v1`.

Five component families each expose three trade-off variants: front wing, rear wing, floor/diffuser, brakes and suspension. The setup produces modifiers for speed, downforce, braking, stability, traction and runoff behaviour. `main.js` reads these modifiers at race startup, so Garage choices alter actual race physics rather than only UI stats. Front/rear wing choices also alter the Garage car geometry for immediate visual feedback.


## Evolved driving dynamics

Player physics uses a lightweight combined-grip model rather than independent steering/throttle/brake channels. Lateral demand consumes part of the longitudinal grip budget, so braking and accelerating while cornering are less effective. Simplified longitudinal load transfer sharpens front response under braking and reduces it under power; lateral recovery is progressive and rear stability changes with braking/throttle. This produces controllable understeer/oversteer tendencies, trail-braking consequences and cleaner-exit rewards without a full rigid-body tyre simulation. Garage modifiers remain layered into the base car constants.


## Camera, race completion, collisions and Garage coherence

The chase camera now uses a materially closer base framing (6.4 units, capped at 4.35 on compact landscape) with a lower camera height so the player car remains a dominant readable object. Race completion is gated by validated completed laps: a lap requires reaching the opposite half of the circuit and then crossing start/finish forward; raw accumulated progress alone can no longer trigger the results overlay. Car-to-car contacts use overlap correction plus relative closing velocity along the contact normal instead of multiplying both cars' speed on every overlap, reducing repeated bouncing and sticky side contact.

The Garage renders the same procedural F1 car construction used by the race branch, including the richer modern-F1 visual cues. Five labelled mounting zones make the drag target explicit and only the matching zone highlights during a drag; tap/click remains the mobile fallback.


## ChatGPT Work handoff

For a fresh ChatGPT Work session, start with `WORK-HANDOFF.md`. It is a compact operational entry point that links this wiki, the repository procedure and release checklist without duplicating the full architecture here.

## Race art, controls and persistent garage preview

`track-art.js` generates seeded asphalt/grass textures and circuit dressing:
painted track margins, rubber deposits, runoff, instanced kerbs/guardrails/trees,
low mountains and pit-straight structures. Candidate scenery locations are kept
away from adjacent road segments. These remain decorative, not new collision
objects. The race uses ACES tone mapping and one 1024 shadow map centered around
the player; track meshes receive car shadows. Wet asphalt has lower roughness.
The upper HUD markup and existing `style.css` are unchanged; lower control styles
are isolated in `race-controls.css`.

`steering.js` owns dead-zone shaping, exponential input smoothing and a
speed-sensitive yaw target. A touch starts at neutral wherever the thumb lands;
horizontal travel from that contact point requests steering. Only one pointer
owns the wheel, independently of the pedal pointers. Capture, cancellation,
lost capture, window blur and backgrounding clear held state. The visual wheel
rotates with the filtered command; yaw becomes zero at zero speed and reverses
in reverse gear. `node --test tests/steering.test.mjs` verifies the pure math.

The garage fills the available dynamic viewport. On desktop the configuration
pane scrolls beside the fixed car stage; portrait mobile uses a stage above a
separately scrolling setup pane. Selecting a part automatically frames that
assembly. Front/rear wing geometry, floor width/diffuser height, spring spacing
and caliper finish preview each setup family. These are representative visual
cues: mechanical effects still come from `garage-setup.js`. No change to storage
keys or setup effect values is made.
