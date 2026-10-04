# F1 Racer runtime overview

Module map and source layout: [architecture.md](architecture.md). Rules for
new code: [oop.md](oop.md). This page covers only the frame loop and the
session phases.

## Main loop (`core/client/race/main.js`)

`main.js` is the race composition root. It builds the scene, the cars and the
world in one synchronous pass, then runs:

1. `dt = Math.min(clock.getDelta(), 0.1)`, so dt never exceeds 0.1 s.
2. `update(dt)`.
3. Scene, cloud and weather updates.
4. `renderer.render(scene, camera)`.

Each behaviour lives in its own `race/*.js` module (input, physics, AI,
progress, systems, HUD, camera, audio…). `main.js` still wires them together,
and at ~1,800 lines it is the biggest maintainability risk.

## Session phases

`sessionPhase` is `"qualifying"` then `"race"`.

- **Qualifying.** It starts behind the "Avvia il motore" gate, then a single
  pit-exit light goes red → green. The session lasts 60 s
  (`QUALIFYING_DURATION_MS`, `core/shared/circuits.js`), and the best
  completed lap counts. In solo play the rivals' times are synthesized
  ([race-systems.md](race-systems.md)).
- **Race.** Standing start with five lights, a random hold and lights out
  ([audio.md](audio.md#start-procedure)), then the race until the result.
- Player motion integration is the same in both phases.
- In multiplayer the server's clock switches the phases
  ([multiplayer-protocol.md](multiplayer-protocol.md)).

## Known limitations

- Gameplay code still queries and updates DOM elements directly.
- There are no automated gameplay or browser tests. The user verifies by
  playing on `master`, and the Node tools only check data (circuits, free
  oval, boundaries).
