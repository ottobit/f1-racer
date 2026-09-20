// Pure, frame-rate-independent steering helpers shared by runtime and tests.
export function shapeSteering(raw) {
  const magnitude = Math.min(1, Math.abs(raw));
  if (magnitude < .035) return 0;
  return Math.sign(raw) * Math.pow((magnitude - .035) / .965, 1.35);
}
export function smoothSteering(current, target, dt) {
  const returning = target === 0 || target * current < 0;
  return current + (target - current) * (1 - Math.exp(-(returning ? 13 : 8) * dt));
}
export function steeringYaw(steer, speed, authority, grip, load = 1) {
  const velocity = Math.abs(speed);
  // No rotation while stationary; progressively less lock at racing speed.
  const speedLimit = 1 / (1 + Math.pow(velocity / 36, 1.65));
  return -steer * authority * speedLimit * Math.min(velocity / 7, 1) * grip * load * Math.sign(speed);
}
