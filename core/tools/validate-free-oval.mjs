// Checks the free-drive oval (#274): usage `node tools/validate-free-oval.mjs`
// from core/. Verifies the shape (closure, minimum radius), the banking
// (flat straights, inside edge on the ground, smooth ramps, pose signs) and
// that the game's autopilot laps it inside the road. Exits 1 on any failure.
import * as THREE from "three";
import { FREE_OVAL } from "../client/free/oval.js";
import { createBanking, poseOnSurface } from "../client/free/banking.js";
import { createFreeSim } from "../client/free/free-sim.js";
import { createAutopilotProvider } from "../client/race/driver-providers.js";
import { DEFAULT_SETUP, setupEffects } from "../client/shared/garage-setup.js";
import { headingOf, nearestTrackInfo, sampleCenterline, sideNormal } from "../client/shared/track-geometry.js";

const circuit = FREE_OVAL;
const curve = new THREE.CatmullRomCurve3(circuit.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, "catmullrom", circuit.curveTension);
const centerline = sampleCenterline(curve, 480);
const banking = createBanking({ centerline, trackWidth: circuit.width, maxBankDeg: circuit.maxBankDeg, sideNormal });
const failures = [];
const check = (ok, message) => { console.log(`${ok ? "ok  " : "FAIL"} ${message}`); if (!ok) failures.push(message); };
const deg = (rad) => (rad * 180) / Math.PI;
const n = centerline.length;
const half = circuit.width / 2;

// Shape: no tight spots (the road ribbon and the boundary need room).
let minRadius = Infinity;
for (let i = 0; i < n; i++) {
  const a = centerline[(i + n - 1) % n];
  const b = centerline[(i + 1) % n];
  const ds = Math.hypot(b.x - a.x, b.z - a.z);
  const k = Math.abs((b.tx - a.tx) * centerline[i].tz - (b.tz - a.tz) * centerline[i].tx) / ds;
  minRadius = Math.min(minRadius, 1 / Math.max(k, 1e-9));
}
check(minRadius > half * 5, `min radius ${minRadius.toFixed(0)} > ${half * 5} (5 x half width)`);

// Banking profile.
const slopes = banking.slope;
const maxBank = Math.max(...slopes.map((b) => Math.abs(Math.atan(b))));
check(Math.abs(deg(maxBank) - circuit.maxBankDeg) < 0.5, `full bank reaches ${deg(maxBank).toFixed(1)}° (target ${circuit.maxBankDeg}°)`);
check(slopes.filter((b) => Math.abs(b) < 1e-3).length > n * 0.3, "straights are flat (over 30% of the lap has no bank)");
check(new Set(slopes.filter((b) => Math.abs(b) > 1e-3).map(Math.sign)).size === 1, "every turn banks the same way (an oval turns one way)");
let worstInside = 0;
let maxRamp = 0;
for (let i = 0; i < n; i++) {
  const b = slopes[i];
  worstInside = Math.max(worstInside, Math.min(banking.heightAt(b, half), banking.heightAt(b, -half)));
  maxRamp = Math.max(maxRamp, Math.abs(deg(Math.atan(slopes[(i + 1) % n]) - Math.atan(b))));
}
check(worstInside < 1e-6, "the inside edge stays at ground level");
const ds = curve.getLength() / n;
const rollRate = (maxRamp / ds) * 74;
check(rollRate < 25, `roll rate at 74 u/s at most ${rollRate.toFixed(0)}°/s (limit 25)`);

// Pose signs: the +x side of the car must be the high one when roll > 0.
{
  const i = Math.round(n * 0.35);
  const p = centerline[i];
  const info = { idx: i };
  const surface = banking.surfaceAt(p.x, p.z, info);
  const heading = headingOf(p);
  const pose = poseOnSurface(surface, heading);
  const ex = Math.cos(heading);
  const ez = -Math.sin(heading);
  const at = (dx) => banking.surfaceAt(p.x + ex * dx, p.z + ez * dx, nearestTrackInfo(centerline, p.x + ex * dx, p.z + ez * dx)).y;
  check(Math.sign(at(3) - at(-3)) === Math.sign(pose.roll) && Math.abs(pose.roll) > 0.1, "roll matches the surface (car leans with the road)");
}

// The autopilot laps it: inside the road, all the way round.
for (const pace of [0.9, 1]) {
  const sim = createFreeSim({ circuit, curve, effects: setupEffects(DEFAULT_SETUP) });
  const ap = createAutopilotProvider({
    centerline: sim.centerline, headingOf, sideNormal, nearestTrackInfo: sim.nearestTrackInfo,
    maxSpeed: sim.car.maxSpeed, trackLength: sim.trackLength,
  });
  let laps = 0;
  let prev = 0;
  let off = 0;
  for (let t = 0; t < 120; t += 1 / 60) {
    const out = ap.decide(sim.state, 1 / 60, { pace, line: 0, ers: false, station: null });
    sim.steering.value = out.steer;
    sim.input.forward = out.throttle > 0 && !(out.brake > 0);
    sim.input.back = out.brake > 0;
    const info = sim.step(1 / 60);
    if (info.dist > sim.grassLimit) off += 1 / 60;
    const f = info.idx / sim.centerline.length;
    if (prev > 0.9 && f < 0.1) laps++;
    prev = f;
  }
  check(laps >= 3 && off === 0, `autopilot pace ${pace}: ${laps} laps in 120 s, ${off.toFixed(1)} s off the road`);
}

if (failures.length) process.exit(1);
