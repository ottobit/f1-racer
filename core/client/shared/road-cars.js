// Road-car catalogue (#311, #313, #315): name, colours and physics of every
// car beside the F1, shared by free drive and (next) the Classiche race.
// params() has playerCarParams()'s shape (race-rules.js: m/s, m/s², rad/s);
// top speed and 0-100 km/h follow player-physics.js's power fade. Models:
// vehicle-models.js, same ids. No badges or real make names.
export const ROAD_CARS = {
  cinquino: {
    label: "Cinquino",
    colors: { primary: 0x5c371f },
    // ~140 km/h, 0-100 in ~10 s.
    params: () => ({ maxSpeed: 39, reverseMaxSpeed: -10, accel: 3.5, brakeDecel: 22, coastDecel: 8, maxTurnRate: 1.6 }),
  },
  pandina: {
    label: "Pandina",
    colors: { primary: 0xf1f1ee },
    // ~145 km/h, 0-100 in ~10.5 s.
    params: () => ({ maxSpeed: 40, reverseMaxSpeed: -10, accel: 3.3, brakeDecel: 24, coastDecel: 8, maxTurnRate: 1.55 }),
  },
  spider: {
    label: "Spider",
    colors: { primary: 0xb3121b },
    // ~210 km/h, 0-100 in ~4.5 s.
    params: () => ({ maxSpeed: 58, reverseMaxSpeed: -12, accel: 7, brakeDecel: 40, coastDecel: 14, maxTurnRate: 1.9 }),
  },
  pulmino: {
    label: "Pulmino",
    colors: { primary: 0x7fb3d5, secondary: 0xf2efe6 },
    // ~115 km/h, 0-100 in ~13 s.
    params: () => ({ maxSpeed: 32, reverseMaxSpeed: -8, accel: 3, brakeDecel: 18, coastDecel: 7, maxTurnRate: 1.3 }),
  },
  muscle: {
    label: "Muscle",
    colors: { primary: 0xf2b705, secondary: 0x111111 },
    // ~250 km/h, 0-100 in ~3 s.
    params: () => ({ maxSpeed: 70, reverseMaxSpeed: -14, accel: 9.5, brakeDecel: 38, coastDecel: 16, maxTurnRate: 1.6 }),
  },
  familiare: {
    label: "Familiare",
    colors: { primary: 0x2f6b4a },
    // ~130 km/h, 0-100 in ~12 s.
    params: () => ({ maxSpeed: 36, reverseMaxSpeed: -9, accel: 3.1, brakeDecel: 20, coastDecel: 7, maxTurnRate: 1.4 }),
  },
};
export const ROAD_CAR_IDS = Object.keys(ROAD_CARS);
