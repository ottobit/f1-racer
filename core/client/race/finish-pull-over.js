// Shared post-finish driving plan: physical steering/braking, never teleport.
export function finishPullOver(car, dt, { centerline, nearestTrackInfo, sideNormal, grassLimit }) {
  const { idx } = nearestTrackInfo(car.x, car.z);
  const point = centerline[idx];
  const normal = sideNormal(point);
  const offset = (car.x - point.x) * normal.x + (car.z - point.z) * normal.z;
  const plan = car.finishPullOver ??= {
    elapsed: 0,
    startOffset: offset,
    // Park beyond the outside edge of the kerb, not on the racing surface.
    // Keep a little runoff margin so the whole car reads as safely clear.
    targetOffset: (offset < 0 ? -1 : 1) * (grassLimit + 1.1),
  };
  plan.elapsed += dt;
  const t = Math.min(1, plan.elapsed / 2);
  const blend = t * t * (3 - 2 * t);
  const desiredOffset = plan.startOffset + (plan.targetOffset - plan.startOffset) * blend;
  // Keep moving slowly until actually beside the kerb, even on tight bends.
  const parked = t === 1 && Math.abs(offset - plan.targetOffset) < 0.6;
  const targetSpeed = parked ? 0 : 6 + 19 * (1 - blend);
  const aim = centerline[(idx + 6) % centerline.length];
  const aimNormal = sideNormal(aim);
  const x = aim.x + aimNormal.x * desiredOffset;
  const z = aim.z + aimNormal.z * desiredOffset;
  let err = Math.atan2(x - car.x, z - car.z) - car.heading;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  return {
    x, z, targetSpeed,
    steer: Math.max(-1, Math.min(1, -err * 3)),
    throttle: car.speed < targetSpeed - 0.5,
    brake: car.speed > targetSpeed + 0.1,
  };
}
