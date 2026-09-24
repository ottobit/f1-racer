# F1 Racer — Release Checklist

## Purpose

Manual regression checklist for the static browser release of F1 Racer. The project has no CI/browser automation configured, so these checks are the release gate until a browser test harness is introduced.

## Static/source checks

- [x] `main.js` loads Three.js from the configured CDN.
- [x] `race.html` references `main.js` and `style.css`.
- [x] HUD element IDs referenced by `main.js` exist in `race.html`.
- [x] Current physics state fields are initialized and reset on grid placement.
- [x] AI state fields are initialized and reset on grid placement.
- [x] Race systems (tyres, ERS, pit state) are represented in the wiki.
- [x] Solo/local play (menu → garage → qualifying → race) has no backend/server dependency — verify this still holds with the room server unreachable or not running at all (#36 intentionally introduced one, opt-in, for multiplayer only; see the dedicated section below).
- [ ] `node tools/validate-circuits.mjs` passes for every circuit (no `ERROR` lines) whenever `circuits.js` changed — see #6.

## Browser smoke test — desktop

Run one complete pass on a current Chromium/Firefox/Safari browser.

1. [ ] Open the F1 Racer menu.
2. [ ] Select each difficulty once.
3. [ ] Open each available circuit.
4. [ ] Confirm the page renders without a blank canvas.
5. [ ] Confirm the "Avvia il motore" gate appears, a key/tap fires the engine up (audible idle), then the pit-exit light turns red -> green and the qualifying session is 60 seconds.
6. [ ] Drive at least one complete qualifying lap.
7. [ ] Confirm a qualifying time is recorded.
8. [ ] Let qualifying finish and confirm a 10-car grid is produced.
9. [ ] Confirm the race start: five red lights one per second, random hold, all out together (no green); all cars frozen until lights out; throttle on the grid revs the engine.
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
5b. [ ] Home on a phone: tap the carousel arrows/dots quickly several times — the page must not zoom; if the page is pinched in, pinching out over the carousel returns it to normal scale; horizontal swipe still changes circuit (#32).
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
- [ ] Verify the player's own engine is audible while actually driving a qualifying lap, not just during the race (#10).
- [ ] Verify a hint of the other cars' engines is audible at the race standing start (grid bunched together) and thins out as the pack spreads around the lap (#10).
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

### Garage mobile restyle / driver livery (#30)

- [x] No livery picker; the car wears the selected driver's team colours in the Garage and in the race (headless check: Vivian Wendy → blue Nettuno in both, zero console errors).
- [x] An old save containing `livery` and an invalid variant loads cleanly: valid parts kept, invalid one falls back to balanced.
- [x] 390×844 and 360×740 portrait: one page scroll (no nested scroll box), car pinned on top, "Scegli il circuito" pinned at the bottom, no horizontal scroll, no touch target under 44px.
- [x] 844×390 and 740×360 landscape: two columns, car fully visible, setup pane scrolls on the right with the CTA pinned.
- [x] The 3D canvas fills its box at DPR 2 (it used to render at device-pixel size and show a cropped corner on every high-DPR phone).
- [ ] On a real phone: sticky car/CTA behave with the browser toolbar showing and hiding; safe-area insets on notched phones in landscape.
- [ ] Desktop Garage layout unchanged apart from the removed picker.


## Driving dynamics regression

- [ ] Compare braking in a straight line vs braking while steering: combined braking/cornering must require more distance and feel less planted.
- [ ] Enter a corner under braking: turn-in should sharpen while excessive combined demand can loosen stability progressively, not snap instantly.
- [ ] Accelerate before unwinding steering: traction/acceleration should be weaker than on a straight exit.
- [ ] Release steering after a slide: lateral motion should recover progressively rather than snap to zero.
- [ ] Verify keyboard and touch steering remain controllable at low and high speed.
- [ ] Verify Garage setup effects still alter the evolved physics after a reload.


## Camera / finish / collision / Garage coherence

- [ ] Chase view: player car is substantially larger/closer on desktop and compact landscape without clipping the camera.
- [ ] Complete fewer than the configured race laps: results overlay must never appear.
- [ ] A lap only increments after reaching mid-circuit and crossing start/finish forward.
- [ ] Complete exactly all configured laps: results appear once after the final valid crossing.
- [ ] Side-by-side rubbing does not repeatedly remove a fixed percentage of both cars' speed.
- [ ] Nose-to-tail contact separates cars and transfers speed progressively without repeated bouncing.
- [ ] Garage car silhouette/details match the race car model closely.
- [ ] Drag each of the five component families: only its matching mounting zone highlights and accepts the drop.
- [ ] Touch/click mounting still works without drag-and-drop.

## Atelier visual upgrade regression

- [ ] Inspect the sculpted car, studio reflections, contact shadows and platform on desktop and a real mobile GPU.
- [ ] Check all four camera presets at desktop, portrait mobile and landscape sizes.
- [ ] Orbit with mouse/touch; release, pointer cancellation and a second touch must not leave dragging stuck.
- [ ] Toggle 360°; reduced-motion users must not get automatic movement.
- [ ] Select all 15 setup variants; reload to verify persistence and stat bars.
- [ ] Drag each component family to its matching target; reject a different target.
- [ ] Verify keyboard focus and pressed state on view, paint and setup buttons.
- [ ] Load a dry and wet race with the shared model; check wheels, opponents and ghost transparency.
- [ ] Measure frame time on an actual phone with all ten cars visible. Software rendering is not a mobile performance benchmark.

### Validation record — Atelier branch

- PASS: Node syntax parsing for every F1 Racer JS module; `git diff --check`.
- PASS: imported `car-model.js` against actual Three.js r160 in Node; both detail
  levels construct successfully with finite vertex positions/normals, four wheel
  groups, scaled wheel radius and named wing assemblies. Canvas is stubbed only
  for the carbon texture: this does not validate texture rendering.
- PASS: material isolation between separate cars (ghost opacity cannot mutate
  another car). Geometry counts: race 29 meshes / 10,792 triangles; showroom 203
  meshes / 23,456 triangles. These counts are not measured frame rates.
- PASS (follow-up): Chromium headless 151 installed from the alternative Chrome
  for Testing distribution. Actual WebGL rendering via SwiftShader, no page or
  console errors observed in the exercised flow. Three.js CDN requests were
  fulfilled with the downloaded exact r160 module to isolate CDN networking.
- PASS: desktop garage rendering, all 15 component variants and localStorage
  values, reload selection, camera presets, paint and rotation button states,
  mouse orbit, matching/mismatching synthetic native drop events.
- PASS: mobile emulation at 390x844, no horizontal overflow, tap view/setup
  selection and landscape rendering at 844x390. Visual inspection exposed a
  clipped front wing in portrait; camera distance was increased accordingly.
- PASS: race initialization, rendered canvas/countdown and short keyboard input /
  camera-switch smoke without observed runtime errors. This is not a full race.
- NOT TESTED: real-device multitouch/cancel gestures, full qualifying-to-result
  and championship regression, wet-race regression, hardware GPU/mobile FPS.
  Software-rendered headless screenshots cannot certify actual device performance.

## Race art / steering / persistent preview regression

- [ ] Upper HUD DOM and original shared stylesheet remain unchanged.
- [ ] Dry/wet circuits render with textured road, clear margins and no shader errors.
- [ ] Shadow follows the player; scenery does not conceal the drivable road.
- [ ] First thumb contact anywhere on the wheel produces no steering jump.
- [ ] Drag through neutral in both directions with throttle held by a second finger.
- [ ] Pointer cancel/lost capture, blur and hidden tab release pedals and wheel.
- [ ] Car cannot pivot while stopped; reverse steering reverses yaw.
- [ ] Keyboard direction transitions are progressive and high-speed inputs are reduced.
- [ ] Portrait and landscape garage keep the entire car preview visible while scrolling to suspension.
- [ ] Selecting all five component families frames the piece and shows the appropriate cue.
- [ ] Setup persists after reload; the top stage does not scroll away with components.
- [ ] Full qualifying/race progression, real iOS/Android multitouch and GPU performance.

### Validation — three-task upgrade

PASS: all JS modules parse; diff whitespace check; four Node steering tests
(dead zone/symmetry, 30/60/120Hz smoothing, release/reversal, stationary/reverse/
high-speed yaw). Upper HUD markup and original shared race stylesheet match
master byte-for-byte.

PASS: Chromium 151 with SwiftShader, exact downloaded Three.js r160 served in
place of the CDN. Portrait 390x844 and landscape 844x390 keep the car stage
visible while the last setup controls are selected; selected values persist to
localStorage. A mobile grid-column regression found in the first screenshot
was fixed and both sizes rechecked.

PASS: dry and wet circuit initialization/rendering, no observed JS/console
errors. CDP touch events exercised two fingers simultaneously: first wheel
contact stays neutral, drag steers while gas remains held, touchCancel clears
both, window blur clears keyboard input. Screenshots inspected. Browser probes
are injected only by the test server, never shipped in production.

NOT TESTED: physical iPhone/Android gestures and frame rates; full qualifying,
three-lap race and championship completion. The graphics use software rendering
in this environment, so no hardware performance claim is made.

## Performance / graphics profiles regression

- [ ] Normal play (no `?diag`/`?gfx` param): no diagnostics overlay appears anywhere, on desktop or mobile.
- [ ] `?diag=1` shows a small top-left FPS/frame-time/draw-call overlay; `?diag=0` removes it and it stays off on the next load.
- [ ] `?gfx=low`, `?gfx=medium`, `?gfx=high` each visibly change render sharpness/shadow presence without changing car handling, track width, wall/runoff behaviour or AI pace.
- [ ] Loading the race with no `?gfx` param picks a profile automatically (visible via `?diag=1`'s `gfx:` label) and that choice persists across circuits/sessions until changed.
- [ ] Home-screen session setup panel is unchanged (still exactly difficulty + driver, no new control).
- [x] Garage now applies the same `?gfx=` profile to its own renderer (DPR cap, shadow map) and the same `?diag=1` overlay — verified in headless Chromium at low/medium/high (distinct canvas backing sizes at a high device pixel ratio) and diag on/off, zero console errors.
- [ ] **Real-device measurement — not yet done from this dev environment (no real mobile hardware or GPU rendering here).** Left for the user: FPS/frame time with `?diag=1` on a real smartphone and a real desktop, race scene with all ten cars plus rain, and the Garage (now that it has the same overlay), before/after any further graphics-profile tuning.

## New circuits regression (#5: pianalago, serramonte, baiadoro)

- [ ] `node tools/validate-circuits.mjs` reports 0 errors for all nine circuits (Marzamemi's documented warning is expected).
- [ ] All three new circuits appear in the home carousel with a correctly shaped map, and are reachable by swipe/arrow/keyboard/dot navigation.
- [x] Open the browser console and click through every carousel slide (all nine, not just the new three): zero errors. Any circuit id missing from `menu.js`'s `CIRCUIT_PERSONALITY` table degrades to `DEFAULT_PERSONALITY` for that slide instead of throwing and blanking the whole carousel (#24) — checked with a real headless-browser pass, not just a code read.
- [ ] Drive at least one qualifying + race session on each of the three: grid placement, walls/runoff, AI lines and lap/finish detection all behave normally (no car stuck off-track, no wall clipped through).
- [ ] Each circuit's Garage-recommended setup shows correctly and differs meaningfully from the others' (frontWing/rearWing/floor/brakes/suspension combo, not just the reason text).
- [ ] Championship standings correctly include results from the three new circuits alongside the existing six.

### Sharpened geometry regression (#26: real corners/hairpins added)

- [ ] `node tools/validate-circuits.mjs` still reports 0 errors for pianalago/serramonte/baiadoro after the hairpin-insertion rework (points and `curveTension: 0.5` changed for all three).
- [x] Local curvature-radius margin above each circuit's wall margin re-checked numerically (not just "validator passes"): pianalago +15%, serramonte +18%, baiadoro +17% — verified deliberately non-borderline before accepting.
- [ ] Drive each of the three at the new sharper corners specifically: AI cars take the hairpins without clipping the wall or getting stuck, kerb/runoff still renders correctly at the tighter apex, no visible geometry glitch (self-crossing road ribbon, minimap spike) at the inserted approach/apex/exit points.

## Track dressing regression (#28: welded kerbs, swept guardrails)

- [x] Kerbs are continuous on every circuit — no gaps, wedges or X-crossings at hairpin apexes (headless before/after screenshots of Serramonte's tightest corner, top and low views).
- [x] No flipped/folded triangles in any road-hugging strip (road, each kerb band, runoff, painted lines) on all nine circuits — counted numerically on the 1440-sample render centerline with `offsetEdge`.
- [x] Real `race.html` loads with zero console errors on Serramonte, Marzamemi, Portoscuro (wet) and Vallechiara in headless Chromium.
- [ ] On a real device: runoff band and white track-limit lines visible along the whole lap, with no flicker/shimmer against the grass at distance; road never disappears under the grass at low camera angles.
- [ ] Guardrails: continuous where present, none crossing each other where two legs run close; posts sit on the rail.
- [ ] Marzamemi: kerb look unchanged apart from the sand runoff shoulder, which is now actually visible.
- [ ] Load time on a phone not noticeably worse (denser road/kerb meshes plus fold resolution run once at scene setup).

## Multiplayer Stage 1 regression (#36, part of #1: rooms, driver reservation)

- [x] Solo flow (home → difficulty/driver → circuit → race with 9 AI) works identically whether or not `server/room-server.mjs` is running — verified with the room server stopped entirely, zero console errors.
- [x] Home page links to `room.html` — **superseded by #40/#38**: multiplayer is now one of the two dominant `home-command` cards (Garage + "Corri in multiplayer"), not a secondary entry; the solo circuit shortcut was removed outright per user request. See `decisions.md`'s "Home and Circuit Selection" section for the full history.
- [x] Two real headless-browser clients against a real local `room-server.mjs`: create room → 4-char code; join with that code; both see each other via live `room_state` broadcast.
- [x] A driver reservation by one participant is broadcast live and disables that driver for the other participant; reserving an already-taken driver is rejected with a clear error.
- [x] Non-host `start_race` is hidden/rejected; host `start_race` began qualifying in Stage 1's own testing — **superseded by Stage 2 (#44, see the dedicated section below)**, where `start_race` now requires a chosen circuit and every participant ready, and genuinely begins a synced qualifying session instead of a bare confirmation.
- [x] Reloading a page resumes the same room/participant via the saved `f1racer-room-session-v1` session, without creating a duplicate participant.
- [x] `server/rooms.mjs`'s pure functions verified directly (no socket): atomic driver reservation (exactly one of two concurrent reservations wins), grace-period retention of a disconnected participant's driver, reconnect before expiry reclaims it, expiry after the grace window releases it and rejects a later reconnect, host handoff to the longest-connected remaining participant, room deletion once empty, 11th join into a full room rejected, `toPublicRoom()` never includes `reconnectToken` or a live timer handle.
- [ ] On a real phone: create/join a room, reserve a driver, background the tab/lock the screen, come back — confirm reconnect behaves as expected on a real mobile browser/network (not just two sandbox browser contexts on one machine).
- [x] Two genuinely separate devices/networks can create/join the same room over `wss://` — verified 2026-09-23 by the user with a real phone and a real PC, room server tunneled through `ngrok http` (not Render yet, but the same `wss://` path); live driver reservation and "pronto" state confirmed on both. Render itself (cold start, connection limits under its plan) remains unverified.

## Multiplayer Stage 2 regression (#44, part of #1: qualifying/race sync)

- [x] Solo flow (home → difficulty/driver → circuit → race with 9 AI) still works identically without `?room=` in the URL — verified in a real headless browser: no page errors, qualifying marker/tower/synthesized 9-AI-rival list all present, acceleration responds after the grid countdown. `main.js`'s multiplayer branches are all gated on a single `multiplayer` variable that's `null` for this path.
- [x] Host picks circuit + difficulty in the room lobby (new UI in `room.html`); "Avvia" is disabled until a circuit is chosen AND every participant has both reserved a driver and ticked "Pronto" — verified via `rooms.mjs`'s direct function checks (12/12) and in a real two-browser-context session.
- [x] Starting the room navigates **both** participants' tabs to `race.html` with the same `circuit`/`difficulty`/`room` query params — verified in a real two-context Playwright session (not just the host).
- [x] Qualifying is timed server-side (`ROOM_QUALI_MS`, default 60s) — every client transitions to racing together off the server's own timer, not each browser's local countdown; verified with a real two-context session using a short override.
- [x] The race grid is computed from real reported qualifying lap times (fastest first, a participant with no time sent to the back, same DNF rule solo already used) — verified directly against `rooms.mjs` and in the real browser session (grid order reflected in both clients' race position).
- [x] A remote participant's car is visible and moving on the other client's screen during both qualifying and the race, driven by network position broadcasts (`car_state`), not AI — verified via a real two-context session (nameplate visible, race position tower lists both cars, live classification).
- [x] A participant who disconnects mid-race has their car freeze in place (no more broadcasts arrive) and their entry visibly greys out — both the on-track nameplate and the race position tower — once the existing Stage 1 grace window expires; verified in a real two-context session (closed one context, confirmed both effects on the remaining client).
- [x] Multiplayer race results skip the solo championship entirely (no points recorded, no next-unraced-circuit chain) — confirmed by code review of `finishRace()`'s multiplayer branch; not yet observed by actually reaching a multiplayer finish line in a live test (see below).
- [ ] A full multiplayer race actually being driven to its final lap and finishing — this session's real-browser tests verified qualifying → racing transition and live sync, but stopped short of playing out `LAPS_PER_RACE` laps end to end (would need sustained scripted driving matching each circuit's actual line, not just holding the accelerator). Worth doing once by hand before relying on this in front of real friends.
- [ ] Real phones/networks for Stage 2 specifically (Stage 1's #36 real-device verification above predates qualifying/race sync) — this session's Stage 2 testing reused the same sandbox two-browser-context method as the rest of Stage 1/2, not two real separate devices.
- [ ] Collision behavior between a local car and a remote (network-driven) car hasn't been visually checked — `carCollisions.resolve()` runs unchanged over remote cars too (see `architecture.md`), which can nudge a remote car's position for a frame before the next network sample overwrites it; expected to be a harmless, brief visual jitter, not verified by eye.
