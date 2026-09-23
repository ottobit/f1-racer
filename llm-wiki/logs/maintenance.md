# Maintenance Log

Append-only. One short entry per wiki update, newest last.

## 2026-09-23 — Developer tooling: patch-based publishing (#4)

Added `wiki/f1-racer/tooling.md`, documenting two publishing paths: local
git clone (patch-based by construction, the default for Claude Code
sessions on this repo) and contents-API-only fallback (full-file, SHA-
gated, for shell-less sessions such as ChatGPT Work). Updated `index.md`
and `roadmap.md` to link it and to point the migrated #143/#144 references
at the current `ottobit/f1-racer` issue numbers (#3/#4) instead of the
stale `portfolio-arcade` ones. Added a short pointer in `WORK-HANDOFF.md`
so a shell-less session reads the fallback rules before writing files.

## 2026-09-23 — Extract race-audio.js from main.js (#3)

First incremental cut of #3 (ex-portfolio-arcade#143): moved gear mapping
(`gearInfo`) and the synthesized engine/shift-click Web Audio out of
`main.js` into a new `race-audio.js` (`setupRaceAudio`). The only real
coupling was `main.js`'s `raceState` module variable used to gate engine
volume; inverted it into an injected `getRaceState()` getter instead of
sharing state across modules, following the same pattern already used by
`setupRaceCommands`. `race-hud.js`'s consumption (`gearInfo`,
`updateEngineSound`, `playShiftClick`) is unchanged. Updated
`F1-RACER-WIKI.md` §2/§15 and `architecture.md` to reflect the new module
boundary; `main.js` still owns everything else roadmap.md lists as open
under #3.

## 2026-09-23 — Circuit geometry validator (#6)

Extracted the pure centerline-sampling/query rules from `main.js` into
`track-geometry.js` (framework-agnostic: takes a curve object rather than
importing three.js, so the exact same rules run in the browser and in
Node). Added `tools/validate-circuits.mjs`, a Node script checking every
`circuits.js` entry for closure, winding, segment length, curvature (vs.
the runtime's own wall margin — same formula as `WALL_LIMIT`) and
non-adjacent separation, plus an optional `--svg` top-down diagnostic
preview (gitignored `tools/out/`, dev-only, never shipped). It uses the
real npm `three@0.160.0` (pinned to the CDN version `main.js` loads) as a
devDependency — first `package.json`/`package-lock.json` in this repo,
dev tooling only, no build step or bundler added to the shipped site.

All six existing circuits pass; Marzamemi's known shared coastal corridor
is a documented warning (a floor, not a blanket exemption) rather than an
error. Verified the checks actually catch broken geometry against three
adversarial cases (near-duplicate closure points, a self-crossing figure-
eight, two legs pushed pathologically close with no allowlist entry) before
trusting the "all circuits pass" result. Practical dependency for #5 (four
new circuits).

Also corrected two stale claims found while in this area: `circuits.js`'s
header referenced "the project's dev notes" for a validation script that
never existed until now (updated to point at the real one), and
`F1-RACER-WIKI.md` claimed `tests/steering.test.mjs` verifies steering
math — no `tests/` directory exists anywhere in this repo's git history
(confirmed via `git log --all`), so that either never carried over from
the `portfolio-arcade` extraction or was always aspirational. Noted as a
real gap rather than removed silently.

## 2026-09-23 — Surface the publish rule in procedure.md (#12)

`procedure.md` is the first file every session reads, so `tooling.md`'s
Path A rule (local clone → always git diff/commit/push, never the contents
API) was invisible unless a session also opened the wiki. Added a short
"Regole di pubblicazione" section in `procedure.md` stating the rule and
linking `tooling.md`, and noted explicitly that the rule is scoped to this
repository — a durable cross-project version would need an account-level
Claude preference, which this repo cannot set.

## 2026-09-23 — Extract race-weather.js from main.js (#3)

