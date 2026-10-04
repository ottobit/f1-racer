# F1 Racer runtime overview

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

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
- engine fire-up gate, then pit-exit light red -> green (#50);
- solo player driving;
- a 60-second session;
- multiple flying laps;
- best lap time;
- synthesized AI qualifying times;
- grid ordering.

Race has:
- F1 standing start: five red lights, random hold, lights out (#50);
- racing;
- finished state.

The same player-motion integration is shared between qualifying and racing.

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
