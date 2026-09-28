import { DRIVER_ROSTER } from "../shared/driver-roster.js?v=2";

// Race rules shared by the browser runtime (main.js) and the headless room
// bot (core/tools/headless-room-bot.mjs, #214): car limits, tyres, ERS, DRS,
// pit lane, runoff, grid and contact constants. No three.js, no DOM — a bot
// racing outside the browser must drive the very same car, never a copy of
// its numbers that drifts (the first headless bot ran on its own rules).

// Light dynamic weather: rain only touches cornering grip and top speed.
export const RAIN_TURN_RATE_MULTIPLIER = 0.82;
export const RAIN_MAX_SPEED_MULTIPLIER = 0.93;

// Top speed is tuned to a realistic F1 figure (maxSpeed is treated as m/s
// for the km/h readout, so 88 -> ~317 km/h on a straight, ~340 with ERS or
// DRS on a low-drag setup — #151) — accel/brakeDecel/coastDecel scale with
// it so 0-100%, braking distance and grass drag all feel like the same car.
export function playerCarParams(effects, isRaining) {
  return {
    maxSpeed: 88 * (1 + effects.speed * 0.006) * (isRaining ? RAIN_MAX_SPEED_MULTIPLIER : 1),
    reverseMaxSpeed: -28,
    // Launch acceleration (m/s²); fades with speed in player-physics.js.
    // Was a flat 47 (0-100 km/h in 0.6s); now ~1.8s 0-100, ~4s 0-200.
    accel: 16 * (1 + effects.traction * 0.006),
    brakeDecel: 75 * (1 + effects.braking * 0.018),
    coastDecel: 28,
    // rad/s ceiling; the actual rate is scaled down further by speed in
    // player-physics.js — a single quick tap used to be enough to spin off
    // track at top speed, so turn authority drops off as you speed up.
    maxTurnRate: 2.0 * (1 + effects.downforce * 0.012) * (isRaining ? RAIN_TURN_RATE_MULTIPLIER : 1),
  };
}

// Tire wear degrades grip gradually over the race distance for both player
// and AI, cutting into cornering rate rather than straight-line pace.
export const TIRE_WEAR_MAX_TURN_PENALTY = 0.22; // steering authority lost at full wear
// Worn tyres also cost top speed (#149): about 1 s a lap at full wear on a
// medium set.
export const TIRE_WEAR_MAX_SPEED_PENALTY = 0.05;

// Lightweight race compounds: initial grip and the rate grip is lost.
export const TYRE_COMPOUNDS = {
  soft: { label: "SOFT", grip: 1.06, wearRate: 1.35 },
  medium: { label: "MED", grip: 1.0, wearRate: 1.0 },
  hard: { label: "HARD", grip: 0.95, wearRate: 0.75 },
};
export const TYRE_ORDER = ["soft", "medium", "hard"];

export function createTyreModel({ isRaining, tyreLifeLaps }) {
  function tyreWear(totalProgress, car) {
    const distance = car?.tyreProgress ?? totalProgress;
    return Math.min(Math.max(distance / tyreLifeLaps, 0), 1);
  }
  function tireGripFactor(totalProgress, car = null) {
    const tyre = TYRE_COMPOUNDS[car?.tyreCompound] || TYRE_COMPOUNDS.medium;
    const wear = tyreWear(totalProgress, car);
    const wetGrip = isRaining ? 0.82 : 1;
    return tyre.grip * (1 - TIRE_WEAR_MAX_TURN_PENALTY * wear * tyre.wearRate) * wetGrip;
  }
  function tyreSpeedFactor(car) {
    const tyre = TYRE_COMPOUNDS[car.tyreCompound] || TYRE_COMPOUNDS.medium;
    return 1 - TIRE_WEAR_MAX_SPEED_PENALTY * tyreWear(car.totalProgress, car) * tyre.wearRate;
  }
  return { tyreWear, tireGripFactor, tyreSpeedFactor };
}

export const ERS_SPEED_MULTIPLIER = 1.05;
export const ERS_DRAIN_PER_SECOND = 24;
export const ERS_RECHARGE_PER_SECOND = 7;
export const PIT_SPEED_LIMIT = 18;
export const PIT_SERVICE_MS = 2200;

export const START_FINISH_OFFSET = 5;

// --- DRS -------------------------------------------------------------------
// A short zone right after the line: a car within roughly one second of the
// car directly ahead gets a temporary top-speed boost while in the zone.
export const DRS_ZONE_FRACTION = 0.1; // first 10% of the lap, right after the line
export const DRS_GAP_SECONDS = 1.0;
// +8% (~25 km/h): closer to real DRS than the old +15% (#151).
export const DRS_SPEED_MULTIPLIER = 1.08;

