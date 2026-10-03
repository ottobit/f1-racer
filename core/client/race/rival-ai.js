// Rival AI (#349): a rival drives its car's race settings — the car's stock
// limits (same top speed, launch, brakes, steering; rain included) — and
// nothing else. It is not tuned against the player's lap times; difficulty
// then scales its pace a few percent either way.

const CORNER_SEVERITY = 0.48;

// car: stockParams() shape, rain already applied.
export function rivalAiFromCar(car) {
  return {
    maxSpeed: car.maxSpeed,
    accel: car.accel,
    brakeDecel: car.brakeDecel,
    turnRate: car.maxTurnRate,
    lookahead: 10, // base centerline samples ahead to steer toward
    cornerLookahead: 22, // samples used to preview upcoming bends
    cornerSeverity: CORNER_SEVERITY,
  };
}
