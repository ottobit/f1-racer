# F1 Racer Roadmap

## Open Product Work

- Extend cockpit themes beyond the first color/badge layer if more personality
  is desired per friend.

## Technical Follow-Ups

- [#1](https://github.com/ottobit/f1-racer/issues/1) / [#36](https://github.com/ottobit/f1-racer/issues/36) /
  [#44](https://github.com/ottobit/f1-racer/issues/44),
  **closed — voice landed in #62 (P2P WebRTC mesh, race only, no TURN).** #1 itself demanded staged
  delivery (rooms, then race sync, then voice, each its own PR). #36
  (rooms/driver reservation) and #44 (qualifying/race sync, client-
  authoritative, host picks circuit/difficulty, no AI padding) are both
  built and verified — see `F1-RACER-WIKI.md`'s "Multiplayer" section and
  `architecture.md`'s matching sections for the module map and protocol.
  This is the project's first-ever backend (`core/server/rooms.mjs` +
  `core/server/room-server.mjs`); the shipped static site itself (race/garage/
  menu) is untouched for a normal solo session and still has zero server
  dependency on its own. Explicitly still out of scope: voice/WebRTC/SFU,
  and — for #44 specifically — a multiplayer race actually driven to its
  finish line in a real test (qualifying→racing transition and live sync
  are verified; the finish line isn't, see `RELEASE-CHECKLIST.md`). The
  user chose **Render** for hosting when it's time to go live (already used
  it before, plans to self-ping the free tier to avoid its 15-minute sleep
  — flagged to them that the free tier's ~750 free instance-hours/month is
  close to what a 24/7 self-pinged service would consume on its own, so it
  may tip into billing or need the paid Starter tier depending on other
  usage on the account; not something to solve from inside this repo), and
  on 2026-09-23 verified real cross-device `wss://` reachability themselves
  (a real phone + a real PC through an `ngrok http` tunnel, not Render
  itself yet) — see `decisions.md`. `RELEASE-CHECKLIST.md`'s former blanket
  "no backend/server dependency" release gate has been scoped to solo/local
  play accordingly — see that file.
- [#8](https://github.com/ottobit/f1-racer/issues/8): resolved by PR #9,
  merged well before this bullet was written. It stayed open because "Chiude
  #8" (Italian) in the PR body doesn't trigger GitHub's auto-close keyword
  parsing — English "Closes #N" is required, a lesson this wiki already
  recorded once for issue-closing comments and evidently missed for a PR
  body. `core/client/race/agent-api.js` / `window._ENVIRONMENT_` — see `F1-RACER-WIKI.md`'s
  Agent API section. Independently re-verified in a real headless browser
  before closing (not just re-reading the code): state snapshot shape,
  mutation isolation, input clamping, concurrent-step rejection, and that a
  step neutralizes its own inputs.
- [#3](https://github.com/ottobit/f1-racer/issues/3) (ex-portfolio-arcade#143),
  closed: two incremental cuts landed — gear mapping and engine/shift-click
  audio to `core/client/race/race-audio.js` (#14); sky clouds, rain and impact sparks to
  `core/client/race/race-weather.js` (#16). `core/client/race/main.js` still owns scene/track-mesh
  construction, ghost-lap persistence and the qualifying/race state
  machines. No issue currently tracks extracting those — #3 had no fixed
  acceptance criteria and was closed once these two cuts felt like enough
  for now, not because the rest was ruled out. Open a new, scoped issue if
  `core/client/race/main.js` starts costing real time again; the general direction is the
  next bullet below, not this closed one.
- [#4](https://github.com/ottobit/f1-racer/issues/4) (ex-portfolio-arcade#144):
  resolved — see [tooling.md](tooling.md) for the documented patch/diff
  publishing workflow and its contents-API fallback.
- [#2](https://github.com/ottobit/f1-racer/issues/2) (ex-portfolio-arcade#172),
  **still not closed — real-device measurement is still owed.**
  `core/client/shared/graphics-profiles.js` (auto DPR/shadow/particle profile, no new UI) and
  `core/client/race/race-diagnostics.js` (dev-only FPS/`renderer.info` overlay) landed and
  cover the issue's activities #1 and part of #3. Garage integration
  (second pass): `core/client/garage/showroom.js`/`core/client/garage/garage.js` now read the same profile and
  drive the same diagnostics overlay the race does, so the "misurare...
  garage" activity is coverable and the DPR/shadow gap between the two
  scenes is closed. Deliberately still not done: distant-scenery/reflection
  profile-awareness — the issue's own method is measure-first
  ("annotare i colli di bottiglia reali prima di ottimizzare"), and with no
  real bottleneck data, tuning either would be a guess dressed up as a
  profile, not a finding. And — the issue's actual acceptance bar — a
  measured before/after on a real smartphone and a real desktop. This dev
  environment has no real mobile hardware or GPU rendering (confirmed again
  while wiring the Garage overlay: headless/software rendering here needed
  ~15 real seconds to accumulate one 0.5s FPS sample, useless as a
  performance signal), so that measurement can only happen on the user's
  own hardware; the PR stayed open for `Concludi` rather than
  auto-concluding for exactly this reason. Revisit this bullet once that
  pass happens.
- [#6](https://github.com/ottobit/f1-racer/issues/6) (ex-portfolio-arcade#173):
  `core/tools/validate-circuits.mjs` checks closure/winding/segment length/
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
- [#30](https://github.com/ottobit/f1-racer/issues/30): Garage restyled for
  phones (portrait single scroll, landscape two columns), livery picker
  removed in favour of the selected driver's team colours.
- [#28](https://github.com/ottobit/f1-racer/issues/28): welded kerbs and
  swept guardrails on every circuit, fold-free road edges, and the
  previously invisible runoff/painted lines (culled `ribbon()` winding) now
  render.
- Continue keeping `core/client/race/main.js` as orchestration and move reusable logic into
  focused modules only when it reduces real complexity.
- Keep setup effects centralized in `core/client/shared/garage-setup.js`.
- Keep livery and cockpit theme data centralized in `core/client/shared/driver-themes.js`.
- Keep car presentation details in `core/client/shared/car-model.js`, `core/client/race/race-car-view.js`,
  `core/client/garage/showroom.js` and garage-specific preview code.
- Update this LLM Wiki and `F1-RACER-WIKI.md` when architecture
  or user-facing decisions change.

## Manual Verification Notes

The user's current preferred verification loop is gameplay by hand. Automated
browser smoke tests should only be run when explicitly requested or when a
change is too risky to validate structurally.
