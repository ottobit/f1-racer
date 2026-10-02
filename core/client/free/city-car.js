// Cinquino (#311): a slow city car for free drive, same parameter shape as
// playerCarParams() in race-rules.js (m/s, m/s², rad/s). No garage effects.
// ~140 km/h flat out, 0-100 km/h in ~10 s with player-physics.js power fade.
export const CITY_CAR_ID = "cinquino";
export const CITY_CAR_COLOR = 0x5c371f;

export function cityCarParams() {
  return {
    maxSpeed: 39,
    reverseMaxSpeed: -10,
    accel: 3.5,
    brakeDecel: 22,
    coastDecel: 8,
    maxTurnRate: 1.6,
  };
}
