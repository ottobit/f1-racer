// Pure track-sampling rules, shared between the browser race runtime
// (main.js) and Node-side circuit tooling (tools/validate-circuits.mjs, #6).
//
// This module never imports three.js itself. `sampleCenterline` takes an
// already-built curve object (anything exposing getPointAt(t)/getTangentAt(t)
// that return {x, z, ...}, which THREE.CatmullRomCurve3 does) so the browser
// can pass the CDN build and Node tooling can pass the npm package without
// this module depending on either — both then sample the exact same curve
// math the shipped game actually drives on.

// Evenly spaced samples of a closed curve at parameter t in [0, 1): each
// sample carries its position plus the curve's tangent there, which is all
// downstream code (heading, side normal, road/kerb cross-sections) needs.
export function sampleCenterline(curve, samples) {
  const centerline = [];
  for (let i = 0; i < samples; i++) {
    const t = i / samples;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    centerline.push({ x: p.x, z: p.z, tx: tan.x, tz: tan.z });
  }
  return centerline;
}

export function headingOf(p) {
  return Math.atan2(p.tx, p.tz);
}

// Unit vector perpendicular to the direction of travel at a track point —
// the basis every road/kerb/barrier cross-section is offset along.
export function sideNormal(p) {
  return { x: p.tz, z: -p.tx };
}

function segmentIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1z = p2.z - p1.z, d2x = p4.x - p3.x, d2z = p4.z - p3.z;
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const rx = p3.x - p1.x, rz = p3.z - p1.z;
  const t = (rx * d2z - rz * d2x) / den, u = (rx * d1z - rz * d1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: p1.x + t * d1x, z: p1.z + t * d1z } : null;
}

// The line `d` units off the centerline along each sample's side normal
// (negative d = the other side), as [{x, z}] per sample. Where the curve
// bends tighter than |d| the raw inner offset runs backwards and crosses
// itself (a swallowtail loop), and any strip built from it folds into a
// bow-tie at the apex. Each loop is cut at its self-intersection — a miter
// join — so edges at different offsets stay ordered along the corner's
// bisector and strips between them can't cross either.
export function offsetEdge(centerline, d, maxLoop = 160) {
  const n = centerline.length;
  const at = (k) => ((k % n) + n) % n;
  const pts = centerline.map((p) => ({ x: p.x + p.tz * d, z: p.z - p.tx * d }));
  const backwards = (i) => {
    const a = pts[at(i)], b = pts[at(i + 1)], p = centerline[at(i)];
    return (b.x - a.x) * p.tx + (b.z - a.z) * p.tz < 0;
  };
  for (let i = 0; i < n; i++) {
    if (!backwards(i)) continue;
    let cut = null;
    for (let gap = 2; gap <= maxLoop && !cut; gap++) {
      for (let a = i + 1 - gap; a <= i - 1 && !cut; a++) {
        const hit = segmentIntersection(pts[at(a)], pts[at(a + 1)], pts[at(a + gap)], pts[at(a + gap + 1)]);
        if (hit) cut = { a, b: a + gap, hit };
      }
    }
    if (!cut) { pts[at(i + 1)] = { ...pts[at(i)] }; continue; }
    for (let k = cut.a + 1; k <= cut.b; k++) pts[at(k)] = { ...cut.hit };
    i = Math.max(i, cut.b);
  }
  return pts;
}

// Nearest centerline sample to (x, z): its index (for progress/lookahead),
// its own coordinates, and the straight-line distance to it (used as a
// stand-in for lateral offset from the track for the boundary collision).
export function nearestTrackInfo(centerline, x, z) {
  let bestIdx = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < centerline.length; i++) {
    const p = centerline[i];
    const dx = p.x - x;
    const dz = p.z - z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIdx = i;
    }
  }
  const p = centerline[bestIdx];
  return { idx: bestIdx, x: p.x, z: p.z, dist: Math.sqrt(bestDistSq) };
}
