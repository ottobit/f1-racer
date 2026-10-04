---
type: entity
updated: 2026-10-04
sources: []
---

# Tracks and lap counting

## Circuits (`core/shared/circuits.js`)

- There are **nine** circuits: vallechiara, portoscuro, altomare, montenero,
  colleverde, marzamemi, pianalago, serramonte and baiadoro.
- Each circuit holds:
  - its control points and width;
  - its weather and race format (laps, tyre life);
  - its recommended garage setup ([garage.md](garage.md)).
- The file sits in `core/shared/` because the room server also reads it.
- Every circuit has a distinct integer width, from 9 to 17. Serramonte is
  the narrowest and Baiadoro the widest.
- **Marzamemi** follows a real supplied street route: a dogbone with long
  parallel legs and a narrow 9-unit road. It has its own coastal dressing
  (`theme: "marzamemi"`).
- **Pianalago, Serramonte and Baiadoro** (#5, reworked in #26) were made
  procedurally:
  - star-convex shapes, plus a hairpin-insertion pass;
  - each was accepted only once the validator reported zero issues.

## Geometry (`core/client/shared/track-geometry.js`)

- Pure rules with no three.js import (they take a curve object):
  - sample the closed Catmull-Rom curve;
  - compute heading and side normal;
  - find the nearest sample;
  - build `offsetEdge` miter-cut edges.
- The same rules run in the browser and in `core/tools/validate-circuits.mjs`.
- Gameplay uses a 360-sample `centerline`. It serves grid placement, AI
  targeting, progress, track limits, the minimap and the camera corridor.
- Road meshes use `visualCenterline` (4× denser) together with `offsetEdge`.
  Tight apexes therefore never fold into bow-tie shards.

## Offline validator (`core/tools/validate-circuits.mjs`, #6)

Run it from `core/`:

```
node tools/validate-circuits.mjs [ids...] [--svg [outDir]]
```

It checks for:
- a broken closure;
- a self-crossing or reversed loop;
- degenerate segments;
- corners tighter than the wall margin (`width/2 + 4`, the same as
  `WALL_LIMIT`);
- unrelated legs closer than their margins.

A circuit can declare a documented narrower floor for close legs; Marzamemi
does. That case is still reported as a warning.

**Open** (#28): the curvature check uses a 5-sample stencil, which smooths
away near-cusps. The real apex radius is about 1 unit on Marzamemi,
Serramonte and Baiadoro. Rendering is safe, but whether to round those apexes
is undecided.

## Track dressing (`core/client/race/track-art.js`)

- Textures are seeded procedural asphalt and grass.
- The dressing includes:
  - runoff and painted lines;
  - instanced posts and trees;
  - low mountains and pit-straight buildings.
  None of it is a collision object.
- Kerbs are two continuous ribbons per circuit (`weldedKerb`, #28) with
  red/white UV stripes. Separate tangent boxes must not come back: they left
  wedges in tight corners.
- Guardrails are one swept section per continuous run (`sweptRails`). A rail
  is kept only where its own stretch of track is the closest one.
- Marzamemi has its own instanced coastal street scene and no generic
  guardrails.
- Pit lane and crews: [architecture.md](../synthesis/architecture.md#shared-car-model).

## Race progress (`core/client/race/race-progress.js`)

- Position comes from `totalProgress`, a running total of distance
  travelled. Cars starting at different grid offsets still compare correctly.
- A lap counts only when two things happen in order:
  - the car reaches the opposite half of the circuit;
  - it then crosses the painted finish line going forward.
  Progress alone never ends a race.
- Each car's finishing position is locked when it crosses the line.
