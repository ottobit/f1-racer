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
