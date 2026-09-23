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
