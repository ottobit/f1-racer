// Banked corners for the free-drive oval (#274). Pure functions over a
// sampled centerline: no three.js, so the rules can be checked in Node.
//
// Model: a corner is banked toward its centre, so the outside is the high
// side. The road pivots on its INSIDE edge, which stays at ground level
// (y = 0), so the infield needs no ramps and the banking never sinks below
// the ground plane. Straights are flat.
//
//   B(i)      signed bank slope tan(angle) at centerline sample i; positive
//             when the centre of the corner lies toward +sideNormal
//   y(d)      = |B| * halfWidth - B * d        (d = offset along sideNormal)
//   gradient  = -B * sideNormal                (direction and slope of "up")
//
// The physics stays 2D: only the pose (height, roll, pitch) and a grip
// bonus derive from this, so the car cannot leave its ground track.

const BANK_SMOOTH_PASSES = 4;
const BANK_SMOOTH_HALF_WINDOW = 14; // samples per pass
// Bend sharper than this (1 / radius) gets the full bank.
const FULL_BANK_CURVATURE = 1 / 200;
// Extra lateral grip per unit of sin(bank angle): gravity presses the car
// into the surface and the surface pushes it toward the centre.
export const BANK_GRIP_GAIN = 0.5;

const smoothstep = (t) => t * t * (3 - 2 * t);

export function createBanking({ centerline, trackWidth, maxBankDeg = 24, sideNormal }) {
  const n = centerline.length;
  const half = trackWidth / 2;
  const at = (i) => ((i % n) + n) % n;
  const maxSlope = Math.tan((maxBankDeg * Math.PI) / 180);

  // Signed curvature toward +sideNormal from the tangent's change.
  const curvature = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = centerline[at(i - 1)];
    const b = centerline[at(i + 1)];
    const p = centerline[i];
    const ds = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nrm = sideNormal(p);
    curvature[i] = ((b.tx - a.tx) * nrm.x + (b.tz - a.tz) * nrm.z) / ds;
  }
  let smooth = Array.from(curvature);
  for (let pass = 0; pass < BANK_SMOOTH_PASSES; pass++) {
    const next = new Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -BANK_SMOOTH_HALF_WINDOW; k <= BANK_SMOOTH_HALF_WINDOW; k++) sum += smooth[at(i + k)];
      next[i] = sum / (2 * BANK_SMOOTH_HALF_WINDOW + 1);
    }
    smooth = next;
  }
  const slope = smooth.map((k) => {
    const t = Math.min(Math.abs(k) / FULL_BANK_CURVATURE, 1);
    return Math.sign(k) * maxSlope * smoothstep(t);
  });

  // Slope at an arbitrary point: linear between the two nearest samples,
  // by the position along the track direction (avoids steps at idx changes).
  function slopeAt(x, z, idx) {
    const p = centerline[idx];
    const along = (x - p.x) * p.tx + (z - p.z) * p.tz;
    const other = along >= 0 ? at(idx + 1) : at(idx - 1);
    const q = centerline[other];
    const segment = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const t = Math.min(Math.abs(along) / segment, 1);
    return slope[idx] + (slope[other] - slope[idx]) * t;
  }

  // Ground pose at (x, z): height, world-space gradient of the surface and
  // the bank angle. `info` is nearestTrackInfo's result for the same point.
  function surfaceAt(x, z, info) {
    const p = centerline[info.idx];
    const nrm = sideNormal(p);
    const d = (x - p.x) * nrm.x + (z - p.z) * nrm.z;
    const b = slopeAt(x, z, info.idx);
    const dClamped = Math.max(-half, Math.min(half, d));
    return {
      y: Math.abs(b) * half - b * dClamped,
      gradX: -b * nrm.x,
      gradZ: -b * nrm.z,
      bankAngle: Math.atan(b),
      offset: d,
      onRoad: Math.abs(d) <= half,
    };
  }

  // Height of the road at offset d (along sideNormal) for a signed slope b.
  const heightAt = (b, d) => Math.abs(b) * half - b * Math.max(-half, Math.min(half, d));

  // Signed slope at a fraction f of the lap (0..1), for meshes sampled more
  // finely than the centerline.
  function slopeAtFraction(f) {
    const position = (((f % 1) + 1) % 1) * n;
    const i = Math.floor(position);
    const t = position - i;
    return slope[at(i)] + (slope[at(i + 1)] - slope[at(i)]) * t;
  }

  return { slope, slopeAt, surfaceAt, heightAt, slopeAtFraction, maxSlope };
}

// Car pose on a surface: pitch (nose up positive) and roll about the
// forward axis (rotation.z of a heading-only Y-rotated group, with the
// group's Euler order set to "YXZ"), from the surface gradient and heading.
export function poseOnSurface(surface, heading) {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const ex = Math.cos(heading); // local +x axis in world xz
  const ez = -Math.sin(heading);
  const slopeAlong = surface.gradX * fx + surface.gradZ * fz;
  const slopeSide = surface.gradX * ex + surface.gradZ * ez;
  return { pitch: Math.atan(slopeAlong), roll: Math.atan(slopeSide) };
}

// Lateral-grip multiplier from the local bank (1 on the flat or off the road).
export function bankGripFactor(surface) {
  if (!surface.onRoad) return 1;
  return 1 + BANK_GRIP_GAIN * Math.sin(Math.abs(surface.bankAngle));
}
