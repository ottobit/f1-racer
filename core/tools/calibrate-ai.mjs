#!/usr/bin/env node
// AI parity calibration (#329). For every circuit (in its own weather) and
// every car (F1 + the period cars), finds the best flying lap the PLAYER's
// physics can do — the race autopilot driving player-physics.js, pace swept
// for the fastest clean lap — then bisects the race AI's cornerSeverity
// (race-ai.js) until the AI's own flying lap matches it. The AI already gets
// the player's stock limits (main.js); this table only evens out how the two
// driving models take corners. Writes core/client/race/ai-parity.js.
//
//   node core/tools/calibrate-ai.mjs           # rewrite the table
//   node core/tools/calibrate-ai.mjs --check   # print gaps, write nothing
import fs from "node:fs";
import * as THREE from "three";
import { CIRCUITS } from "../shared/circuits.js";
import { VEHICLES, VEHICLE_IDS } from "../client/shared/vehicle.js";
import { DEFAULT_SETUP, setupEffects } from "../client/shared/garage-setup.js";
import { headingOf, nearestTrackInfo, sampleCenterline, sideNormal } from "../client/shared/track-geometry.js";
import {
  createTrackBoundary, createTyreModel, kerbWidthFor,
} from "../client/race/race-rules.js";
import { setupRaceAi } from "../client/race/race-ai.js";
import { setupPlayerPhysics } from "../client/race/player-physics.js";
import { createAutopilotProvider } from "../client/race/driver-providers.js";
import { steeringYaw } from "../client/race/steering.js";
import { aiFromCar } from "../client/race/ai-parity.js";

const OUT = new URL("../client/race/ai-parity-table.js", import.meta.url);
const EFFECTS = setupEffects(DEFAULT_SETUP);
const DT = 1 / 60;
const CHECK = process.argv.includes("--check");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");

// Each car stock, as the rivals drive it (vehicle.js, #339).
function carParams(carId, isRaining) {
  return VEHICLES[carId].stockParams(isRaining);
}

function buildTrack(circuit) {
  const isRaining = circuit.weather === "pioggia";
  const points = circuit.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", circuit.curveTension ?? 0.5);
  const centerline = sampleCenterline(curve, 360);
  const nearest = (x, z) => nearestTrackInfo(centerline, x, z);
  // Fresh tyres for the whole lap, as in main.js's qualifying sim.
  const tyres = createTyreModel({ isRaining, tyreLifeLaps: 1e9 });
  const boundary = createTrackBoundary({ trackWidth: circuit.width, runoffEffect: EFFECTS.runoff, nearestTrackInfo: nearest, kerbWidth: kerbWidthFor(circuit) });
  return { circuit, isRaining, centerline, nearest, length: curve.getLength(), ...tyres, ...boundary };
}

function freshCar(track) {
  const start = track.centerline[0];
  return {
    x: start.x, z: start.z, heading: headingOf(start), speed: 0, prevRawProgress: 0, totalProgress: 0,
    damage: 0, lateralSpeed: 0, yawRate: 0, tyreCompound: "medium", tyreProgress: 0,
    drsActive: false, ersActive: false, ersCharge: 0,
  };
}

function advance(car, raw) {
  let delta = raw - car.prevRawProgress;
  if (delta < -0.5) delta += 1;
  else if (delta > 0.5) delta -= 1;
  car.prevRawProgress = raw;
  car.totalProgress += delta;
}

// Out lap from a standstill, then the timed lap; null if it never closes.
function timeLap(car, step) {
  let t = 0;
  let lapStart = null;
  while (t < 600) {
    step();
    t += DT;
    if (lapStart === null && car.totalProgress >= 1) lapStart = t;
    else if (lapStart !== null && car.totalProgress >= 2) return t - lapStart;
  }
  return null;
}

function playerLap(track, params, pace) {
  const state = freshCar(track);
  const input = { forward: false, back: false, left: false, right: false };
  const steering = { value: 0 };
  const { integratePlayerMotion } = setupPlayerPhysics({
    car: params, state, input, steering, drsSpeedMultiplier: 1, ersSpeedMultiplier: 1,
    grassLimit: track.grassLimit, tireGripFactor: track.tireGripFactor, tyreSpeedFactor: track.tyreSpeedFactor,
    cautionSpeedMultiplier: () => 1, steeringYaw, nearestTrackInfo: track.nearest,
    applyTrackBoundary: track.applyTrackBoundary, slipstreamCars: [],
  });
  const pilot = createAutopilotProvider({
    centerline: track.centerline, headingOf, sideNormal, nearestTrackInfo: track.nearest,
    maxSpeed: params.maxSpeed, findCar: () => null, trackLength: track.length,
  });
  const targets = { pace, line: 0, ers: false, tyre: null, station: null, autoPit: false };
  return timeLap(state, () => {
    const out = pilot.decide(state, DT, targets);
    steering.value = out.steer;
    input.forward = out.throttle > 0 && !(out.brake > 0);
    input.back = out.brake > 0;
    const info = integratePlayerMotion(DT);
    advance(state, info.idx / track.centerline.length);
  });
}

