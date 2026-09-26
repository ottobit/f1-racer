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
  // #153: floor .22 -> .30 (about 48% instead of 42% at top speed).
  const speedLimit = .3 + .7 / (1 + Math.pow(velocity / 42, 1.45));
  return -steer * authority * speedLimit * Math.min(velocity / 7, 1) * grip * load * Math.sign(speed);
}
