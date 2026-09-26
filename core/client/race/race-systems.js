import { pitLanePose } from "../shared/pit-lane.js?v=1";

const PIT_LIMITER_LEAD = 90; // units before the lane entry: top speed down to lane pace
const PIT_LIMITER_DECEL = 45;
const PIT_ENTRY_GRACE = 8;
const PIT_LANE_ACCEL = 14;
const PIT_BOX_DECEL = 16;
const PIT_BLEND_RATE = 2.5;

export function setupRaceSystems({
  state,
  input,
  aiMaxSpeed,
  getRaceState,
  isCautionActive,
  pitLane,
  pitSpeedLimit,
  pitServiceMs,
  ersDrainPerSecond,
  ersRechargePerSecond,
}) {
  function updateEnergyRecovery(cars, dt) {
    for (const car of cars) {
      if (car === state) {
        if (state.pitState === "servicing") {
          state.ersActive = false;
          continue;
        }
        if (state.ersActive && state.ersCharge > 0) {
          state.ersCharge = Math.max(0, state.ersCharge - ersDrainPerSecond * dt);
          if (state.ersCharge <= 0) state.ersActive = false;
        } else {
          const recharge = input.back ? ersRechargePerSecond * 1.8 : ersRechargePerSecond;
          state.ersCharge = Math.min(100, state.ersCharge + recharge * dt);
        }
      } else {
        if (
          car.ersCharge > 0 &&
          car.drsActive &&
          car.speed > aiMaxSpeed * 0.62 &&
          !isCautionActive()
        ) {
          car.ersActive = true;
        } else {
          car.ersActive = false;
        }
        if (car.ersActive) {
          car.ersCharge = Math.max(0, car.ersCharge - ersDrainPerSecond * 0.75 * dt);
          if (car.ersCharge <= 0) car.ersActive = false;
        } else {
          car.ersCharge = Math.min(100, car.ersCharge + ersRechargePerSecond * dt);
        }
      }
    }
  }

  // Distance along the track from the car to the pit lane entry, or null
  // when the entry is not ahead within one lap.
  function distanceToPitEntry() {
    // prevRawProgress is the car's own track position (totalProgress is an
    // accumulator that starts at 0 on the grid, behind the line).
    const fraction = state.prevRawProgress;
    const entry = pitLane.total + pitLane.entryS;
    return (entry - fraction * pitLane.total + pitLane.total) % pitLane.total;
  }

  // Pit limiter (#145): with the call armed, the car slows itself to the
  // pit speed on the approach, so it reaches the lane entry at lane pace.
  function applyPitLimiter(dt) {
    if (!state.pitRequested || state.pitState !== "none" || getRaceState() !== "racing") return;
    if (distanceToPitEntry() > PIT_LIMITER_LEAD || state.speed <= pitSpeedLimit) return;
    state.speed = Math.max(pitSpeedLimit, state.speed - PIT_LIMITER_DECEL * dt);
  }

  // Real pit lane (#147): at the entry the autopilot takes the car down the
  // lane, stops it in the box, then releases it at the lane exit.
  function startPitStop() {
    if (getRaceState() !== "racing" || state.pitState !== "none") {
      state.pitRequested = false;
      return;
    }
    const toEntry = distanceToPitEntry();
    // The call stays armed until the car reaches the entry (from up to
    // PIT_ENTRY_GRACE past it, e.g. a slow frame).
    if (toEntry > 1.5 && toEntry < pitLane.total - PIT_ENTRY_GRACE) return;
    const pitDist = toEntry <= 1.5 ? 0 : pitLane.total - toEntry;
    const pose = pitLanePose(pitLane, pitDist);
    state.pitRequested = false;
    state.pitState = "entering";
    state.pitDist = pitDist;
    // Wherever the car is across the track, blend it onto the lane.
    state.pitBlendX = state.x - pose.x;
    state.pitBlendZ = state.z - pose.z;
    state.pitBlendHeading = Math.atan2(Math.sin(state.heading - pose.heading), Math.cos(state.heading - pose.heading));
    state.ersActive = false;
  }

  function applyService() {
    state.tyreProgress = 0;
    state.damage *= 0.25;
    state.ersCharge = 100;
  }

  // Returns true while the autopilot drives the player (lane or box).
  function updatePitStop(now, dt) {
    if (state.pitState === "none") return false;
    let speed = Math.max(0, state.speed);
    if (state.pitState === "entering") {
      speed = speed > pitSpeedLimit
        ? Math.max(pitSpeedLimit, speed - PIT_LIMITER_DECEL * dt)
        : Math.min(pitSpeedLimit, speed + PIT_LANE_ACCEL * dt);
      const remaining = Math.max(0, pitLane.boxDist - state.pitDist);
      speed = Math.min(speed, Math.sqrt(2 * PIT_BOX_DECEL * remaining) + 0.4);
      state.pitDist = Math.min(pitLane.boxDist, state.pitDist + speed * dt);
      if (state.pitDist >= pitLane.boxDist) {
        speed = 0;
        state.pitState = "servicing";
        state.pitServiceEndTime = now + pitServiceMs;
      }
    } else if (state.pitState === "servicing") {
      speed = 0;
      if (now >= state.pitServiceEndTime) {
        applyService();
        state.pitState = "exiting";
      }
    } else {
      speed = Math.min(pitSpeedLimit, speed + PIT_LANE_ACCEL * dt);
      state.pitDist += speed * dt;
      if (state.pitDist >= pitLane.length) state.pitState = "none";
    }
    const pose = pitLanePose(pitLane, state.pitDist);
    const fade = Math.exp(-PIT_BLEND_RATE * dt);
    state.pitBlendX *= fade;
    state.pitBlendZ *= fade;
    state.pitBlendHeading *= fade;
    state.x = pose.x + state.pitBlendX;
    state.z = pose.z + state.pitBlendZ;
    state.heading = pose.heading + state.pitBlendHeading;
    state.speed = speed;
    state.lateralSpeed = 0;
    state.yawRate = 0;
    state.ersActive = false;
    state.wasOffTrack = false;
    return true;
  }

  return { applyPitLimiter, startPitStop, updateEnergyRecovery, updatePitStop };
}
