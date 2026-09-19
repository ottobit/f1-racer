# F1 Racer — Release Checklist

## Purpose

Manual regression checklist for the static browser release of F1 Racer. The project has no CI/browser automation configured, so these checks are the release gate until a browser test harness is introduced.

## Static/source checks

- [x] `games/f1-racer/main.js` loads Three.js from the configured CDN.
- [x] `race.html` references `main.js` and `style.css`.
- [x] HUD element IDs referenced by `main.js` exist in `race.html`.
- [x] Current physics state fields are initialized and reset on grid placement.
- [x] AI state fields are initialized and reset on grid placement.
- [x] Race systems (tyres, ERS, pit state) are represented in the wiki.
- [x] No backend/server dependency was introduced.

## Browser smoke test — desktop

Run one complete pass on a current Chromium/Firefox/Safari browser.

1. [ ] Open the F1 Racer menu.
2. [ ] Select each difficulty once.
3. [ ] Open each available circuit.
4. [ ] Confirm the page renders without a blank canvas.
5. [ ] Confirm the qualifying countdown starts and the qualifying session is 60 seconds.
6. [ ] Drive at least one complete qualifying lap.
7. [ ] Confirm a qualifying time is recorded.
8. [ ] Let qualifying finish and confirm a 10-car grid is produced.
9. [ ] Confirm the race countdown freezes all cars until GO.
10. [ ] Confirm grid-position digits face toward the start/finish direction.
11. [ ] Drive one clean lap and verify position/lap/time HUD.
12. [ ] Confirm gear/speed instrument panel is centered at the top and does not overlap left/right HUD.
12. [ ] Verify steering works at low and high speed.
13. [ ] Verify lateral/slip telemetry changes in corners.
14. [ ] Verify gear/shift lights and engine audio respond to speed.
15. [ ] Verify DRS can activate when eligible.
16. [ ] Verify ERS toggles with `E` and charge drains/recharges.
17. [ ] Verify tyre selection with `1`/`2`/`3` before the race.
18. [ ] Verify tyre grip changes with distance.
19. [ ] Verify pit service can be triggered with `P` at low speed in the pit zone.
20. [ ] Verify pit service resets tyre wear, restores ERS and reduces damage.
21. [ ] Verify AI cars follow corners, brake before turns and can change line around traffic.
22. [ ] Verify hard impacts produce damage, sparks and player camera shake.
23. [ ] Verify wet circuits show rain and reduced grip.
24. [ ] Finish the race and verify classification and points.
25. [ ] Continue to the next circuit.
26. [ ] Complete the championship and verify final standings.
27. [ ] Reload and confirm championship persistence.
28. [ ] Reload a circuit and confirm the best-lap ghost still works.

## Browser smoke test — mobile/touch

1. [ ] Open the race on a touch device.
2. [ ] Confirm gas/brake controls are visible.
3. [ ] Confirm the steering wheel is draggable and analog.
4. [ ] Repeated tap, double-tap and pinch on the race canvas must not zoom or move the browser viewport.
5. [ ] Confirm steering drag and simultaneous gas/brake touches do not trigger browser zoom/gesture handling.
6. [ ] Rotate to landscape and accelerate to high speed: the chase camera must keep the player car prominently readable and must not progressively shrink it.
7. [ ] Confirm HUD remains readable without covering the controls.
8. [ ] Confirm race rendering remains responsive.
9. [ ] Confirm cockpit/chase camera toggle still works where a keyboard is available.
10. [ ] Confirm results overlay is usable on a short viewport.

## Release criteria

A release is considered ready when:
- no blank/uncaught runtime error appears during the smoke test;
- qualifying → grid → race → result flow completes;
- championship persistence works;
- desktop and touch controls both remain usable;
- the new physics/race systems do not prevent completing a clean race.

## Known test limitation

This repository currently has no automated browser/physics test runner and no GitHub Actions release gate. Source-level assertions can catch wiring regressions, but they cannot replace a real browser smoke test for rendering, controls, audio and gameplay feel.


## Runoff / audio / home regression

- [ ] Drive across a kerb and beyond the asphalt: the car must slow progressively but remain movable; no invisible hard stop at the old track-width wall limit.
- [ ] Verify engine note rises through each gear, drops on shifts, and remains free of obvious clipping/distortion on desktop and mobile.
- [ ] Verify the F1 Racer home shows the new hero, difficulty, standings and circuit sections, and that difficulty/circuit/championship interactions still work.


## Garage regression

- [ ] Home Garage entry opens `garage.html` and Back returns to F1 Racer.
- [ ] Car is visible and rotates 360° with pointer/touch drag.
- [ ] Every component variant can be mounted by drag-and-drop on desktop and click/tap fallback on touch devices.
- [ ] Selected setup survives page reload via localStorage.
- [ ] Live Speed/Downforce/Braking/Stability/Traction bars react to setup changes.
- [ ] Front/rear wing variants visibly change wing geometry in the Garage.
- [ ] Start a race after changing setup and verify top speed, braking, turn authority/stability, traction and runoff behaviour respond to the relevant choices.
- [ ] Balanced setup remains close to the pre-Garage baseline and no variant is a universal upgrade.
