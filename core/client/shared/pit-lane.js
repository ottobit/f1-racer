// Pit lane (#147): a real lane beside the start/finish line, shared by the
// race runtime (autopilot path, scenery) and tools/validate-circuits.mjs.
// No three.js here — it only reads the sampled centerline.
//
// No circuit has a straight start/finish: within ±6% of a lap the heading
// already turns 29–85°. So the lane follows the curve at a fixed offset
// instead of being a straight segment, easing in and out of the track on
// smoothstep ramps. Distances are world units along the centerline; `s` = 0
// is the start/finish line (centerline sample 0).

export const PIT_LANE = {
  offset: 6,      // lane centre, past the asphalt edge
  halfWidth: 2.5, // lane asphalt half width
  before: 64,     // lane starts this far before the line
  after: 56,      // and rejoins this far after it
  ramp: 26,       // length of each merge ramp
  box: 8,         // service box, just past the line (in front of the garage)
  step: 1,
};

const smooth = (t) => t * t * (3 - 2 * t);

export function buildPitLane(centerline, width, side = 1) {
  const n = centerline.length, half = width / 2;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const a = centerline[i], b = centerline[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const total = cum[n];
  const before = Math.min(PIT_LANE.before, total * 0.14);
  const after = Math.min(PIT_LANE.after, total * 0.13);
  const ramp = Math.min(PIT_LANE.ramp, before * 0.45, after * 0.45);
  const inner = half - 1.5, lane = half + PIT_LANE.offset;

  function frame(s) {
    s = ((s % total) + total) % total;
    let i = 0;
    while (i < n - 1 && cum[i + 1] <= s) i++;
    const a = centerline[i], b = centerline[(i + 1) % n];
    const t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
    const tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t, tl = Math.hypot(tx, tz) || 1;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: tx / tl, tz: tz / tl };
  }
  function offsetAt(s) {
    let k = 1;
    if (s < -before + ramp) k = smooth(Math.max(0, (s + before) / ramp));
    else if (s > after - ramp) k = smooth(Math.max(0, (after - s) / ramp));
    return inner + (lane - inner) * k;
  }

  const path = [];
  for (let s = -before; s <= after + 1e-6; s += PIT_LANE.step) {
    const f = frame(s), d = offsetAt(s);
    path.push({ x: f.x + f.tz * d * side, z: f.z - f.tx * d * side, s, d, flat: d >= lane - 0.01 });
  }
  let dist = 0, boxIndex = 0;
  path.forEach((p, k) => {
    if (k > 0) dist += Math.hypot(p.x - path[k - 1].x, p.z - path[k - 1].z);
    p.dist = dist;
    const a = path[Math.max(0, k - 1)], b = path[Math.min(path.length - 1, k + 1)];
    p.heading = Math.atan2(b.x - a.x, b.z - a.z);
    if (Math.abs(p.s - PIT_LANE.box) < Math.abs(path[boxIndex].s - PIT_LANE.box)) boxIndex = k;
  });
  return {
    side, half, lane, path, length: dist, boxIndex, boxDist: path[boxIndex].dist,
    entryS: -before, exitS: after, total,
  };
}

// Position and heading `dist` units along the lane (clamped to its ends).
export function pitLanePose(pitLane, dist) {
  const path = pitLane.path;
  dist = Math.min(Math.max(dist, 0), pitLane.length);
  let k = 0;
  while (k < path.length - 2 && path[k + 1].dist < dist) k++;
  const a = path[k], b = path[k + 1];
  const t = (dist - a.dist) / (b.dist - a.dist || 1);
  let dh = b.heading - a.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: a.heading + dh * t };
}

// True when (x, z) lies on the lane asphalt plus `margin` — scenery and
// guardrails keep out of it.
export function nearPitLane(pitLane, x, z, margin = 0) {
  const r = PIT_LANE.halfWidth + margin;
  return pitLane.path.some((p) => Math.hypot(p.x - x, p.z - z) < r);
}