function bestPlayerLap(track, params) {
  let best = null;
  // Slow cars are rarely grip-limited: their best lap can be far above pace 1.
  for (let pace = 0.55; pace <= 2.001; pace += 0.025) {
    const lap = playerLap(track, params, pace);
    if (lap !== null && (best === null || lap < best)) best = lap;
  }
  return best;
}

function aiLap(track, ai) {
  const car = freshCar(track);
  const sim = setupRaceAi({
    ai, trackWidth: track.circuit.width, grassLimit: track.grassLimit, isRace: () => false,
    centerline: track.centerline, headingOf, sideNormal, nearestTrackInfo: track.nearest,
    applyTrackBoundary: track.applyTrackBoundary, advanceProgress: advance,
    tireGripFactor: track.tireGripFactor, tyreSpeedFactor: track.tyreSpeedFactor,
    drsSpeedMultiplier: 1, ersSpeedMultiplier: 1, cautionSpeedMultiplier: () => 1,
  });
  return timeLap(car, () => sim.updateAiCar(car, DT, [car]));
}

// Lap time grows with cornerSeverity; bisect it to the reference lap. Where
// even no corner slowdown is too slow (a slow car on a twisty track: the
// AI's steering can't carry the speed the player's physics can), give the
// AI a steering multiplier, then a pace multiplier, bisected the same way.
function bisect(lo, hi, lapAt, target, slowerUp) {
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const lap = lapAt(mid);
    const tooSlow = lap === null || lap > target;
    if (tooSlow === slowerUp) hi = mid;
    else lo = mid;
  }
  return +((lo + hi) / 2).toFixed(3);
}

function calibrate(track, params, target) {
  // Steering first (a heavy car on a wet, twisty track can't turn in at the
  // player's rate under the AI's simpler model), then pace.
  for (const turn of [1, 1.25, 1.5, 2]) {
    const lapAt = (severity) => aiLap(track, aiFromCar(params, { severity, turn }));
    const fastest = lapAt(0);
    if (fastest === null || fastest > target) continue;
    const severity = bisect(0, 1.5, lapAt, target, true);
    return { severity, turn, speed: 1, lap: lapAt(severity) };
  }
  const lapAt = (speed) => aiLap(track, aiFromCar(params, { severity: 0, speed }));
  const speed = bisect(1, 1.6, lapAt, target, false);
  return { severity: 0, turn: 1, speed, lap: lapAt(speed) };
}

const table = {};
const cars = VEHICLE_IDS;
for (const circuit of CIRCUITS.filter((c) => !ONLY || ONLY.includes(c.id))) {
  const track = buildTrack(circuit);
  table[circuit.id] = {};
  const row = [];
  for (const carId of cars) {
    const params = carParams(carId, track.isRaining);
    const target = bestPlayerLap(track, params);
    if (target === null) {
      row.push(`${carId} no-ref`);
      continue;
    }
    const { severity, turn, speed, lap } = calibrate(track, params, target);
    table[circuit.id][carId] = { severity, ...(turn === 1 ? {} : { turn }), ...(speed === 1 ? {} : { speed }) };
    const gap = lap ? ((lap / target - 1) * 100).toFixed(1) : "dnf";
    row.push(`${carId} ${JSON.stringify(table[circuit.id][carId]).replace(/"/g, "")} (${gap}%)`);
  }
  console.log(`${circuit.id}${track.isRaining ? " (pioggia)" : ""}: ${row.join(", ")}`);
}

if (!CHECK) {
  const body = Object.entries(table)
    .map(([id, cars]) => `  ${id}: { ${Object.entries(cars).map(([car, v]) => `${car}: ${JSON.stringify(v).replace(/"/g, "").replace(/([:,])/g, "$1 ").replace(/^\{/, "{ ").replace(/\}$/, " }")}`).join(", ")} },`)
    .join("\n");
  fs.writeFileSync(OUT, `// Generated by core/tools/calibrate-ai.mjs (#329) — do not edit by hand.\n// Per circuit (in its own weather) and car: the race AI's tuning (cornerSeverity,\n// steering and pace multipliers) that makes its flying lap match the player's best one.\nexport const AI_TUNING = {\n${body}\n};\n`);
  console.log("wrote", OUT.pathname);
}
