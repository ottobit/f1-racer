---
type: entity
updated: 2026-10-04
sources: []
---

# Engine audio and start procedure

## Engine (`core/client/race/race-audio.js`)

All engine sound is synthesized with Web Audio; there are no audio files.

- `setupRaceAudio({ getPhase, getThrottle, engine, field })` is wired from
  `main.js` through getters. Each frame, `race-hud.js` calls the functions it
  returns: `updateEngineSound`, `playShiftClick` and `updateAmbientChorus`.
- `getPhase()` returns one of three phases:
  - `"grid"`: the car is held on the line and the throttle free-revs;
  - `"driving"`: the revs follow the gear-relative ratio;
  - `"idle"`: after the flag, `coolDown()`.
  The engine is audible on the grid before both qualifying and the race (#50).
- One engine profile per car (#319, `engineProfile(id)`).
  - Each profile sets idle, launch, redline, firings per revolution, gear
    spread, harmonic wave shape and mix levels.
  - The F1 profile is a 1.6 V6 turbo-hybrid: idle ~4,600 rpm, launch
    ~10,800 rpm, 9,800–12,400 rpm through each gear.
  - The road cars have their own revs, timbre and 4- or 5-speed gearbox.
- Sound layers:
  - a PeriodicWave for the firing tone;
  - a sub voice and a half-order voice;
  - band-passed combustion noise;
  - a turbo whistle on the F1 only;
  - tanh saturation, a low-pass driven by load and revs, and a compressor.
  RPM has inertia, and a fire-up sequence (crank, flare, settle) plays at
  start.
- Grid chorus: two cheap detuned voices stand in for the other cars. Their
  volume grows with how many rivals are near the player (at most 6 counted)
  and with their speed (#10).
- Audio starts from the engine gate's user gesture and is suspended while
  the tab is hidden.

## Start procedure

The start follows official F1 rules (#50, `main.js`):

- An "Avvia il motore" gate appears on load. Web Audio needs a user gesture,
  so the first key or tap fires up the engine, and the sequence starts 1.2 s
  later. `?agent=1` sessions skip the gate.
- **Qualifying:** one pit-exit light turns red, then green.
- **Race:**
  - five red lights come on one per second;
  - after a random hold of 0.2–3 s, they all go out;
  - lights out is the start, and there is no green.
- In multiplayer the hold is seeded from the server's `raceStartedAt`. Client
  clock skew is not compensated.
- `startSequenceId` cancels the timers of a sequence that has been replaced.
- There is no jump-start detection.
