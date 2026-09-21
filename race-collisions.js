const DEFAULTS = {
  radius: 1,
  restitution: 0.12,
  maxLateralKick: 10,
  maxYawKick: 0.75,
  damageThreshold: 7,
  damagePerSpeed: 0.003,
  maxDamage: 0.25,
  effectCooldownMs: 240,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function velocityOf(car) {
  const forwardX = Math.sin(car.heading);
  const forwardZ = Math.cos(car.heading);
  const sideX = Math.cos(car.heading);
  const sideZ = -Math.sin(car.heading);
  const lateral = car.lateralSpeed || 0;
  return {
    x: forwardX * car.speed + sideX * lateral,
    z: forwardZ * car.speed + sideZ * lateral,
  };
}

function applyVelocity(car, velocity, yawKick, config) {
  const forwardX = Math.sin(car.heading);
  const forwardZ = Math.cos(car.heading);
  const sideX = Math.cos(car.heading);
  const sideZ = -Math.sin(car.heading);
  car.speed = Math.max(0, velocity.x * forwardX + velocity.z * forwardZ);
  car.lateralSpeed = clamp(
    velocity.x * sideX + velocity.z * sideZ,
    -config.maxLateralKick,
    config.maxLateralKick
  );
  car.yawRate = clamp(
    (car.yawRate || 0) + yawKick,
    -config.maxYawKick,
    config.maxYawKick
  );
}

export function setupCarCollisions(options = {}) {
  const config = { ...DEFAULTS, ...options };

  function resolve(cars, now = performance.now()) {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz) || 0.0001;
        const minDist = config.radius * 2;
        if (dist >= minDist) continue;

        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = minDist - dist;
        const correction = overlap * 0.5 + 0.015;
        a.x -= nx * correction;
        a.z -= nz * correction;
        b.x += nx * correction;
        b.z += nz * correction;

        const velocityA = velocityOf(a);
        const velocityB = velocityOf(b);
        const closing = (velocityA.x - velocityB.x) * nx + (velocityA.z - velocityB.z) * nz;
        if (closing <= 0) continue;

        // Equal-mass impulse: neither the player nor the AI is treated as an
        // immovable object. Restitution stays low to avoid arcade pinball.
        const impulse = closing * (1 + config.restitution) * 0.5;
        const nextA = { x: velocityA.x - nx * impulse, z: velocityA.z - nz * impulse };
        const nextB = { x: velocityB.x + nx * impulse, z: velocityB.z + nz * impulse };
        const sideA = Math.cos(a.heading) * nx - Math.sin(a.heading) * nz;
        const sideB = Math.cos(b.heading) * nx - Math.sin(b.heading) * nz;
        const yawStrength = Math.min(closing / 45, 1) * 0.34;
        applyVelocity(a, nextA, -sideA * yawStrength, config);
        applyVelocity(b, nextB, sideB * yawStrength, config);

        const canRegisterImpact =
          now - (a.lastCollisionTime || 0) >= config.effectCooldownMs &&
          now - (b.lastCollisionTime || 0) >= config.effectCooldownMs;
        if (!canRegisterImpact) continue;

        a.lastCollisionTime = now;
        b.lastCollisionTime = now;
        const damage = Math.max(0, closing - config.damageThreshold) * config.damagePerSpeed;
        if (damage > 0) {
          a.damage = Math.min(config.maxDamage, (a.damage || 0) + damage);
          b.damage = Math.min(config.maxDamage, (b.damage || 0) + damage);
        }
        config.onImpact?.({
          a,
          b,
          x: (a.x + b.x) * 0.5,
          z: (a.z + b.z) * 0.5,
          closingSpeed: closing,
          damage,
        });
      }
    }
  }

  return { resolve };
}
