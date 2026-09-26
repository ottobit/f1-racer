// Driver providers (#7): who drives the local car when nobody holds the
// controls — a room bot joining like any other participant, same protocol.
//
// Every provider shares one contract, so the two layers used today can be
// swapped for a single model once one is fast enough to drive every frame:
//
//   decide(car, dt) -> { steer, throttle, brake, pit?, tyre?, ers?, radio? }
//
// - AutopilotProvider: the fast layer, every frame, pure geometry.
// - LayeredProvider: the autopilot plus slow strategy targets (pace, line,
//   ERS, box calls, radio) pushed from outside at any rate through
//   window._DRIVER_.setStrategy(); the last valid targets stay in force.

const PACE_MIN = 0.5;
const PACE_MAX = 1;
const DEFAULT_TARGETS = { pace: 0.86, line: 0, ers: false, tyre: null, station: null };
const STATION_GAIN = 0.8; // m/s of correction per metre off station (#182)
const STATION_MAX_CATCH_UP = 25;
const STATION_MAX_DROP_BACK = 15;
const TYRES = new Set(["soft", "medium", "hard"]);
const RADIO_MAX_CHARS = 80;

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// Same corner preview and outside-inside line as the AI rivals
// (race-ai.js), turned into pedal/steer inputs for the player physics
// instead of moving the car directly.
// Station keeping (#182): with targets.station = {car, gap, side} it holds a
// spot relative to another car (gap metres, + ahead / - behind; side -1..1)
// by speed and line alone — never by moving the car directly.
export function createAutopilotProvider({ centerline, headingOf, sideNormal, nearestTrackInfo, maxSpeed, findCar, trackLength }) {
  const LOOKAHEAD = 10;
  const CORNER_LOOKAHEAD = 22;
  const STEER_GAIN = 3; // matches driveFinishCoast in main.js
  const SPEED_MARGIN = 1.5; // m/s over target before braking

  function cornerProfile(startIdx) {
    let totalTurn = 0;
    let maxTurnStep = 0;
    let previous = headingOf(centerline[startIdx]);
    for (let step = 1; step <= CORNER_LOOKAHEAD; step++) {
      const heading = headingOf(centerline[(startIdx + step) % centerline.length]);
      const delta = wrapAngle(heading - previous);
      totalTurn += delta;
      maxTurnStep = Math.max(maxTurnStep, Math.abs(delta));
      previous = heading;
    }
    return { turn: totalTurn, severity: Math.min(1, Math.max(Math.abs(totalTurn) * 0.72, maxTurnStep * 6)) };
  }

  return {
    capabilities: { hz: 60, maxLatencyMs: 0 },
    decide(car, _dt, targets = DEFAULT_TARGETS) {
      const info = nearestTrackInfo(car.x, car.z);
      const profile = cornerProfile(info.idx);
      const speedRatio = Math.min(Math.abs(car.speed) / maxSpeed, 1);
      const lookahead = Math.max(6, LOOKAHEAD + Math.round(speedRatio * 10) - Math.round(profile.severity * 5));
      const target = centerline[(info.idx + lookahead) % centerline.length];
      const lateral = sideNormal(centerline[info.idx]);
      const station = targets.station;
      const ref = station && findCar ? findCar(station.car) : null;
      const lineOffset = ref
        ? station.side * 2.5
        : -Math.sign(profile.turn || 1) * (0.3 + profile.severity * 0.9) + targets.line * 2;
      const aimX = target.x + lateral.x * lineOffset;
      const aimZ = target.z + lateral.z * lineOffset;
      const err = wrapAngle(Math.atan2(aimX - car.x, aimZ - car.z) - car.heading);
      const cornerSpeed = maxSpeed * (1 - profile.severity * 0.48);
      let targetSpeed = cornerSpeed * targets.pace;
      if (ref) {
        const offStation = (ref.totalProgress - car.totalProgress) * trackLength + station.gap;
        const correction = clamp(offStation * STATION_GAIN, -STATION_MAX_DROP_BACK, STATION_MAX_CATCH_UP);
        targetSpeed = clamp((ref.speed || 0) + correction, 0, cornerSpeed);
      }
      return {
        steer: clamp(-err * STEER_GAIN, -1, 1),
        throttle: car.speed < targetSpeed ? 1 : 0,
        brake: car.speed > targetSpeed + SPEED_MARGIN ? 1 : 0,
      };
    },
  };
}

// Slow layer fed from outside (a bot script, an agent, a model): persistent
// targets plus one-shot commands, validated field by field so a malformed
// update never reaches the car.
export function createLayeredProvider({ fast }) {
  const targets = { ...DEFAULT_TARGETS };
  let pending = {};
  let updatedAt = 0;

  function setStrategy(update = {}) {
    if (typeof update !== "object" || update === null) return false;
    if (Number.isFinite(update.pace)) targets.pace = clamp(update.pace, PACE_MIN, PACE_MAX);
    if (Number.isFinite(update.line)) targets.line = clamp(update.line, -1, 1);
    if (typeof update.ers === "boolean") targets.ers = update.ers;
    if (update.pit === true) pending.pit = true;
    if (TYRES.has(update.tyre)) targets.tyre = update.tyre; // fitted at the next stop
    if (update.station === null) targets.station = null;
    else if (update.station && typeof update.station.car === "string") {
      targets.station = {
        car: update.station.car,
        gap: Number.isFinite(update.station.gap) ? clamp(update.station.gap, -500, 500) : 0,
        side: Number.isFinite(update.station.side) ? clamp(update.station.side, -1, 1) : 0,
      };
    }
    if (typeof update.radio === "string" && update.radio.trim()) {
      pending.radio = update.radio.trim().slice(0, RADIO_MAX_CHARS);
    }
    updatedAt = Date.now();
    return true;
  }

  return {
    capabilities: fast.capabilities,
    setStrategy,
    getTargets: () => ({ ...targets, updatedAt }),
    decide(car, dt) {
      const out = { ...fast.decide(car, dt, targets), ers: targets.ers, tyre: targets.tyre, ...pending };
      pending = {};
      return out;
    },
  };
}
