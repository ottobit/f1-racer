// Pure, frame-rate-independent steering helpers shared by runtime and tests.
export function shapeSteering(raw) {
  const magnitude = Math.min(1, Math.abs(raw));
  if (magnitude < .035) return 0;
  return Math.sign(raw) * Math.pow((magnitude - .035) / .965, 1.22);
}
export function smoothSteering(current, target, dt) {
  const returning = target === 0 || target * current < 0;
  return current + (target - current) * (1 - Math.exp(-(returning ? 15 : 10) * dt));
}
export function steeringYaw(steer, speed, authority, grip, load = 1) {
  const velocity = Math.abs(speed);
  // No rotation while stationary; keep high-speed steering controlled without
  // making the car feel numb once it reaches real racing pace.
  // #161: back to the pre-#153 .22 floor; #153's .30 made it twitchy.
  const speedLimit = .22 + .78 / (1 + Math.pow(velocity / 42, 1.45));
  const demand = steer * authority * speedLimit * Math.min(velocity / 7, 1) * grip * load;
  return -gripLimitYaw(demand, velocity, grip) * Math.sign(speed);
}

// Tyre grip ceiling on rotation (#161): yaw rate can't exceed what the
// tyres hold laterally (a = yaw * v). Past a soft knee extra lock washes the
// front out (understeer) instead of turning tighter. Only bites above
// ~35 m/s at near full lock; slow and medium corners are unchanged.
const PEAK_LATERAL_ACCEL = 5.5 * 9.81; // m/s², roughly an F1's aero peak
const GRIP_KNEE = .75;
function gripLimitYaw(yaw, velocity, grip) {
  const limit = PEAK_LATERAL_ACCEL * grip / Math.max(velocity, 1);
  const magnitude = Math.abs(yaw);
  const knee = limit * GRIP_KNEE;
  if (magnitude <= knee) return yaw;
  const span = limit - knee;
  return Math.sign(yaw) * (knee + span * Math.tanh((magnitude - knee) / span));
}