Second incremental cut of #3, same pattern as `race-audio.js`: sky cloud
billboards, the rain particle field and impact spark FX moved out of
`main.js` into `race-weather.js` (`setupRaceWeather`). Confirmed via grep
these were entirely self-contained — no other file references
`cloudGroup`/`rainPoints`/`impactSparks`/`spawnImpactSparks`/`updateRain`/
`updateImpactSparks`, only `main.js` itself (the collision-impact callback
and `animate()`). The one coupling, `updateRain`'s read of the player's
`state.x`/`state.z`, is inverted into an injected `getPlayerState()`
getter — `state` isn't declared yet at the point in `main.js` where this
module is wired up, same TDZ-safe pattern `getRaceState` already uses.
`main.js` drops another ~140 lines. Updated `F1-RACER-WIKI.md` and
`architecture.md`/`roadmap.md` accordingly; still owns scene/track-mesh
construction, ghost-lap persistence and the qualifying/race state machines
per roadmap.md.

## 2026-09-23 — Close #3; sync roadmap.md/tooling.md (#17)

User closed #3 after the two cuts above (#14, #16) — it had no fixed
acceptance criteria, so closing it is a "enough for now" call, not "fully
done"; main.js still owns scene/track-mesh construction, ghost-lap
persistence and the qualifying/race state machines. Updated
`roadmap.md`'s #3 bullet and `tooling.md`'s Path B mitigation note, both of
which still described #3 as open, to say closed and point future
extraction at a new issue instead. This log entry documents that;
individual past entries above are left as written, per this wiki's
append-only rule.

## 2026-09-23 — Fix qualifying engine silence; add grid chorus (#10)

Two real bugs the user reported as "feels unnatural": (1) the player's own
engine was gated by `raceState === "racing"`, a race-phase-only variable
never touched by the separate qualifying state machine — so the engine was
silent for an entire qualifying session even while actively driving; (2) AI
cars never made any engine sound at all, so a ten-car standing start was
silent except for the player. Renamed `race-audio.js`'s injected getter
from `getRaceState` to `getEngineActive`, now composed in `main.js` from
both `raceState` and `qualiState`/`sessionPhase` so it's true whenever the
player can actually drive, in either session. Added a second, cheap ambient
"grid chorus" (two detuned low oscillators, not a per-car chain — explicit
mobile-cost constraint in #10) whose volume scales with how many AI cars
are within a fixed radius of the player, capped at 6 counted voices: loud
at a bunched standing start, thins out as the pack spreads. Verified the
gate logic and the chorus proximity/volume math standalone in Node (pure
functions, no AudioContext needed for that part); the actual Web Audio
output is unverifiable without a browser, same limitation as the rest of
this file's audio code — left for the user's manual playtest per
`RELEASE-CHECKLIST.md`.

## 2026-09-23 — Graphics profiles and diagnostics overlay (#2, partial)

Added `graphics-profiles.js` (auto-detected, persisted DPR/shadow/particle-
count profile from cheap device signals — coarse pointer, core count, native
DPR; `?gfx=` URL override) and `race-diagnostics.js` (dev-only FPS/
`renderer.info` overlay, opt-in via `?diag=1`, no-op otherwise). Wired both
into `main.js` (renderer DPR/shadowMap/sun.shadow, `setupRaceWeather`'s
rain/cloud counts) and `race-weather.js` (accepts the two count
multipliers, default 1 so the change is backward compatible). Deliberately
no new home-screen UI: the session-setup panel's two-choice layout
(difficulty, driver) is a documented, deliberate design
(`decisions.md`) a third control would disturb — automatic detection plus a
URL override covers the issue's "regolabili o automatici" either/or.

Verified both modules' pure logic standalone in Node with mocked browser
globals (`matchMedia`/`navigator`/`localStorage`/`location`/`document`):
the auto-detection heuristic across desktop/weak-phone/high-DPR-phone/
mid-phone cases, URL-override application and persistence, invalid-override
fallback, and the diagnostics enable/persist/clear/re-enable-on-next-load
cycle — all matched expectations.

**Does not close #2.** The issue's own acceptance bar is a measured
before/after on a real smartphone and a real desktop; this dev environment
has neither real mobile hardware nor real GPU rendering (this repo's own
prior validation records already flag headless/software rendering as non-
representative of real performance). Reporting that criterion as met without
having actually measured it would violate this repo's own testing rule, so
this PR stays open for the user's `Concludi` instead of auto-concluding —
the one exception in a batch the user otherwise asked to auto-conclude.
Also out of scope here: distant-scenery/reflection profile-awareness,
Garage integration. See `roadmap.md`.

## 2026-09-23 — Three new circuits, procedurally generated (#5)

User revised #5 from four new circuits/ten total to three/nine, dropping the
real-map-based fourth from this issue (a future separate issue if it
happens — updated the issue title/body accordingly). Added `pianalago`
(width 15, purely flowing — no corner anywhere near the wall margin),
`serramonte` (width 10, now the tightest/narrowest circuit in the roster,
overtaking Montenero — that entry's stale "tightest of the four"
superlative was fixed) and `baiadoro` (width 17, the widest, a long
straight into a tighter technical complex rather than uniform sweeps).

Unlike the first six's hand-placed points, all three were generated
procedurally: star-convex angle placement with a per-circuit radius profile
(a few sine harmonics at different frequency/amplitude/phase, seeded RNG for
reproducibility) shaped toward each circuit's intended character, then
accepted only once `node tools/validate-circuits.mjs <id>` (#6) reported
zero errors and zero warnings at those exact coordinates — the validator
built for #6 was the actual design tool here, not just a check run after
the fact. Picked widths so every circuit in the roster (existing six plus
these three) now has a distinct integer width, 9 through 17, reinforcing
the "larghezza... distinti" criterion beyond just the three new ones.

Confirmed the carousel (`menu.js`), championship (`championship.js`) and
circuit map rendering are all already fully generic over `CIRCUITS` (no
hardcoded circuit count anywhere in those) — no code changes needed there,
only the new `circuits.js` entries. Fixed two now-stale hardcoded "5
circuiti" strings in `index.html` (meta description/og:description and the
hero stat) to 9 — already inaccurate before this change, since the game
already had 6 circuits.

Does not touch #1 (multiplayer) or #2 (performance, still open pending
real-device measurement) despite #5's original framing mentioning both as
downstream dependents.

