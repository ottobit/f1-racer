export function setupPlayerPhysics({
  car,
  state,
  input,
  steering,
  drsSpeedMultiplier,
  ersSpeedMultiplier,
  grassLimit,
  tireGripFactor,
  cautionSpeedMultiplier,
  steeringYaw,
  nearestTrackInfo,
  applyTrackBoundary,
}) {
  function integratePlayerMotion(dt) {
    const preSpeedFactor = Math.min(Math.abs(state.speed) / car.maxSpeed, 1);
    const preLateralDemand = Math.min(
      Math.abs(state.lateralSpeed) / Math.max(Math.abs(state.speed) * 0.3, 1),
      1
    );
    // Brake wins over throttle, so the brake can be dabbed while the gas
    // stays pinned (touch pedals can be held together).
    const throttle = input.forward && !input.back;
    const brakingLoadTransfer = input.back ? 0.12 + 0.12 * preSpeedFactor : 0;
    const accelerationLoadTransfer = throttle ? 0.08 + 0.08 * preSpeedFactor : 0;
    // Mild traction cut while sliding (#79): a stronger cut acted as an
    // invisible speed limiter whenever the wheel was turned.
    const longitudinalGripBudget = Math.max(0.5, 1 - preLateralDemand * 0.15);
    if (input.back) {
      const brakeAuthority = longitudinalGripBudget * (1 + brakingLoadTransfer * 0.25);
      state.speed -= car.brakeDecel * brakeAuthority * dt;
    } else if (throttle) {
      const traction = longitudinalGripBudget * (1 - accelerationLoadTransfer * 0.35);
      // Power fades with speed (aero drag): launch at car.accel, only ~15%
      // of it left at top speed — roughly real F1 0-100/0-200/0-300 times.
      const powerFade = 1 - 0.85 * preSpeedFactor * preSpeedFactor;
      state.speed += car.accel * traction * powerFade * dt;
    } else {
      // Lift-off: aero drag + engine braking, strong at top speed (~1.4g)
      // and fading at low speed, instead of a flat ~3g that stopped the
      // car from 300 km/h in about three seconds.
      const decel = car.coastDecel * (0.12 + 0.38 * preSpeedFactor * preSpeedFactor) * dt;
      if (state.speed > 0) state.speed = Math.max(0, state.speed - decel);
      else if (state.speed < 0) state.speed = Math.min(0, state.speed + decel);
    }
    const playerMaxSpeed =
      car.maxSpeed *
      (1 - state.damage) *
      (state.drsActive ? drsSpeedMultiplier : 1) *
      (state.ersActive ? ersSpeedMultiplier : 1) *
      cautionSpeedMultiplier();
    state.speed = Math.max(
      car.reverseMaxSpeed,
      Math.min(playerMaxSpeed, state.speed)
    );

    const grip = tireGripFactor(state.totalProgress, state);
    const steerSign = state.speed >= 0 ? 1 : -1;
    const steerAmount = steering.value;

    const loadTransferSteer = input.back ? 1.08 : throttle ? 0.94 : 1;
    const combinedDemand = Math.min(Math.abs(state.lateralSpeed) / Math.max(Math.abs(state.speed) * 0.28, 1), 1);
    const gripSaturation = 1 - combinedDemand * 0.22;
    const targetYawRate = steeringYaw(steerAmount, state.speed, car.maxTurnRate, grip, loadTransferSteer * gripSaturation);

    const yawResponse = 7.5;
    state.yawRate += (targetYawRate - state.yawRate) * (1 - Math.exp(-yawResponse * dt));
    if (Math.abs(state.speed) < 0.05) state.yawRate = 0;
    if (steerAmount === 0) {
      state.yawRate *= Math.max(0, 1 - dt * 5);
    }
    state.heading += state.yawRate * dt;

    const lateralAxisX = -Math.cos(state.heading);
    const lateralAxisZ = Math.sin(state.heading);
    const maxLateral = Math.abs(state.speed) * 0.32;
    const desiredLateral =
      steerAmount * Math.abs(state.speed) * 0.16 * (0.55 + 0.45 * grip) * steerSign;
    const rearStability = input.back ? 0.86 : throttle ? 0.92 : 1;
    const lateralResponse = (5.0 + grip * 3.0) * rearStability;
    state.lateralSpeed +=
      (desiredLateral - state.lateralSpeed) *
      Math.min(1, lateralResponse * dt);

    state.lateralSpeed = Math.max(
      -maxLateral,
      Math.min(maxLateral, state.lateralSpeed)
    );
    const slipRatio =
      maxLateral > 0.001
        ? Math.min(Math.abs(state.lateralSpeed) / maxLateral, 1)
        : 0;
    const cornerDrag = 1 + slipRatio * (1.8 - grip);
    if (state.speed > 0) {
      // Light tyre scrub only (#79): going in too fast must end off the
      // road, not be slowed down by the game (was 0.9: 185 km/h cap at
      // half lock).
      state.speed = Math.max(0, state.speed - state.speed * (cornerDrag - 1) * 0.2 * dt);
    }

    const forwardX = Math.sin(state.heading);
    const forwardZ = Math.cos(state.heading);
    state.x +=
      (forwardX * state.speed + lateralAxisX * state.lateralSpeed) * dt;
    state.z +=
      (forwardZ * state.speed + lateralAxisZ * state.lateralSpeed) * dt;

    const info = nearestTrackInfo(state.x, state.z);
    applyTrackBoundary(state, dt, info);

    const isOffTrack = info.dist > grassLimit;
    if (isOffTrack && !state.wasOffTrack) state.trackLimitViolationsThisLap++;
    state.wasOffTrack = isOffTrack;

    return info;
  }

  return { integratePlayerMotion };
}
