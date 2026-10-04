import { DecisionProvider, DrivingIntent } from "./contracts.mjs";

// Deterministic baseline. It intentionally uses only the public observation
// contract, so the exact same orchestrator/controller can later run Jev.
export class RulesDecisionProvider extends DecisionProvider {
  async decide(observation, strategy) {
    const mode = strategy?.mode || "cruise";
    const corner = observation?.nextCorner || {};
    const severity = clamp(Number(corner.curvature) || 0, 0, 1);
    const closeAhead = (observation?.nearbyCars || [])
      .find((car) => car.relative === "ahead" && Number(car.distanceMeters) < 18);

    let pace = {
      attack: 0.98,
      defend: 0.9,
      conserve: 0.72,
      cruise: 0.88,
    }[mode] ?? 0.88;

    // Back off before a significant corner; the browser controller owns the
    // exact braking/steering response.
    pace -= severity * 0.16;

    let line = 0;
    if (closeAhead && strategy?.overtakePolicy !== "follow") {
      // nearbyCars lateralOffsetMeters is relative to us: positive means the
      // other car is left of us, so prefer the opposite free side.
      const otherSide = Math.sign(Number(closeAhead.lateralOffsetMeters) || 0);
      line = otherSide === 0 ? 0.45 : -otherSide * 0.75;
    } else if (mode === "defend" && observation?.gapBehindS != null && observation.gapBehindS < 0.7) {
      line = corner.direction === "left" ? -0.55 : corner.direction === "right" ? 0.55 : 0;
    }

    return new DrivingIntent({
      pace: clamp(pace, 0.5, 1),
      line,
      horizonMs: 650,
      confidence: 1,
    });
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