## 2026-09-23 — Fix: home carousel crashed for all circuits (#24)

Real regression from #5, live on production (GitHub Pages serves `master`
directly, no build step) until this fix: `menu.js` has its own
`CIRCUIT_PERSONALITY` lookup (type/note/level shown on each carousel card),
separate from and not derived from `circuits.js` — missed during #5's
"confirmed generic" check, which only verified the carousel/championship/
map-rendering *logic* was generic, not this second hardcoded per-id table.
The three new circuits had no entry, so `personality.type` threw on
`undefined` for the first of them and killed the *entire* carousel-slide
render loop — not just those three, all nine, because it's one `.map()`
call with no per-item error isolation. User reported this as "non vedo più
la prossima gara"; confirmed with headless Chromium against the live
`master` HTML before fixing (`[pageerror] Cannot read properties of
undefined (reading 'type')`, 0 slides, 0 dots).

Fix: added the three missing entries, plus a `DEFAULT_PERSONALITY` fallback
(`CIRCUIT_PERSONALITY[circuit.id] || DEFAULT_PERSONALITY`) so a future
missing/typo'd id degrades that one slide instead of blanking the whole
carousel again. Verified in an actual headless browser (Playwright +
the prebuilt Chromium at `/opt/pw-browsers`, static file served via
`python3 -m http.server`, not just `node --check`): navigated all nine
slides via the real arrow button, zero console/page errors, correct
type/level/note text on each.

Lesson for future circuit-roster changes: grep for the circuit id being
added across the *whole* repo, not just the files already known to read
`CIRCUITS` — a per-id lookup table like this one won't show up in a search
for `CIRCUITS.length` or similar genericity checks.

## 2026-09-23 — Sharpen the three #5 circuits with real hairpins (#26)

User feedback on #5's three new circuits: "troppo semplici... tutti tondi...
qualche tornante" — the star-convex harmonic shapes were smooth waves with no
corner anywhere near the wall-margin threshold, unlike Marzamemi's real tight
corners. Quantified this first (max per-step heading delta and min curvature
radius on the sampled centerline) before changing anything: all three were
close to the flattest existing circuits despite differing widths/intents.

