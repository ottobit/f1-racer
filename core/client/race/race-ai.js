const AI_AVOID_RADIUS = 4.5;
const AI_AVOID_STRENGTH = 10;

function progressGapAhead(from, to) {
  let gap = to.totalProgress - from.totalProgress;
  while (gap < 0) gap += 1;
  return gap;
}

export function setupRaceAi({
  ai,
  centerline,
  headingOf,
  sideNormal,
  nearestTrackInfo,
  applyTrackBoundary,
  advanceProgress,
  tireGripFactor,
  drsSpeedMultiplier,
  ersSpeedMultiplier,
  cautionSpeedMultiplier,
}) {
  function aiCornerProfile(startIdx) {
    let totalTurn = 0;
    let maxTurnStep = 0;
    let previousHeading = headingOf(centerline[startIdx]);

    for (let step = 1; step <= ai.cornerLookahead; step++) {
      const idx = (startIdx + step) % centerline.length;
      const heading = headingOf(centerline[idx]);
      let delta = heading - previousHeading;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      totalTurn += delta;
      maxTurnStep = Math.max(maxTurnStep, Math.abs(delta));
      previousHeading = heading;
    }

    const severity = Math.min(
      1,
      Math.max(Math.abs(totalTurn) * 0.72, maxTurnStep * 6)
    );
    return { turn: totalTurn, severity };
  }

  function updateAiCar(car, dt, allCars) {
    const info = nearestTrackInfo(car.x, car.z);
    const profile = aiCornerProfile(info.idx);
    const speedRatio = Math.min(Math.abs(car.speed) / ai.maxSpeed, 1);

    const dynamicLookahead = Math.max(
      6,
      ai.lookahead + Math.round(speedRatio * 10) - Math.round(profile.severity * 5)
    );
    const targetIndex = (info.idx + dynamicLookahead) % centerline.length;
    const target = centerline[targetIndex];

    const lateral = sideNormal(centerline[info.idx]);
    let lineOffset = -Math.sign(profile.turn || 1) * (0.3 + profile.severity * 0.9);

    let nearestAhead = null;
    let nearestAheadGap = Infinity;
    let nearestBehindGap = Infinity;
    let nearestBehind = null;
    for (const other of allCars) {
      if (other === car) continue;
      const gapAhead = progressGapAhead(car, other);
      const gapBehind = progressGapAhead(other, car);
      const worldDist = Math.hypot(car.x - other.x, car.z - other.z);

      if (gapAhead > 0 && gapAhead < 0.012 && worldDist < 14 && gapAhead < nearestAheadGap) {
        nearestAhead = other;
        nearestAheadGap = gapAhead;
      }
      if (gapBehind > 0 && gapBehind < 0.012 && worldDist < 10 && gapBehind < nearestBehindGap) {
        nearestBehind = other;
        nearestBehindGap = gapBehind;
      }
    }

    if (nearestAhead) {
      const otherSide = (nearestAhead.x - target.x) * lateral.x +
        (nearestAhead.z - target.z) * lateral.z;
      const passSide = otherSide >= 0 ? -1 : 1;
      lineOffset = passSide * (0.8 + profile.severity * 0.45);
    } else if (nearestBehind) {
      lineOffset = -Math.sign(profile.turn || 1) * (0.9 + profile.severity * 0.35);
    }

    let avoidPush = 0;
    for (const other of allCars) {
      if (other === car) continue;
      const dx = car.x - other.x;
      const dz = car.z - other.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.001 && dist < AI_AVOID_RADIUS) {
        const closeness = (AI_AVOID_RADIUS - dist) / AI_AVOID_RADIUS;
        const side = dx * lateral.x + dz * lateral.z;
        if (side !== 0) avoidPush += Math.sign(side) * closeness;
      }
    }

    const aimX =
      target.x +
      lateral.x * (lineOffset + avoidPush * AI_AVOID_STRENGTH * 0.12);
    const aimZ =
      target.z +
      lateral.z * (lineOffset + avoidPush * AI_AVOID_STRENGTH * 0.12);

    const toTarget = Math.atan2(aimX - car.x, aimZ - car.z);
    let err = toTarget - car.heading;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;

    const cornerSpeedFactor = 1 - profile.severity * 0.48;
    const baseTargetSpeed = ai.maxSpeed * cornerSpeedFactor;
    const tacticalBoost = nearestAhead && profile.severity < 0.25 ? 1.04 : 1;
    const aiMaxSpeed =
      baseTargetSpeed *
      tacticalBoost *
      (1 - car.damage) *
      (car.drsActive ? drsSpeedMultiplier : 1) *
      (car.ersActive ? ersSpeedMultiplier : 1) *
      cautionSpeedMultiplier();

    if (car.speed > aiMaxSpeed) {
      car.speed = Math.max(aiMaxSpeed, car.speed - ai.brakeDecel * dt);
    } else {
      // Same speed-fading power curve as the player (player-physics.js).
      const speedFactor = Math.min(Math.abs(car.speed) / ai.maxSpeed, 1);
      const powerFade = 1 - 0.85 * speedFactor * speedFactor;
      car.speed = Math.min(aiMaxSpeed, car.speed + ai.accel * powerFade * dt);
    }

    const rate =
      ai.turnRate *
      (0.35 + 0.65 * Math.min(car.speed / ai.maxSpeed, 1)) *
      tireGripFactor(car.totalProgress, car);
    if (err > 0.02) car.heading += rate * dt;
    if (err < -0.02) car.heading -= rate * dt;

    // Collision impulses briefly disturb AI cars too. Steering recovers the
    // racing line progressively instead of making rivals immovable rails.
    car.heading += (car.yawRate || 0) * dt;
    car.yawRate = (car.yawRate || 0) * Math.max(0, 1 - dt * 3.2);
    car.lateralSpeed = (car.lateralSpeed || 0) * Math.max(0, 1 - dt * 2.7);

    car.x += (Math.sin(car.heading) * car.speed + Math.cos(car.heading) * car.lateralSpeed) * dt;
    car.z += (Math.cos(car.heading) * car.speed - Math.sin(car.heading) * car.lateralSpeed) * dt;
    const afterInfo = applyTrackBoundary(car, dt);
    advanceProgress(car, afterInfo.idx / centerline.length);
  }

  return { updateAiCar };
}
