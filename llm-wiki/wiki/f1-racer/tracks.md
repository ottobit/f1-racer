# Tracks and lap counting

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

## 6. Track system

Circuit geometry is defined in `core/shared/circuits.js`.

The runtime builds a centerline sampled into track points and uses Catmull-Rom spline geometry.

The track query system provides:
- nearest centerline point;
- distance from track;
- local track direction;
- side normal;
- progress index.

The track is also used for:
- grid placement;
- AI targeting;
- lap progress;
- track limits;
- minimap;
- camera context.

`marzamemi` is the sixth circuit and the first adapted from a supplied real
route. Its separated dogbone spline preserves the long parallel street legs
and both end loops while leaving enough clearance for a closed racing surface.
It uses a narrow nine-unit urban road and its own Garage recommendation.

`pianalago`, `serramonte` and `baiadoro` (#5) bring the roster to nine. Unlike
the first six's hand-placed points, all three were generated procedurally
(star-convex placement with a per-circuit angular radius profile — a smooth
low-amplitude one for Pianalago's sweeps, higher-frequency corners for
Serramonte's hairpins, one dominant long-straight harmonic for Baiadoro) and
accepted only once `core/tools/validate-circuits.mjs` (#6) reported zero errors
and warnings — see each entry's comment in `core/shared/circuits.js` for the exact
command. Every circuit in the roster now has a distinct integer width, 9
through 17. Serramonte is now the tightest/narrowest circuit overall
(Montenero's comment was updated to stop claiming that superlative); Baiadoro
is the widest, pairing a long straight with a tighter technical final complex
rather than uniform sweeps.

All three were reworked again for #26: the initial star-convex shapes were
too round (smooth wave harmonics only, no corner near the wall-margin
threshold), so each now also gets a hairpin-insertion pass — a base point
replaced by a tight approach/apex/exit triple of closely-angle-spaced
points, the same technique Marzamemi's real-street corners already used —
tuned per circuit (`spreadDeg`/`depthFactor`) and re-validated until the
minimum curvature radius sits comfortably (~15-18%, not borderline) above
the wall margin. Pianalago keeps two corners tightened this way (still the
most flowing of the three); Serramonte gets three real hairpins; Baiadoro
gets one deep hairpin at the end of its long straight.

### Shared geometry rules and offline validation

`core/client/shared/track-geometry.js` owns the pure, framework-agnostic rules used to turn a
circuit's raw control points into the runtime's centerline: sampling the
closed curve, deriving heading/side-normal at a sample, finding the
nearest sample to a point, and building fold-free offset edges for the
road-hugging meshes (`offsetEdge`). It takes an already-built curve object rather
than importing three.js itself, so the exact same rules run both in
`core/client/race/main.js` (fed the browser's CDN three.js build) and in
`core/tools/validate-circuits.mjs` (fed the pinned npm `three` build — see
`package.json`, a dev-only dependency never shipped with the static site).

`node tools/validate-circuits.mjs [ids...] [--svg [outDir]]` (#6) checks
every circuit in `core/shared/circuits.js` for a broken closure, a self-crossing or
reversed loop, degenerate/oversized sampled segments, corners tighter than
the runtime's own wall margin (`width/2 + 4`, same formula as `WALL_LIMIT`
in `core/client/race/main.js` — a corner this tight is also where a kerb ribbon would
detach), and two unrelated parts of the track running closer together than
their wall margins allow. A circuit can declare a documented, narrower
floor for the last check when it's intentionally close (Marzamemi's shared
coastal corridor is the current example) — still flagged as a warning, not
silently skipped, so a further regression is still caught. `--svg` writes a
top-down diagnostic preview per circuit to `tools/out/` (gitignored,
dev-only, not referenced by the shipped game).

Known gap (found in #28, **Open**): the curvature check measures a 3-point
circumradius over a 5-sample window of the 360-sample centerline, which
smooths away near-cusps. Measured on a dense sampling, the spline's true
minimum radius is ~1 unit at some apexes of Marzamemi (by design, tension
0.18) and of the #26 hairpin-insertion corners on Serramonte and Baiadoro
(Pianalago ~5) — so the "+15–18% above wall margin" figures recorded for #26
describe the smoothed stencil, not the actual apex, which is closer to a V
than a rounded hairpin. Rendering is now immune (`offsetEdge`); whether to
round those apexes and make the validator check true curvature is a separate
decision.

## 7. Race progress and lap counting

Race position is based on `totalProgress`, a monotonic travelled-distance accumulator.

This avoids comparing raw centerline fractions for cars that start at different physical grid offsets.

The same progress concept drives:
- lap counting;
- race ordering;
- player position HUD;
- finish condition.

## Circuit carousel and bilateral contact

The home circuit grid is now a single map-led carousel. `core/client/home/menu.js` normalizes
each circuit's control points into an inline SVG map and keeps swipe, arrow,
keyboard and dot navigation on one selected index. The active slide combines
track character, weather, race status and a large launch action; mobile arrows
and dots keep 44–48 px touch targets.

`core/client/race/race-collisions.js` owns car-to-car overlap correction and equal-mass impulse
transfer. Both player and AI cars can lose forward speed, gain a damped lateral
slide and yaw, and receive the same capped damage from hard relative impacts.
Sparks and player camera shake expose meaningful contact while a short cooldown
prevents continuous damage from one lingering overlap. AI lateral/yaw recovery
is integrated in `core/client/race/race-ai.js`; the existing HUD already reveals player damage.

The home follows an action-first order. A prominent Garage command and a direct
race shortcut sit immediately below the hero; difficulty and driver are grouped
as one session setup. Circuit selection remains the main interactive stage, and
championship standings come afterward as reference information. This keeps the
Garage discoverable before users commit to a circuit, especially on mobile.

The mobile session setup uses two explicit steps. Difficulty is a three-column
segmented control with a short explanation per level; the ten drivers use a
numbered three-column grid with 54 px touch targets, switching to two columns below
365 px. Active choices combine border, inset marker and background rather than
depending on color alone.

The circuit slide itself is not a link. Its only navigation target is the
thumb-sized `Scendi in pista` CTA, which carries the selected circuit and
difficulty in its URL. This prevents accidental race launches during swipe and
avoids presenting two competing start buttons.

The swipe handler ignores mouse pointers and any pointer that begins on the
CTA. Desktop navigation therefore remains a standard link click, while touch
and pen can still swipe from the rest of the circuit card.