Reworked each with a hairpin-insertion pass: one base star-convex point
replaced by a tight approach/apex/exit triple of closely-angle-spaced points
(`spreadDeg` apart, apex pulled in to `depthFactor` of its original radius) —
the same technique Marzamemi's real-street corners already relied on, applied
here on top of the procedural base shape instead of by hand. Tuned
`spreadDeg`/`depthFactor` per circuit against the real `validateCircuit()`
tool (#6), iterating past two failure modes: first configs too aggressive
(curvature radius below the wall margin, validator errors), then configs that
passed but with near-zero safety buffer (e.g. minR just 0.9% above the
margin) — explicitly rejected those as inconsistent with this project's
"comfortably above the margin" design philosophy and re-searched requiring a
real buffer, landing on: Pianalago two corners (minR 13.25 vs. margin 11.5,
+15%), Serramonte three hairpins (minR 10.6 vs. margin 9.0, +18%), Baiadoro
one deep hairpin (minR 14.6 vs. margin 12.5, +17%). All three set
`curveTension: 0.5` explicitly (previously implicit default) since that's
the value the final search was validated against.

`node tools/validate-circuits.mjs` reports 0 errors/warnings on all nine
circuits (Marzamemi's documented corridor floor unchanged). Updated
`menu.js`'s `CIRCUIT_PERSONALITY` notes for the three (Pianalago's "nessuna
staccata violenta" was no longer accurate; bumped its difficulty label from
Facile to Medio) and `circuits.js`'s per-circuit comments. Exploratory point
search was done via disposable `*.tmp.mjs` scripts (not gitignored, just
untracked) deleted manually before this commit — never part of the shipped
diff.

## 2026-09-23 — Welded kerbs and swept guardrails everywhere (#28)

User: kerbs "sono veramente attaccati, sembra che stai giocando a fare i
collage". Root cause: eight of nine circuits still drew kerbs and guardrails
as independent tangent-aligned boxes (~7.5 units each, every 3rd sample) —
the exact pattern `F1-RACER-WIKI.md` already said must not return after
Marzamemi's rework, but the fix had only ever been applied to Marzamemi.
Headless screenshots confirmed X-crossings at hairpin apexes and wedge gaps
outside; #26's tighter hairpins made it more visible. Extracted Marzamemi's
welded ribbon into `weldedKerb()` for all circuits and replaced rail boxes
with `sweptRails()` (continuous runs, rail kept only where its own stretch
of track is nearest — also removes rails that crossed each other).

Three further defects surfaced while verifying, all fixed here:
1. `ribbon()` in `track-art.js` had reversed winding, so runoff bands and
   painted lines were back-face culled on every circuit since they were
   written — confirmed numerically (normal y sign −1 vs road +1).
2. Inner offset edges fold into bow-ties wherever the spline bends tighter
   than the offset — including the *road* itself at Marzamemi/#26 apexes
   (dark shards). Added `offsetEdge()` to `track-geometry.js` (miter-cut of
   each swallowtail loop); flipped-triangle count across all strips and
   circuits went 258 → 0. Road/kerb/runoff also mesh from a 4x denser
   render-only `visualCenterline`; gameplay keeps 360 samples.
3. The 1400-unit ground was two triangles; at low camera angles its depth
   interpolation swallowed the road entirely (reproduced on `master` too,
   Montenero). Subdivided 56x56 plus a small polygon offset.

Not fixed, recorded as **Open** in roadmap/F1-RACER-WIKI: the validator's
smoothed curvature stencil hides near-cusp apexes (true radius ~1 on
Serramonte/Baiadoro), so #26's recorded margins overstate how round those
hairpins are. Bumped `main.js`/`track-art.js`/`track-geometry.js` cache
versions so a stale cached `track-geometry.js` can't break the new import.

## 2026-09-23 — Garage mobile restyle, driver-based livery (#30)

User: remove the "Livrea …" picker and make the Garage nice on phones, in
landscape too. Measured first (headless, 5 viewports): portrait phones had a
nested scroll box (setup pane 456px tall holding 1129px of content) under a
fixed car, with the stats overlay covering half the car; 740×360 landscape
fell into the stacked layout with a 175px scroll box. Decision on the livery
("entrambe"): it follows the selected driver's team, the same source the AI
grid uses, with Fenice as `liveryById`'s existing fallback —
`playerLivery(driverId)` in `garage-setup.js`, used by `garage.js` and
`main.js`. `loadGarageSetup()` now whitelists known part/variant pairs, so old
saves' `livery` (and any corrupt value) is dropped instead of carried along.

Layout: stats render into two containers (overlay on wide screens, card in the
pane on phones); portrait phones get one page scroll with a sticky car and a
sticky CTA; landscape phones (≤520px tall, any width) get two columns. Replaced
the three overlapping mobile/landscape blocks in `garage.css` with three
explicit ones. Variant labels translated to Italian.

Found while verifying: `showroom.js` calls `renderer.setSize(w, h, false)` and
nothing sized the canvas in CSS, so on any DPR > 1 screen the canvas rendered
at device-pixel size and the Garage showed only a zoomed top-left corner of
the scene — on every phone, since the Garage existed. Fixed with a
`#garage-canvas canvas` 100%/100% rule.

Also caught before commit: a TDZ ordering bug in `main.js` (`PLAYER_LIVERY`
computed one line before `SELECTED_DRIVER_ID` was declared) that would have
crashed every race start.

## 2026-09-23 — Home carousel zoom trap on phones (#32)

User: an annoying zoom while browsing circuits that they could not undo.
Not reproducible headless (Chromium there applies neither double-tap zoom
nor pinch), so the fix rests on the code: carousel arrows sit over the card
on phones with default `touch-action`, so quick repeated taps read as a
double-tap zoom; `.circuit-viewport` had `touch-action: pan-y`, which
excludes pinch, and covers ~71% of a 390×844 screen — once zoomed it filled
the view and no pinch could start anywhere else. Added a `f1-home` body class
and, scoped to it, `touch-action: manipulation` on links/buttons/radios plus
`pan-y pinch-zoom` on the carousel viewport. Page zoom stays enabled. Verified
the computed values and that swipe/arrow navigation still work; the actual
gesture behaviour is left for a real-phone check in `RELEASE-CHECKLIST.md`.
`index.html` now loads `style.css?v=34`, not the next free number for that
page, because `garage.html` already uses `?v=22` for the same file and a
shared URL could serve a stale cached copy.

## 2026-09-23 — Garage graphics-profile and diagnostics integration (#2, partial)

Continued #2 where the earlier pass left off — its own roadmap.md bullet
already named the two gaps: distant-scenery/reflection profile-awareness and
Garage integration. Did the second one, skipped the first, and said why:
without a real measured bottleneck (the issue's own required first step,
still blocked in this environment), touching distant-scenery density or
reflections would be tuning against a guess, not a finding — the opposite of
what #2 asks for.

Garage integration was a real, bounded gap: `showroom.js` had its own
ad hoc viewport-width heuristic (`matchMedia('(max-width: 760px)')`) for DPR
cap and shadow map size, completely separate from `graphics-profiles.js`'s
device-signal profile `main.js` already uses for the race. A phone set to
`gfx=low` for the race got full-cost rendering in the Garage regardless.
Added an optional `graphicsProfile` param to `createShowroom` (falls back to
the old heuristic if omitted, so this is a strict addition) and wired
`garage.js` to pass `loadGraphicsProfile()` — same profile object, same
three levels, no new heuristic invented. Verified in headless Chromium at a
high device pixel ratio that low/medium/high produce visibly different
canvas backing sizes (843x656 / 1264x984 / 1686x1312) with the car still
rendering correctly and zero console errors at each level.

Also wired `race-diagnostics.js`'s overlay into the Garage (`showroom.js`
gained an optional `onFrame(dt)` from its own `setAnimationLoop`), since
#2's own activity list names "misurare... più garage" explicitly and the
overlay was already scene-agnostic — it just needed a `renderer` and a
per-frame `dt`, both of which `showroom.js` already had internally. Confirmed
`?diag=1` shows the same overlay format the race uses and stays absent
without it.

While verifying the diagnostics overlay, hit a concrete instance of why real-
device measurement can't be faked here: at typical headless-run wait times
(1.5-3s) the FPS reading stayed at 0, not because of a bug but because this
sandbox's software rendering (swiftshader, no real GPU) is slow enough that
accumulating one 0.5-second FPS sample took roughly 15 real seconds. Confirmed
the mechanism was correct by waiting that long (FPS populated correctly:
21fps/47ms at gfx:medium) rather than assuming a bug — but this is exactly
the kind of number that would be meaningless as a real performance
measurement, reinforcing why #2 stays open for the user's own hardware pass.

Does not close #2. Real-device measurement remains the actual acceptance bar
and remains entirely out of this environment's reach.
