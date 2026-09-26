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

## 2026-09-23 — Close #8 (Agent API), backfill its wiki docs

Issue #8 (window._ENVIRONMENT_ MVP) was already fully implemented and merged
via PR #9 — from a different Claude Code session than this one's own history,
timestamped before this conversation ever picked it up. It stayed open only
because the PR body said "Chiude #8" (Italian), which GitHub does not parse
as a closing keyword; only English "Closes #N" does. This repo already
learned that lesson once for issue-closing prose comments and apparently
never generalized it to PR bodies. Did not just trust the PR description's
own claim of prior testing: re-verified independently in a real headless
browser (state snapshot present and correctly shaped, mutating a returned
snapshot does not affect the next getState() call, out-of-range step()
input is clamped rather than throwing, a concurrent step() is rejected, a
step neutralizes throttle/brake/steer once its duration elapses) before
closing. Also backfilled what PR #9 skipped: neither F1-RACER-WIKI.md nor
this wiki's architecture.md/roadmap.md ever mentioned the Agent API — every
other merged feature in this repo's history got a wiki entry, this one had
none. Added a dedicated F1-RACER-WIKI.md section and an architecture.md
bullet describing the actual contract (getState/step/release, the
onHumanInput hand-back path, the digital-pedal and automatic-DRS deviations
from the issue's original spec).

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

## 2026-09-23 — Multiplayer Stage 1: rooms and driver reservation (#36, part of #1)

User wants to move on #1 (multiplayer). #1 itself demands staged delivery
(rooms, then race sync, then voice — separate PRs, protocol/infra decided
before each). Used plan mode first: audited the repo (confirmed zero
backend/server/CI existed anywhere, and that `architecture.md`/
`RELEASE-CHECKLIST.md` enforced "no backend" as a real constraint, not
just an absence), had a Plan agent design a concrete Stage 1 (rooms +
driver reservation only) reusing existing patterns (`driver-roster.js` as
the reservation source of truth, `driver-selection.js`'s separate
`"player"` pseudo-id, `menu.js`'s driver-grid UI shape, `agent-api.js`'s
transport-agnostic precedent), then used `AskUserQuestion` on the two real
open decisions: scope (user chose plan-only first, then said go) and
hosting (user chose Render, having used it before with a self-ping trick
against the free tier's sleep — flagged, not overridden, that a 24/7
self-pinged service uses most of Render's free monthly instance-hour
allowance on its own, so it may need the paid tier).

Built: `server/rooms.mjs` (pure in-memory room/participant state machine —
no sockets, no database, resets on restart, a stated Stage 1 limit not an
oversight) and `server/room-server.mjs` (thin `ws`-based WebSocket
transport around it) — this project's first-ever backend, kept as a
separate opt-in process the shipped static site never imports. Client
side: `room-client.js` (protocol client, its own
`f1racer-room-session-v1` localStorage key, deliberately never touching
solo-play's `f1racer-selected-driver-v1`), `room.html`/`room.js` (lobby
UI), and a new secondary (not a third co-equal card, to respect
`decisions.md`'s existing Garage/circuit-selection hierarchy) entry point
on `index.html`.

Verified, not just read back: 20 direct unit checks against `rooms.mjs`'s
pure functions (atomic reservation with exactly one winner, grace-period
retention/expiry/reconnect, host handoff to the longest-connected
remaining participant, room cleanup, no secret/timer-handle leaks in
`toPublicRoom()`), then a real `ws` server process plus a real WebSocket
Node client exercising the full protocol end to end including a real
1500ms grace-period expiry, then two real headless-browser contexts
(Playwright) against that same real server driving the actual `room.html`
UI — room creation/join, a live cross-client driver-reservation broadcast,
a clean rejection of an already-taken driver, non-host `start_race`
hidden, host `start_race` reaching both clients as the Stage 1
confirmation, and session resume after a page reload. Confirmed via grep
that no solo-play file (`menu.js`, `main.js`, `race.html`, `garage.js`,
`championship.js`) references any of the new room modules — purely
additive.

Explicitly not attempted: race-state sync, voice/WebRTC/SFU (separate
future issues with their own infra decisions), or any live public
deployment — this sandbox cannot host the room server reachably from a
real separate device/network, so `wss://`/TLS behaviour and cross-device
reachability are unverified and flagged as such in
`RELEASE-CHECKLIST.md`. `RELEASE-CHECKLIST.md`'s former blanket "no
backend/server dependency" line is reworded to scope that guarantee to
solo/local play specifically, since Stage 1 intentionally introduces one
for multiplayer.

## 2026-09-23 -- Home command hierarchy: multiplayer replaces solo shortcut (#40)

After #38's numbering fix, the user asked to reorganize the home further: promote
the multiplayer entry (#36) from a secondary banner to one of the two dominant
home-command cards, explicitly swapping it with the existing "Scegli la gara"
solo-circuit-selection shortcut. Confirmed via AskUserQuestion after an initial
ambiguity ("Prossima gara" vs "Scegli la gara" -- the user meant the latter).
Rationale given directly by the user: the goal is to get more people playing
together, so multiplayer deserves Garage-level visual priority, not a secondary
link.

Implementation: nav card 2 (`home-command--race`, renamed `home-command--multiplayer`)
now links to `room.html` ("Gioca con altri"). The former "Scegli la gara" link
moved to the slim secondary-banner position multiplayer used to occupy, renamed
generically from `home-multiplayer-entry`/`-kicker`/`-body` to `home-secondary-entry`/
`-kicker`/`-body` in style.css since that slot is no longer multiplayer-specific.
`decisions.md`'s "Home and Circuit Selection" section rewritten accordingly --
flagged explicitly as a deliberate product priority reversal, not a style tweak,
so a future session does not silently revert it.

Verified with real Playwright screenshots (desktop 1440px, mobile 390px) before
committing. No JS files touched; confirmed via grep that no script depends on the
renamed CSS classes or the old kicker text (GRIGLIA/Modalita alternativa).

## 2026-09-23 — Multiplayer Stage 2: qualifying and race sync (#44, part of #1)

After #36 (Stage 1: rooms/driver reservation) and the home reorg (#38/#40),
the user asked to proceed to a real synced race. Design decisions confirmed
via direct back-and-forth rather than assumed: client-authoritative sync
(each browser keeps simulating its own car, broadcasts position/heading/
speed a few times a second, others render it as a network-driven ghost —
rejected server-side physics as its own separate project); disconnection
mid-race freezes the car in place and greys out its list/nameplate entry
(a natural consequence of client-authoritative sync, reusing #36's existing
grace-period mechanism unchanged); no AI padding for empty room slots (a
3-person room races with 3 cars, not a mixed AI field); host picks circuit
and difficulty inside the room, broadcast to everyone at start.

Read main.js in full before touching it (had not been read yet this
session) and found one more real design gap before writing code: rooms had
no concept of a circuit at all, since Stage 1 stopped at a bare
confirmation. Surfaced this explicitly and got the host-picks-in-room
answer before proceeding, rather than guessing.

Implementation: rooms.mjs gained sessionPhase/circuitId/difficulty/
qualiBestTime/grid and setCircuit/startRace (now gated on ready+driver for
everyone)/reportQualiTime/finishQualifying; room-server.mjs added
set_circuit/report_quali_time handlers, an ephemeral unstored car_state
relay, and its own setTimeout-driven qualifying timer (ROOM_QUALI_MS) so
every client transitions off one server clock. room-client.js/room.js
gained a host-only circuit/difficulty picker and navigation into race.html
once qualifying begins. Two new files bridge a room into the actual race:
race-bootstrap.js (resolves the async room reconnect before main.js loads,
since main.js's own top-level code is entirely synchronous and was never
rewritten to be async — hands off the connected client via a one-shot
window.__mpClient) and race-multiplayer.js (wraps that connection into the
small synchronous API main.js calls). Every multiplayer touchpoint in
main.js is an explicit branch on one multiplayer variable, null for solo —
AI_DRIVERS becomes the room's other participants, aiCars entries tagged
isRemote/participantId and driven by a new updateRemoteCar() instead of
updateAiCar(), while currentRaceOrder/applyGridPositions/DRS/collisions/
HUD/nameplates all worked unchanged since they were already generic over
aiCars. race-hud.js and race-nameplates.js gained an optional isDisconnected
check for the grey-out treatment; race-hud.js also gained a
getQualifyingRivals getter alongside its old static array, since
multiplayer's live times change over the session. finishRace() skips the
solo championship entirely for a multiplayer session, to avoid polluting
the user's own solo standings with room results.

Verified in stages, same methodology as Stage 1: 12/12 direct checks
against rooms.mjs's new functions (host/validation gating, ready+driver
requirement, DNF-to-the-back grid ordering, idempotency); then a real
two-browser-context Playwright session against a real room-server.mjs
process covering the full path — room creation/join, ready-gated
circuit-chosen "Avvia", both clients navigating to race.html with matching
params, the server-timed qualifying-to-racing transition actually firing,
a real computed grid, live position/timing-tower classification for both
cars, the remote participant's nameplate visible and moving, and — after
closing one browser context mid-race — the remaining client's nameplate
and timing-tower row greying out once the grace window expired. A separate
real-browser run confirmed solo play (no ?room=) is completely unaffected:
no page errors, HUD/tower/synthesized-AI list all render, acceleration
responds normally. Three.js was served from the local node_modules copy in
these tests since this sandbox's network policy blocks the jsdelivr CDN
main.js normally loads it from in production — an environment-only
substitution, not a code change.

What this did not verify, said plainly rather than glossed over: no test
drove a multiplayer race to its actual finish line (would need sustained
scripted driving matching each circuit's line); real phones/separate
networks were verified for Stage 1's rooms but not re-verified here for
qualifying/race sync specifically; collision behavior between a local car
and a network-driven remote car was not watched by eye (expected to be a
harmless one-frame jitter self-corrected by the next network sample, not
confirmed visually). RELEASE-CHECKLIST.md records all of this as explicit
open items, not silently assumed fine.

## 2026-09-24 — Source restructure: everything under core/ (#46)

The user asked to restructure the flat 37-file repo root, going through
Plan Mode. First proposal (feature folders sitting directly at repo root:
race/, garage/, multiplayer/, shared/, home/) was corrected twice by the
user: everything (except assets/) had to collect under one core/ folder,
with a standard client/server/tools split inside it. Confirmed with the
user directly, before moving anything, that the 4 HTML entry points must
stay at the repo root — GitHub Pages here serves the branch root as-is, no
build step, and does not support serving from an arbitrary subfolder like
/core; moving them would have broken the live site. Also confirmed
package.json belongs at core/ (parent of both server/ and tools/), not
inside server/ alone as the user first suggested — re-read package.json's
own description before answering and found it names two distinct
consumers, three for tools/validate-circuits.mjs and ws for
server/room-server.mjs, so nesting it under server/ would have broken
tools/'s access to node_modules or forced a duplicate package.json.

Final layout: core/{package.json,node_modules,client/{style.css,race/,
garage/,multiplayer/,shared/,home/},server/,tools/}. HTML pages, assets/,
and llm-wiki/ stay at the repo root. Inside client/, shared/ holds
anything used by 2+ features (garage-setup.js included, since race/main.js
reads it too, not just garage/garage.js); race-multiplayer.js stays
grouped in multiplayer/ with room-client.js even though only race/main.js
imports it, a conceptual-grouping call flagged in architecture.md rather
than decided silently.

Executed as a single mechanical pass: git mv for every file (keeps
history), every relative import rewritten to the new cross-folder paths
without touching existing ?vNN cache-busting query strings (the move
itself isn't a functional change), the 4 HTML files' script/link tags
updated, the two cross-boundary imports in rooms.mjs and
validate-circuits.mjs repointed into client/shared/, .gitignore's
node_modules//tools/out/ entries reprefixed with core/, old root
node_modules deleted and a fresh npm install run inside core/.

Verified before opening the PR: node --check on every moved file; npm run
validate:circuits and a timed start of npm run start:room-server, both
from inside core/; a real Playwright pass covering all four pages against
the actually-restructured files — home (cards/carousel render, no errors),
garage (showroom canvas renders, no errors), race in solo (qualifying
marker, acceleration), and the full room-to-race multiplayer flow
(room create/join, ready+circuit gating, both clients navigating to
race.html with correct params, server-timed qualifying-to-racing
transition, remote nameplate visible) — 16/16 checks passed, zero page
errors across every page.

Updated every file-path mention across architecture.md, F1-RACER-WIKI.md,
decisions.md and roadmap.md to the new core/ paths (user's explicit call,
asked before doing the large mechanical doc diff rather than assumed) —
done with a single sed script over exact backtick-quoted filenames rather
than by hand, then verified with a diff and a grep for any bare
(un-prefixed) mention left over before applying, since a bash "python3 -c"
heredoc approach earlier in this session had corrupted a doc via backtick
command substitution — this pass deliberately avoided that failure mode by
keeping the substitution script in its own file, never inline in a
double-quoted shell string.

## 2026-09-24 — Fix: browser back button trapped users inside a multiplayer race (#48)

User-reported bug: on desktop, once a multiplayer race started, pressing
the browser's back button did not leave the race. Reproduced with a real
Playwright `page.goBack()` before touching any code: the URL genuinely
returned to room.html, but room.js's onStateChange handler saw the room's
sessionPhase still "qualifying"/"racing" (the server session never
changed just because this tab navigated away) and called goToRace() again
immediately, bouncing straight back to race.html in the same tick — from
the user's perspective indistinguishable from "back does nothing". Also
checked and ruled out the HUD's own `.back-link` (`← circuiti` in
race.html) as the culprit: a real synthetic mouse click there did
navigate correctly, so that path was never the problem.

Fix: room.js now tracks whether the current page load ever actually
rendered the lobby (`sawLobbyThisLoad`). The auto-navigate-into-race call
only fires when that's true — i.e. only for a live "the host just started
it" transition witnessed while sitting in the lobby, never for a page
load (via back-navigation or a fresh visit) that finds the room already
mid-race. In that latter case the room-started banner shows a manual
"Rientra in gara" link instead of forcing navigation, so back-navigating
users get a real choice: rejoin, or actually leave via the existing "Esci"
button / header link, both already unaffected by this bug.

Verified with three real Playwright scenarios: back-navigate mid-qualifying
now correctly stays on room.html (previously bounced straight back); the
manual "Rientra in gara" link, when clicked, does navigate into the race
as expected; and Esci from that state correctly returns to the room entry
form. Zero page errors throughout.

Also changed the home command card's copy from "Gioca con altri" to
"Corri in multiplayer" per explicit user request ("la frase deve essere
multiplayer o similari... immagina di dover vendere questa cosa") — kept
the kicker ("STANZA") and the same verb+preposition+noun rhythm as the
garage card's "Entra nel garage" for consistency, and punched up the
subtext to lead with the benefit (challenge your friends) rather than
just the mechanics (create/join a room). Verified with real screenshots,
desktop and mobile, that the new copy still fits the card layout cleanly.

## 2026-09-24 — Realistic engine audio and F1 start procedure (#50)

User request: better engine sound, audible before the qualifying/race
start, and a realistic start "come fanno nelle gare ufficiali".

- `race-audio.js` rewritten: turbo V6 model (fundamental = rpm/20),
  PeriodicWave firing tone + sub/half voices, combustion noise, turbo
  whistle, tanh saturation, RPM inertia, fire-up sequence; phase-driven
  API (`getPhase`/`getThrottle`) so the engine idles and free-revs on the
  grid; `coolDown()` after the flag.
- `main.js`: "Avvia il motore" gate (autoplay policy), pit-exit light for
  qualifying, five-light gantry with random hold for the race (seeded from
  the server in multiplayer), `startSequenceId` guard against stale timers.
- Verified in real headless Chromium through a multiplayer room (server
  qualifying + race): gate blocks audio until a keypress; idle firing
  peak 242 Hz (model 230); pit light red -> green; car drives after green;
  race lights 1 -> 5 -> all out, never green; car frozen with 5 reds and
  engine revving (spectral centroid 1723 Hz vs 912 at idle); launch to
  137 km/h after lights out; zero page errors.
- Known limits: gate needed on every page load; multiplayer qualifying
  clock runs while a player is at the gate; hold range 0.2-3s is an
  estimate; no jump-start penalty; no clock-skew compensation.

## 2026-09-24 — Lagged chase camera yaw + per-cycle workflow (#52)

- `race-camera.js`: chase camera yaw trails the car heading with an
  exponential response (`CHASE_CAM_YAW_RESPONSE = 3.2`/s, lag clamped to
  0.45 rad), so the car visibly rotates into corners instead of staying
  locked straight on screen. Cockpit camera unchanged.
- `AGENTS.md`: one issue/branch/PR per work cycle, one commit per change,
  one log entry per cycle; "Concludi" closes the cycle, then `/compact`.
- Verified with `node --check` + `git diff --check` only; feel to be
  judged in play.

## 2026-09-24 — PlayStation pad support (#54)

- `race-input.js`: Gamepad API polled every frame ("standard" mapping).
  Left stick steers (deadzone 0.12 + `shapeSteering`); R2/L2 are digital
  gas/brake (threshold 0.25); Cross, Triangle, Square, R1 are replayed as
  synthetic `keydown` (gate, `KeyC` camera, `KeyP` pit, `KeyE` ERS).
- `main.js`: a pad press is not a user activation, so after the engine
  gate the audio context also resumes on the next real key or tap.
- Decision: analog pedals deferred to a separate cycle (touches physics).
- Verified with `node --check` + `git diff --check` only.

## 2026-09-24 — Landscape fullscreen + home screen app (#56)

- `race-input.js`: on touch devices, the first tap in landscape during
  the race calls `requestFullscreen` (a user gesture is required, so
  rotation alone cannot); rotating back to portrait exits. Skipped when
  launched from the home screen (`display-mode` fullscreen/standalone).
- New `manifest.webmanifest` (`display: fullscreen`) + icons
  `assets/images/app-icon-{180,192,512}.png`; all 4 pages link it and
  carry `apple-mobile-web-app-*` / `theme-color` meta.
- Known limits: iPhone Safari has no page fullscreen — "Add to Home
  Screen" is the only chrome-free route, keeps the iOS status bar, and
  gets its own `localStorage` separate from Safari.
- Verified with `node --check` + `git diff --check` only.

## 2026-09-24 — /concludi project skill (#58)

- New `.claude/skills/concludi/SKILL.md`: scripted cycle close (log entry,
  PR ready, merge with "Closes #N", pull `master`, delete branch,
  unsubscribe PR activity, `/compact` reminder).
- Known limit: `/compact` is a client command; no skill or hook can run
  it, so it stays a manual step for the user.
- Verified with `git diff --check` only; first real run on the next cycle.

## 2026-09-24 — Versioned imports and iOS home-screen touch controls (#60)

- Every relative import in `core/client` now carries `?vNN` (new ones
  start at `?v=1`), with version bumps chained up to the HTML pages, so the
  installed PWA never mixes new pages with modules cached from before a
  deploy. Rule made explicit in `llm-wiki/AGENTS.md`.
- Known limit: GitHub Pages caches HTML ~10 min; there is no service
  worker, so updates show on reopen after that window.
- `race-controls.css`: in `display-mode: standalone/fullscreen` the touch
  controls (and landscape motion controls) sit at least 34px above the
  bottom edge; iOS was swallowing some taps in the home-indicator strip.
- Verified with `node --check` + `git diff --check` only; the iOS fix still
  needs confirmation on the user's iPhone.

## 2026-09-24 — Race voice chat, last stage of multiplayer (#1)

- `core/server/room-server.mjs` relays `voice_signal` (offer/answer/ICE/
  hello) to one named peer in the same room; audio never touches the
  server. `room-client.js` gains `sendVoiceSignal`/`onVoiceSignal`.
- New `core/client/multiplayer/voice-chat.js`: peer-to-peer WebRTC mesh,
  race only (not the lobby), started from the engine-gate tap so the mic
  prompt has a gesture. Smaller participantId offers; signaling waits for
  the mic answer; no mic = listen-only. HUD toggle 🎙/🔇 with peer count.
- Known limits: STUN only (Google), no TURN — some 4G/5G peers may not
  connect; iOS audio routing/volume with the mic open is unverified.
- Fixed a pre-existing crash: reloading `race.html` after the grid was set
  hit engine-gate state before its declaration (TDZ); `onGridReady` is now
  registered after module evaluation. The reloaded car still restarts from
  its grid slot (position is not restored).
- Workflow rule changed: cycles close right after the work (user tests on
  `master`), no browser tests; PR auto-subscription is left until close.
- Verified with two Playwright contexts + fake mic against a local room
  server (connect, mute, reload, leave); not yet on real phones.

## 2026-09-24 — Touch controls no longer start text selection on iOS (#63)

- `race-controls.css`: on touch race pages, `user-select`, touch callout and
  tap highlight are disabled for the body and every touch control; the
  wheel's SVG (with its "OB" text) no longer takes pointer events, so the
  `#wheel-control` div gets them.
- Cause (probable, from the user's report): in the iPhone home-screen app,
  landscape, a long press on control labels began a text selection and
  iOS cancelled the touch, so the upper part of wheel/pedals felt dead.
- Verified with `git diff --check` only (CSS); confirmation on the iPhone
  pending.

## 2026-09-24 — Gentler lift-off and brake over throttle (#65)

- Tester feedback: "either stopped or flat out"; no way to dab the brake
  while holding full gas.
- `player-physics.js`: brake now wins when both pedals are held (throttle
  = forward && !back, also used for load transfer/stability). Lift-off
  decel is `coastDecel * (0.12 + 0.38 * v²/vmax²)`: ~14 m/s² at top speed,
  ~3.4 m/s² near a standstill (was a flat 28 m/s² at any speed).
- Not changed: acceleration (still a flat 47 m/s², very quick to top
  speed) — left for a separate decision since it shifts balance vs AI.
- Verified with `node --check` + `git diff --check` only.

## 2026-09-24 — Realistic acceleration curve (#67)

- Acceleration was a flat 47 m/s² (player) / 41 (AI): 0-100 km/h in 0.6s,
  0-300 in 1.8s. Real F1: ~2.6s / ~4.5s (0-200) / ~10s.
- Now `accel * (1 - 0.85 * (v/vmax)²)` for both player
  (`player-physics.js`) and AI (`race-ai.js`), with launch accel 16 / 14
  (same player/AI ratio as before). Player: ~1.8s 0-100, ~4s 0-200, top
  speed after ~9-10s.
- Risk: corner exits are much slower, so lap times and the player/AI
  balance shift; tune `accel` in `main.js` if the AI feels off.
- Verified with `node --check` + `git diff --check` only.

## 2026-09-24 — Heading-up minimap (#69)

- Tester feedback: the north-up whole-circuit trace with a dot never told
  where the next corner was or how tight; players ended up on the grass.
- `race-hud.js` `drawMinimap()`: heading-up and zoomed (~220 m to the rim),
  player arrow fixed at 2/3 height so more road ahead shows, track drawn
  as an outlined band, rivals as dots, inside a dark round disc.
- Bigger: canvas 130→200 px (`MINIMAP_CANVAS_SIZE`, `race.html`), CSS
  width 4.2rem→8.5rem (6.5rem on short landscape phones, was 3rem).
- Trade-off: no whole-circuit overview any more during the race.
- Verified with `node --check` + `git diff --check` only.

## 2026-09-24 — Braking hint on the minimap rim (#71)

- User idea from F1 games: a green/red cue near the map for corners. Built
  as a *braking* cue, not a mere "corner ahead" flag.
- `main.js`: `cornerTargetSpeed[]` per centerline sample (AI's severity
  formula, `maxSpeed * (1 - 0.48 * severity)`) and `centerlineStep[]`,
  precomputed once; `brakeUrgency()` = max over the next 140 samples of
  needed decel / (0.8 * brakeDecel).
- `race-hud.js`: minimap rim green (<0.55), yellow (<0.9), red (>=0.9).
- Needs verification: thresholds and the 0.48 factor are borrowed from
  the AI, not tuned for the player — may warn too early or too late.
- Verified with `node --check` + `git diff --check` only.

## 2026-09-24 — Rimless minimap and on-road brake trail (#73)

- `race-hud.js`: minimap drops the dark disc and the #71 urgency rim; edges fade out via a `destination-in` radial gradient. `brakeUrgency` is no longer a HUD param.
- `style.css` / `race.html` / `main.js`: minimap 11rem (8.5rem at `max-height:480px`), canvas 256px.
- `main.js`: `brakeTrail` — additive, soft-edged plane on the tarmac from under the player car forward, sized from the car's bounding box; color green -> yellow -> red with `brakeUrgency()`, opacity rises with urgency, hidden below 8 m/s. Updated in the qualifying and race loops.
- Chosen over a bottom-left HUD bar because the touch wheel owns that corner.
- Verified with `node --check` and `git diff --check` only; thresholds and look to be tuned from play on `master`.

## 2026-09-24 — 300 m braking bar replaces minimap and brake trail (#75)

- New `core/client/race/race-brake-bar.js`: vertical strip of the next 300 m of centerline, player arrow at the bottom, rivals as dots (placed via nearest centerline sample). Each stretch is colored by a backwards braking envelope (`cornerTargetSpeed` + `0.8 * CAR.brakeDecel`) against the current speed: green = no braking, yellow -> red = braking zone/corner.
- `main.js`: removed the minimap geometry, `brakeUrgency()` and the #73 `brakeTrail` mesh; `setupBrakeBar()` runs in the qualifying and race loops.
- `race-hud.js`: `drawMinimap()` and its params removed. `race.html`: `#minimap` canvas replaced by `#brake-bar`.
- Layout: right edge, vertically centered on desktop (`style.css`); above the gas pedal on touch (`race-controls.css`), shorter at `max-height:520px`. The canvas backing store follows its CSS box.
- Verified with `node --check` and `git diff --check` only.

## 2026-09-24 — Rotating braking map with real corner speeds (#77)

- Root cause of "always green" in #75: `cornerTargetSpeed` reused the AI corner-severity formula, whose minimum is ~157-212 km/h on the current (short, 400-1900 m) circuits, so the player rarely exceeded it.
- `main.js`: `cornerTargetSpeed` now = highest speed where `|steeringYaw(1, v, CAR.maxTurnRate)| * 0.8 >= v * curvature`, curvature over a ±6 m window. Corners come out at ~50-140 km/h.
- `race-brake-bar.js` renamed to `race-brake-map.js`: heading-up section (30 m behind to 300 m ahead) around the player's dot, per-segment green -> yellow -> red from the braking envelope, rivals in the section as dots, faded edges.
- Canvas `#brake-map`: 11rem at right-center on desktop, 9rem (7.5rem at `max-height:520px`) above the gas pedal on touch.
- Verified with `node --check`, `git diff --check` and a node script printing the per-circuit corner speeds; not played.

## 2026-09-24 — Steering no longer caps top speed (#79)

- `core/client/race/player-physics.js`: corner scrub factor 0.9 -> 0.2 and
  sliding traction cut 0.42 -> 0.15. Before, half lock held the car at
  ~185 km/h and full lock at ~107 km/h flat out, acting as a hidden limiter.
- Now (node sim, grip 1): half lock ~289 km/h, full lock ~253 km/h; going
  in too fast ends off the road instead of being slowed by the game.
- Version bumps: `player-physics.js?v=4`, `main.js?v=56`,
  `race-bootstrap.js?v=15`.
- Verified with `node --check` and `git diff --check`; no browser test.

## 2026-09-25 — Braking map restyle (#81)

- `core/client/race/race-brake-map.js`: the section is drawn as a road
  (shadow, white edge lines, dark asphalt) with a thinner green/yellow/red
  warning line down the middle; the player is a white arrow; rivals are
  smaller dots with a white outline.
- New label under the arrow: distance to the braking point (first sample
  where the current speed is above the envelope), rounded to 10 m; "FRENA"
  in red when it is under 8 m. Drawn after the edge fade so it stays sharp.
- Stroke widths scale with the canvas size (tuned for 256 px).
- Version bumps: `race-brake-map.js?v=2`, `main.js?v=57`,
  `race-bootstrap.js?v=16`.
- Verified with `node --check`, `git diff --check` and a node smoke test
  with a mock canvas; no browser test.

## 2026-09-25 — Touch braking map bottom center (#83)

- `race.html`: `#motion-controls` (tilt steering: toggle, calibrate,
  sensitivity) gets `hidden`; the code in `race-input.js` is kept on the
  user's request so it can come back.
- `core/client/race/race-controls.css`: `#motion-controls[hidden]` now
  really hides (the id rule set `display:flex`); on touch `#brake-map`
  moves bottom center between wheel and pedals (landscape
  `min(9rem, 100vw - 380px)`, 7.5rem on short screens, standalone lifted
  above the iOS home strip); portrait puts it above the controls
  (bottom 205px). Desktop unchanged (right edge).
- Version bump: `race-controls.css?v=43`.
- Verified with `git diff --check`; no browser test.

## 2026-09-25 — Wider, see-through touch braking map (#85)

- `core/client/race/race-controls.css`: touch `#brake-map` is now a 16:10 box
  (up to 17rem landscape, 14rem portrait), no drop shadow, opacity 0.9.
- `core/client/race/race-brake-map.js`: zoom and stroke widths scale by the
  short side of the canvas; black road shadow removed; asphalt is punched out
  and refilled at 35% alpha, edges at 55%; elliptical fade starts at 35% of
  the radius. Warning line, rival dots, arrow and label stay opaque.
- Version chain: `race-brake-map.js?v=3`, `main.js?v=58`,
  `race-bootstrap.js?v=17`, `race-controls.css?v=44`.
- Verified with `node --check` and `git diff --check` only (no browser test).

## 2026-09-25 — Stuck touch wheel/pedals (#87)

- User report: while turning, even slowly, the car "loses the road" and then
  the control stops responding.
- `core/client/race/race-input.js`: wheel and pedals kept the first pointer id
  until its release; a lost release left a ghost pointer (steer frozen, new
  touches ignored). A new touch now takes over when the stored pointer is no
  longer captured, and window-level `pointerup`/`pointercancel` (capture
  phase) free any wheel/pedal owned by that pointer.
- Root cause is probable, not reproduced (no browser tests); if the car still
  slides at low speed, the next suspect is the lateral-slip model in
  `player-physics.js`.
- Version chain: `race-input.js?v=42`, `main.js?v=59`,
  `race-bootstrap.js?v=18`. Verified with `node --check` + `git diff --check`.

## 2026-09-25 — Driver model, exhaust pops, desktop map at bottom (#89)

- `core/client/style.css`: desktop `#brake-map` moved from the right edge to
  the bottom center (16:10, `min(22rem, 40vw)`, above `#hint`), matching the
  see-through touch look of #85.
- `core/client/shared/car-model.js`: driver helmet gets an accent centre
  stripe, front-only visor slot, chin bar and rear spoiler; HANS collar;
  arms bend at the elbow. Shared by race and garage showroom.
- New `core/client/race/race-exhaust.js`: additive flame sprite on the player
  car's tailpipe, popping 3-6 times on lift-off above 35% top speed and 1-2
  times on a downshift; back on the gas cancels the queue. Sound comes from
  `playExhaustPop()` in `race-audio.js` (band-passed noise + low thump).
  Player car only; AI cars have no pops.
- Version chains: `car-model.js?v=29` -> `race-car-view.js?v=29`,
  `showroom.js?v=31` -> `garage.js?v=42`; `race-audio.js?v=3`,
  `race-exhaust.js?v=1`, `main.js?v=60`, `race-bootstrap.js?v=19`,
  `style.css?v=43` (race.html). Verified with `node --check` + `git diff --check`.

## 2026-09-25 — Multiplayer livery and qualifying start slot (#91)

- `core/client/race/main.js`: in a room the local car uses the room-reserved
  driver (livery + cockpit theme) instead of the solo selection, so every
  participant sees the same colour for the same car.
- Multiplayer qualifying: each participant starts from its own grid slot
  (index in the server's participant list) instead of all on pole;
  `prevRawProgress` is derived from the actual start point.
- Version chain: `main.js?v=61`, `race-bootstrap.js?v=20` (race.html).
- Verified with `node --check` only; to be tested in a real two-player room.

## 2026-09-25 — Voice chat diagnostics (#93)

- Real test (iPhone + desktop on the same LAN): mic granted, HUD stuck on
  "Voce · 0", no audio. Cause not yet known (stale room server vs. missing
  TURN).
- `voice-chat.js`: the HUD label now says why nobody is connected — room
  server too old for `voice_signal`, no reply from peers, connecting,
  connection failed (likely NAT, needs TURN) — and logs each WebRTC
  connection/ICE state to the console.
- `room-client.js`: an `unknown_type` error without reqId (old server
  rejecting `voice_signal`) is forwarded to the voice layer.
- Version chain: `voice-chat.js?v=2`, `race-multiplayer.js?v=3`,
  `main.js?v=62`, `room-client.js?v=4`, `race-bootstrap.js?v=21`,
  `room.js?v=5`. Verified with `node --check` only.

## 2026-09-25 — Voice: stale socket close and late hellos (#95)

- Real test: joiner showed "Voce · nessun altro", creator "Solo ascolto · nessuna risposta" — the joiner saw the creator as not connected.
- `core/server/room-server.mjs`: a socket close is ignored when the participant is already bound to a newer socket (the room.html -> race.html navigation can deliver the old close after the new reconnect, which marked the live participant "grace" and dropped its socket from the relay map).
- `core/client/multiplayer/voice-chat.js` (`?v=3`): hellos go to every peer that becomes connected, not only those present at start; chain bumped (`race-multiplayer.js?v=4`, `main.js?v=63`, `race-bootstrap.js?v=22`).
- Root cause is probable, not proven; TURN is still missing for peers behind strict NAT. Verified with `node --check` only.

## 2026-09-25 — Room invite link (#97)

- `room.html` + `core/client/multiplayer/room.js` (`?v=6`): "Condividi link" button builds `room.html?join=CODE` keeping the current `roomServer`; native share sheet on mobile, clipboard fallback, raw link as last resort.
- Opening an invite prefills the code and shows a hint; the nickname is remembered in `f1racer-room-nickname-v1`. A saved session for a different room is left so the invite wins.
- Warns when the link cannot work for friends (page on localhost, or no public `roomServer`) — the host must open the game from GitHub Pages with `?roomServer=wss://…` for the link to be usable.
- Verified with `node --check` only.

## 2026-09-25 — roomServer accepts https (#99)

- `core/client/multiplayer/room-client.js` (`?v=5`): `?roomServer=` maps `https://` to `wss://`, `http://` to `ws://`, and a bare host to `wss://`, so the ngrok URL can be pasted as printed.
- Invite warning in `room.js` (`?v=7`) now suggests `?roomServer=https://…`; chain bumped (`race-bootstrap.js?v=23`, `race.html`, `room.html`).
- Verified with `node --check` and a node run of the mapping.

## 2026-09-25 — Cornering no longer feels like braking (#101)

- Real test: steering made the engine note drop. The tyre scrub in `core/client/race/player-physics.js` (`?v=5`) was linear in slip and, near top speed, beat the engine's remaining push even at half lock.
- Scrub now starts only past slip 0.3 (rescaled 0..1 above it): light/medium steering holds speed on the throttle; full lock at top speed still loses some (estimated ~5 km/h/s instead of ~15), so overdriving a corner still costs.
- Player physics only; AI untouched. Chain bumped (`main.js?v=64`, `race-bootstrap.js?v=24`, `race.html`).
- Verified with `node --check` only; the numbers are estimates from the formulas, to be confirmed in game.

## 2026-09-25 — Brake no longer goes straight into reverse (#103)

- Real test: holding the brake stopped the car and immediately reversed it — `brakeDecel` (75 m/s²) kept applying below zero down to `reverseMaxSpeed`.
- `core/client/race/player-physics.js` (`?v=6`): braking clamps at 0; reverse starts only after the brake is held 0.6 s at a standstill, at 9 m/s² instead of full brake force. Releasing the brake resets the hold.
- Also noted from the same test: a ~244 km/h top speed was probably collision damage (`(1 - damage)` in the speed cap), not a physics regression — the user will check the "Danni" HUD row.
- Chain bumped (`main.js?v=65`, `race-bootstrap.js?v=25`, `race.html`). Verified with `node --check` only.

## 2026-09-25 — Multiplayer race without qualifying (#107)

- Part of the multiplayer experience list (#105). New room flag `qualifying` (default `true`), set by the host with `set_circuit` via the "Qualifica prima della gara" checkbox in `room.html`.
- `core/server/rooms.mjs`: with `qualifying: false`, `startRace` shuffles the reserved drivers into `grid` and goes straight to `sessionPhase: "racing"` with `raceStartedAt`; `room-server.mjs` schedules the qualifying timer only when the phase is `qualifying`.
- Client needs no race-page change: `race.html` already handles a room that is already `racing` through `onGridReady` (the reload-mid-race path).
- Chain: `room-client.js?v=6`, `room.js?v=8`, `race-bootstrap.js?v=26`. Verified with `node --check` and a node run of `startRace` without qualifying. Requires restarting the room server.

## 2026-09-25 — Synced multiplayer start lights (#109)

- Found in code (part of #105): the lights-out hold was already seeded by `raceStartedAt`, but each browser began the sequence at its own engine fire-up, so whoever tapped first started first.
- `core/server/room-server.mjs`: every server reply carries `serverNow`; `room-client.js` (`?v=7`) keeps the clock offset and exposes `serverNow()`, surfaced by `race-multiplayer.js` (`?v=5`).
- `core/client/race/main.js`: `runRaceStartLights` takes an absolute anchor; in multiplayer the sequence starts `MP_START_LEAD_MS` (8 s) after `raceStartedAt` on the server clock. A late engine start joins the sequence in progress, or goes at once if the lights are already out. Solo is unchanged (anchor = now).
- Clock offset ignores one-way latency (tens of ms). Chain: `room.js?v=9`, `main.js?v=66`, `race-bootstrap.js?v=27`. Verified with `node --check` only; needs the room server restarted.

## 2026-09-25 — Smoother remote cars (#111)

- Part of #105. `updateRemoteCar` chased the last `car_state` (~12/s); at 300 km/h samples are ~7 m apart, so the car eased towards a point it had already passed and stuttered.
- `race-multiplayer.js` (`?v=6`) stamps each sample with `receivedAt`; `core/client/race/main.js` now chases the sample projected forward along its heading by `speed × age` (age capped at 250 ms, so a stalled stream stops the car quickly).
- Chain: `main.js?v=67`, `race-bootstrap.js?v=28`. Verified with `node --check` only.

## 2026-09-25 — Shared multiplayer results and rematch (#113)

- Part of #105. `core/server/rooms.mjs`: participants carry `finishedAt`; `reportFinish` records the first finish report (server arrival order is the result); `rematch` (host only) puts the room back in `lobby`, keeping drivers and circuit, clearing ready flags, grid, quali times and finishes. `room-server.mjs` handles `report_finish` / `rematch`.
- `core/client/race/main.js`: in multiplayer `finishRace` reports the finish and shows the room's shared order (finished by `finishedAt`, then "(in gara)" in running order, "N/M arrivati"), re-rendered on every room update. The host's primary button is "Rivincita"; any room back in `lobby` sends every race page to `room.html` (keeping `roomServer`). The old per-browser multiplayer order and "Torna alla home" branch is gone; solo results are unchanged.
- Chain: `room-client.js?v=8`, `race-multiplayer.js?v=7`, `main.js?v=68`, `race-bootstrap.js?v=29`, `room.js?v=10`. Verified with `node --check` and a node run of finish + rematch in `rooms.mjs`; needs the room server restarted.

## 2026-09-25 — Touch offset in iOS home-screen mode (#115)

- User report: launched from the home screen, the race controls were drawn higher than their tap zone.
- `race.html`: `viewport-fit=cover` plus `black-translucent` status bar, so the standalone viewport covers the whole screen and the status bar no longer shifts the layout.
- `race.html`: an inline script pins the document scroll at 0,0 on resize, rotation and scroll.
- Known limit: in portrait the top HUD can now sit under the status bar; the existing CSS already honours the left, right and bottom safe-area insets.
- Verified by syntax check only; needs a test on the device from the home screen.

## 2026-09-26 — Results overlay in landscape (#117)

- `core/client/style.css`: under `(orientation: landscape) and (max-height: 560px)` the results card becomes a two-column grid: the standings scroll on the left, while the title, points and actions (stacked, 44px tall) sit on the right. The overlay padding follows the safe-area insets, which matters now that `viewport-fit=cover` is set (#115).
- `style.css?v` bumped on all four HTML pages.
- Portrait layout is unchanged. Verified with a syntax check only; the user tests on the phone.

## 2026-09-26 — Brake/gas inset from the right edge (#119)

- `core/client/race/race-controls.css`: in landscape the throttle group gets `margin-right: clamp(28px, 6vw, 64px)` and is raised 10px, so the right thumb reaches it without bending (user report). The steering group is unchanged.
- Bumped `race-controls.css?v=45` in `race.html`.
- Verified with a syntax check only; the user tests on the phone.

## 2026-09-26 — Game modes guide page (#121)

- New `modes.html` (root, with `core/client/home/modes.css?v=1`): controls for keyboard, PlayStation pad (Gamepad API mapping from `race-input.js`) and touch/motion; game types: solo championship, multiplayer via ngrok (recommended), multiplayer on a local network.
- LAN section states the real limit: the https GitHub Pages site cannot open `ws://<LAN IP>` (mixed content), so LAN without ngrok needs the game served over http from the host (`python3 -m http.server`), which loses mic (voice send) and iOS motion steering (secure-context only).
- Linked from the home command center as a full-width strip; `style.css` bumped on all pages (index/modes `v=43`, garage `v=28`, race `v=45`, room `v=41`).
- Known gap: tyre compound has no pad button (keyboard 1/2/3 only).
- Verified with `git diff --check` and an HTML parse only.
