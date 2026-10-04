# Engine audio

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

## 15. Audio

`core/client/race/race-audio.js` owns gear mapping and the synthesized engine/shift sound
(`setupRaceAudio({ getPhase, getThrottle })`), wired from `core/client/race/main.js`
through getters rather than shared module variables. The phase is "grid"
(car held on the line: idle, and the throttle free-revs towards launch
revs), "driving" (in-gear revs from the HUD's gear-relative ratio) or
"idle" (after the flag, `coolDown()`), so the engine is audible on the
grid before both qualifying and race start (#50; before that the engine
only sounded once the car was allowed to move, #10).
`core/client/race/race-hud.js` calls the returned `updateEngineSound`/
`playShiftClick`/`updateAmbientChorus` each frame. The engine sound is
synthesized with Web Audio rather than external audio assets.

Engine model (#50): a turbo V6 at 15,000 rpm redline fires 3 times per
revolution, so the fundamental is rpm/20 Hz (idle ~4,600 rpm ~230 Hz,
launch ~10,800 rpm, in-gear 9,800-12,400 rpm). Layers: a PeriodicWave with
28 harmonics for the firing tone plus an amplitude "lump" at low revs, a
sub (f/3) and half-order voice, band-passed combustion noise, a turbo
whistle, all through tanh saturation and a load/revs-driven low-pass. RPM
moves with inertia (fast rise, slower fall), and a fire-up sequence
(crank, flare, settle) plays when the engine is started.

Start procedure (#50), modeled on official F1:
- an "Avvia il motore" gate appears on load: Web Audio can only start
  after a user gesture, so the first key/tap fires the engine up and only
  then (1.2s later) the start sequence runs. `?agent=1` sessions skip it;
- qualifying: real F1 has no standing start in qualifying, the session
  opens at the pit-exit light, so a single light goes red -> green;
- race: five red lights come on one per second, then after a random hold
  (0.2-3s) all go out together — lights out is the start, there is no
  green. The grid chorus builds revs as the lights fill. In multiplayer
  the hold is seeded from the server's `raceStartedAt`, so all clients
  go out together (client clock skew is not compensated);
- no jump-start detection/penalty yet.

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

Audio initializes on the engine gate's user gesture to satisfy browser autoplay restrictions; it is suspended while the tab is hidden.
