# Performance and graphics profiles

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

## Performance and graphics profiles

`core/client/shared/graphics-profiles.js` (`loadGraphicsProfile`) picks a rendering cost profile
— DPR cap, shadow map enabled/size, rain particle count and cloud count —
from cheap, synchronous device signals (coarse-pointer media query, CPU core
count, native device pixel ratio), no benchmarking pass. It never touches
`CAR`/`AI` tuning, `TRACK_WIDTH`, `GRASS_LIMIT`/`WALL_LIMIT` or any other
gameplay-visible constant: only rendering cost changes, never physics or race
visibility (#2). The choice persists in `localStorage`
(`f1racer-graphics-profile-v1`); a `?gfx=low|medium|high` URL param overrides
and re-persists it, for testing. There is deliberately no new UI for this on
the home screen — the session-setup panel's "two choices" (difficulty,
driver) is an established, deliberate layout (see
`llm-wiki/wiki/f1-racer/decisions.md`) that a third control would disturb.

Coverage so far is the DPR/shadow/particle-count levers with the clearest
performance-per-risk payoff. Distant-scenery density (`core/client/race/track-art.js`
instancing) and reflections (`core/client/shared/car-model.js`'s studio PMREM environment) are
still not profile-aware — deliberately: without a real measured bottleneck
(the issue's own required first step, still blocked — see below), changing
either would be tuning against a guess, not a finding. See
`llm-wiki/wiki/f1-racer/roadmap.md`.

The Garage now reads the same profile (`core/client/garage/showroom.js`'s `createShowroom`
takes an optional `graphicsProfile`; `core/client/garage/garage.js` passes
`loadGraphicsProfile()`) and applies it to its own renderer's DPR cap and
shadow map, instead of the old viewport-width-only heuristic
(`matchMedia('(max-width: 760px)')`, still the fallback when no profile is
passed). This is a straight extension of an already-decided level system to
a second scene with the same characteristics, not new tuning.

`core/client/race/race-diagnostics.js` (`setupDiagnosticsOverlay`) is a dev-only FPS/frame-time
and `renderer.info` (draw calls, triangles, geometries, textures) overlay.
Off by default — no DOM node is created unless explicitly enabled via
`?diag=1` (persisted in `localStorage` so it survives navigating from
qualifying into the race; `?diag=0` clears it) — so normal play never creates
or sees it. Also wired into the Garage (`core/client/garage/showroom.js` takes an optional
`onFrame(dt)` callback from its own `setAnimationLoop`), covering the
issue's "misurare... più garage" activity the same way the race scene
already was.

Real-device measurement (the issue's own acceptance bar: a measured
before/after on at least one real smartphone and one desktop) has not been
done from this environment, which has no real mobile hardware or GPU
rendering — left for the user's own pass with the diagnostics overlay.
