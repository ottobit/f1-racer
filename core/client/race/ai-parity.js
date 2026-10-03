// AI at parity with the player (#329): a rival gets the player's stock car
// limits (same top speed, launch, brakes, steering; rain included) and a
// per-circuit, per-car cornerSeverity from the generated table, which makes
// the race AI's flying lap match the best one the player's physics can do
// (core/tools/calibrate-ai.mjs). Difficulty then scales pace around parity.
import { AI_TUNING } from "./ai-parity-table.js?v=1";

const DEFAULT_CORNER_SEVERITY = 0.48;

// car: playerCarParams()/roadCarParams() shape, rain already applied.
// tuning: { severity, turn, speed } from the table. turn/speed > 1 only
// where the AI can't match the player's lap even without slowing for
// corners (its simpler steering can't carry the same speed there).
export function aiFromCar(car, { severity = DEFAULT_CORNER_SEVERITY, turn = 1, speed = 1 } = {}) {
  return {
    maxSpeed: car.maxSpeed * speed,
    accel: car.accel * speed,
    brakeDecel: car.brakeDecel,
    turnRate: car.maxTurnRate * turn,
    lookahead: 10, // base centerline samples ahead to steer toward
    cornerLookahead: 22, // samples used to preview upcoming bends
    cornerSeverity: severity,
  };
}

export function aiTuning(circuitId, carId) {
  return AI_TUNING[circuitId]?.[carId] ?? {};
}