// Sets car.drsActive for this frame on every car in `cars`, from each one's
// gap — in seconds, estimated from its own current speed — to whoever is
// directly ahead of it on track (totalProgress from the previous frame).
export function updateDrsEligibility(cars, trackLength) {
  const order = [...cars].sort((a, b) => b.totalProgress - a.totalProgress);
  for (let i = 0; i < order.length; i++) {
    const car = order[i];
    const lapFraction = car.totalProgress - Math.floor(car.totalProgress);
    if (i === 0 || lapFraction >= DRS_ZONE_FRACTION) {
      car.drsActive = false;
      continue;
    }
    const ahead = order[i - 1];
    const gapMeters = (ahead.totalProgress - car.totalProgress) * trackLength;
    const gapSeconds = gapMeters / Math.max(Math.abs(car.speed), 1);
    car.drsActive = gapSeconds < DRS_GAP_SECONDS;
  }
}

// --- Runoff ------------------------------------------------------------------
// Running wide costs grip: past the asphalt edge the car is dragged down
// progressively (front-loaded, see the 0.28 floor) towards a crawl, never
// snapped back by an invisible wall.
// Outer edge of the painted kerb beyond the asphalt edge (track-art.js
// kerb profiles): Marzamemi's street kerb is narrower.
export function kerbWidthFor(circuit) {
  return circuit && circuit.theme === "marzamemi" ? 0.7 : 0.95;
}

// Like real track limits, a car is off only once its centre is past the
// kerb, i.e. roughly all four wheels are beyond the asphalt edge. Riding the
// kerb costs a little speed; runoff drag starts past it.
export function createTrackBoundary({ trackWidth, runoffEffect, nearestTrackInfo, kerbWidth = 0.95 }) {
  const kerbStart = trackWidth / 2; // asphalt edge, where the kerb starts
  const grassLimit = kerbStart + kerbWidth; // outer kerb edge: off track past here
  const wallLimit = grassLimit + 4; // runoff drag ramp length; no hard stop
  const grassMaxDecel = 240 * (1 - runoffEffect * 0.035); // units/s² of extra drag
  const kerbDecel = grassMaxDecel * 0.015; // ~5% of the lightest grass drag
  const crawlSpeed = 8;
  function slow(car, decel) {
    if (car.speed > crawlSpeed) car.speed = Math.max(crawlSpeed, car.speed - decel);
    else if (car.speed < -crawlSpeed) car.speed = Math.min(-crawlSpeed, car.speed + decel);
  }
  function applyTrackBoundary(car, dt, info) {
    info = info || nearestTrackInfo(car.x, car.z);
    if (info.dist > grassLimit) {
      const runoffDepth = info.dist - grassLimit;
      const t = Math.min(runoffDepth / (wallLimit - grassLimit), 1);
      slow(car, grassMaxDecel * (0.28 + 0.72 * t) * dt);
    } else if (info.dist > kerbStart) {
      slow(car, kerbDecel * dt);
    }
    return info;
  }
  return { grassLimit, applyTrackBoundary };
}

// --- Grid ----------------------------------------------------------------------
// A real F1 grid is single-file: each position steps back from the one
// before it and alternates side (P1/P3/P5... one diagonal, P2/P4/P6... the
// other). Pole first.
// Derive capacity from the roster, just like the multiplayer server.
export const GRID_SLOTS = DRIVER_ROSTER.map((_, row) => ({ row, lane: row % 2 ? 1 : -1 }));
const GRID_ROW_GAP = 5; // meters behind the previous row

// Places a grid slot by walking backward along the actual centerline from
// the start/finish line — a couple of circuits have the line just before a
// bend, where a straight-line offset would cut across the grass.
export function createGridSlot({ centerline, trackWidth, trackLength, headingOf, sideNormal }) {
  const laneOffset = Math.min(trackWidth / 4, 3.2); // stay clear of grass
  const rowSamples = Math.max(1, Math.round((GRID_ROW_GAP / trackLength) * centerline.length));
  return function gridSlot(row, lane) {
    const idx = (((-row * rowSamples) % centerline.length) + centerline.length) % centerline.length;
    const p = centerline[idx];
    const lateral = sideNormal(p);
    return {
      x: p.x + lateral.x * laneOffset * lane,
      z: p.z + lateral.z * laneOffset * lane,
      heading: headingOf(p),
    };
  };
}

// --- Contact -------------------------------------------------------------------
// Cars bumping each other lose speed and get pushed apart; damage follows
// relative impact speed, equally for everyone.
export const CAR_RADIUS = 1.0; // rough footprint for car-vs-car contact
export const DAMAGE_MIN_IMPACT_SPEED = 7;
export const DAMAGE_PER_IMPACT_SPEED = 0.003;
export const DAMAGE_MAX_SPEED_PENALTY = 0.25; // hard cap: never lose more than this
