# F1 Racer Roadmap

## Open Product Work

- Extend cockpit themes beyond the first color/badge layer if more personality
  is desired per friend.

## Technical Follow-Ups

- [#3](https://github.com/ottobit/f1-racer/issues/3) (ex-portfolio-arcade#143),
  closed: two incremental cuts landed — gear mapping and engine/shift-click
  audio to `race-audio.js` (#14); sky clouds, rain and impact sparks to
  `race-weather.js` (#16). `main.js` still owns scene/track-mesh
  construction, ghost-lap persistence and the qualifying/race state
  machines. No issue currently tracks extracting those — #3 had no fixed
  acceptance criteria and was closed once these two cuts felt like enough
  for now, not because the rest was ruled out. Open a new, scoped issue if
  `main.js` starts costing real time again; the general direction is the
  next bullet below, not this closed one.
- [#4](https://github.com/ottobit/f1-racer/issues/4) (ex-portfolio-arcade#144):
  resolved — see [tooling.md](tooling.md) for the documented patch/diff
  publishing workflow and its contents-API fallback.
- [#2](https://github.com/ottobit/f1-racer/issues/2) (ex-portfolio-arcade#172),
  **not closed — real-device measurement is still owed.** `graphics-profiles.js`
  (auto DPR/shadow/particle profile, no new UI) and `race-diagnostics.js`
  (dev-only FPS/`renderer.info` overlay) landed and cover the issue's
  activities #1 and part of #3. Not done: distant-scenery/reflection
  profile-awareness, Garage integration, and — the issue's actual
  acceptance bar — a measured before/after on a real smartphone and a real
  desktop. This dev environment has no real mobile hardware or GPU
  rendering, so that measurement can only happen on the user's own
  hardware; the PR stayed open for `Concludi` rather than auto-concluding
  for exactly this reason. Revisit this bullet once that pass happens.
- [#6](https://github.com/ottobit/f1-racer/issues/6) (ex-portfolio-arcade#173):
  `tools/validate-circuits.mjs` checks closure/winding/segment length/
  curvature/non-adjacent separation for every circuit and can write a
  top-down diagnostic SVG. All nine current circuits pass (Marzamemi's
  shared corridor as a documented warning, not an error) — it was the
  actual generation tool for #5's three new ones, not just a checker run
  after the fact.
- [#5](https://github.com/ottobit/f1-racer/issues/5) (ex-portfolio-arcade#152,
  revised from four new circuits/ten total down to three/nine — the
  real-map-based fourth is dropped from this issue, a future separate one
  if it happens): resolved. Added `pianalago`, `serramonte`, `baiadoro` —
  all procedurally generated and validated with #6's tool rather than
  hand-placed, all passing with zero issues. Every circuit in the roster
  now has a distinct width, 9 through 17. See `F1-RACER-WIKI.md`'s track
  system section for each one's identity.
- [#26](https://github.com/ottobit/f1-racer/issues/26): resolved. The three
  #5 circuits' first geometry was too smooth/round; reworked with a
  hairpin-insertion pass (same technique as Marzamemi's real corners) so
  each gains genuine tight corners while keeping a real (~15-18%) safety
  margin above the wall-margin curvature threshold, not a borderline pass.
  **Correction found in #28:** that margin is on the validator's smoothed
  5-sample stencil; the true spline apex is near-cusp (~1 unit radius on
  Serramonte/Baiadoro). Open, no issue yet: round those apexes and teach the
  validator true curvature, or accept V-shaped apexes as the design.
- [#28](https://github.com/ottobit/f1-racer/issues/28): welded kerbs and
  swept guardrails on every circuit, fold-free road edges, and the
  previously invisible runoff/painted lines (culled `ribbon()` winding) now
  render.
- Continue keeping `main.js` as orchestration and move reusable logic into
  focused modules only when it reduces real complexity.
- Keep setup effects centralized in `garage-setup.js`.
- Keep livery and cockpit theme data centralized in `driver-themes.js`.
- Keep car presentation details in `car-model.js`, `race-car-view.js`,
  `showroom.js` and garage-specific preview code.
- Update this LLM Wiki and `F1-RACER-WIKI.md` when architecture
  or user-facing decisions change.

## Manual Verification Notes

The user's current preferred verification loop is gameplay by hand. Automated
browser smoke tests should only be run when explicitly requested or when a
change is too risky to validate structurally.
