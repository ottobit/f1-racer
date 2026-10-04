# Performance and graphics profiles

## Profiles (`core/client/shared/graphics-profiles.js`, #2)

- **Choice:** `loadGraphicsProfile()` picks a rendering-cost profile from
  cheap, synchronous device signals: coarse pointer, CPU cores and native
  DPR. There is no benchmark.
- **What it changes:** the DPR cap, the shadow map (on or off, and its size),
  the rain particle count and the cloud count.
- **What it never changes:** gameplay constants, physics or what the player
  can see of the race.
- **Storage:** `f1racer-graphics-profile-v1`. `?gfx=low|medium|high`
  overrides it and saves the new value.
- **UI:** there is none on purpose. The home session setup keeps its two
  choices ([decisions.md](decisions.md)).
- **Where it applies:** in the race and in the garage showroom.
- **Not yet profile-aware:**
  - scenery instancing density;
  - reflections (the studio PMREM).
  These wait for a real measured bottleneck.
- **User preference:** phones keep full fps. Reduce load by other means,
  never by cutting the frame rate.

## Diagnostics overlay (`core/client/race/race-diagnostics.js`)

- **What it shows:** a dev-only overlay with FPS, frame time and
  `renderer.info` (draw calls, triangles, geometries, textures).
- **How to turn it on:**
  - it is off by default;
  - `?diag=1` turns it on and the choice persists across qualifying and the
    race;
  - `?diag=0` clears it.
- **Where:** the race, and the garage through `onFrame(dt)`.

## Open

A before/after measurement on a real phone and a desktop has not been done
yet. That is the user's pass, using `?diag=1`.
