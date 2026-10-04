# Phone heat: BOTW-style plan (2026-10-04)

Raw input: plan discussed in chat after cycles #379, #381, #383, #385.
Not yet a decision; to be ingested into `wiki/concepts/performance.md`
only when a cycle lands.

## Where we are

- Done on touch devices: light shadows (only the player's car casts,
  map <=512, #381), DPR cap 1.25, lite materials, 30 fps cap (#385),
  one shared AudioContext for every voice (#385), MSAA kept (#383, no
  measured heat difference).
- User report: solo races stay cool after #381. Multiplayer with real
  people talking was still hot before #385 and has not been retested
  since.
- 12-car test with bots (room XUY44K): steady 30 fps / 33.3 ms,
  220 draw calls, ~156k triangles, `ctx 1`. The bots did not talk, so
  voice decoding was not loaded.
- No temperature API on iPhone. The only signal is `?diag=1`: fps
  dropping below the cap or ms rising over time means thermal
  throttling.

## Why the Switch did not heat

- Hardware first: active fan, fixed device, native code. A phone is
  passively cooled and Safari translates WebGL to Metal.
- BOTW's own savings, usable in three.js: 30 fps lock, dynamic
  resolution, stylised (cheap) lighting, fog and short draw distance,
  LOD for distant objects, baked lighting.

## Step 0: measure (no code)

Protocol, the same every time:
- 15 minutes, same circuit, `?diag=1`, phone not charging, same
  brightness;
- write down fps/ms at 0, 5, 10 and 15 minutes, and how hot the phone
  feels (1-5);
- run A: solo; run B: multiplayer with people talking.

Rule: 30 fps holding = warm but healthy, stop optimising. Dropping =
real throttling, go on to the steps below.

## Step 1: dynamic resolution (touch only)

- `graphics-profiles.js`: phone DPR starts at 1.0 (~36% fewer pixels
  than 1.25).
- New `DynamicResolution` class (`shared/dynamic-resolution.js`):
  - reads the average frame time over ~2 s;
  - lowers DPR one step (1.0 -> 0.85 -> 0.75) when it is over 25 ms;
  - raises it again after ~10 s under 20 ms;
  - calls `renderer.setPixelRatio` only on a step change, never per
    frame.
- Used in race and free drive. `?diag=1` shows the current DPR.
- Risk: blurrier image on the phone; `?gfx=high` keeps today's
  behaviour.

## Step 2: fog and shorter draw distance (touch only)

- Linear fog matching the sky colour.
- Camera `far` cut so scenery past the fog is not drawn.
- Check that the start lights and the pit-lane signals stay inside the
  visible range.

## Later, only if steps 1-2 are not enough

- LOD for rival cars: a simpler mesh past ~80 m (`detail:false` already
  exists for the road cars).
- Unlit / toon materials for scenery on phones.
- Baked shadows in the track textures: the biggest change, it needs
  asset work.

## Flow

One cycle (issue -> `cycle/<N>-phone-dynamic-res` -> draft PR), one
commit per step, `?vNN` bumped up to the HTML pages. The user tests on
`master` with the step 0 protocol before and after.
