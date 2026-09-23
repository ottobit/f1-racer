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
