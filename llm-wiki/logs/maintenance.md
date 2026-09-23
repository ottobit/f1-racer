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
