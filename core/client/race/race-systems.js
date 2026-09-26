const PIT_LIMITER_LEAD = 0.03;
const PIT_LIMITER_DECEL = 45;

export function setupRaceSystems({
  state,
  input,
  aiMaxSpeed,
  getRaceState,
  isCautionActive,
  pitZoneStart,
  pitZoneEnd,
  pitSpeedLimit,
  pitServiceMs,
  ersDrainPerSecond,
  ersRechargePerSecond,
}) {
  function isInPitZone(car) {
    const fraction = car.totalProgress - Math.floor(car.totalProgress);
    return fraction >= pitZoneStart || fraction <= pitZoneEnd;
  }

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

  // Pit limiter (#145): with the call armed, the car slows itself to the
  // pit speed just before and inside the pit zone, so the stop always fires.
  function applyPitLimiter(dt) {
    if (!state.pitRequested || state.pitState !== "none" || getRaceState() !== "racing") return;
    const fraction = state.totalProgress - Math.floor(state.totalProgress);
    const approaching = fraction >= pitZoneStart - PIT_LIMITER_LEAD || fraction <= pitZoneEnd;
    if (!approaching || state.speed <= pitSpeedLimit) return;
    state.speed = Math.max(pitSpeedLimit, state.speed - PIT_LIMITER_DECEL * dt);
  }

  function startPitStop() {
    if (getRaceState() !== "racing" || state.pitState !== "none") {
      state.pitRequested = false;
      return;
    }
    // The call stays armed until the car is slow inside the pit zone (#135).
    if (!isInPitZone(state) || Math.abs(state.speed) > pitSpeedLimit) return;
    state.pitRequested = false;
    state.pitState = "servicing";
    state.pitServiceEndTime = performance.now() + pitServiceMs;
    state.speed = 0;
    state.lateralSpeed = 0;
    state.yawRate = 0;
    state.ersActive = false;
  }

  function updatePitStop(now) {
    if (state.pitState !== "servicing") return false;
    state.speed = 0;
    state.lateralSpeed = 0;
    state.yawRate = 0;
    if (now < state.pitServiceEndTime) return true;

    state.pitState = "none";
    state.tyreProgress = 0;
    state.damage *= 0.25;
    state.ersCharge = 100;
    return false;
  }

  return { applyPitLimiter, startPitStop, updateEnergyRecovery, updatePitStop };
}
