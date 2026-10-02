// Free-drive garage (#311, #313): the cars you can drive on the oval, and
// the ones that lap it on their own. params() has playerCarParams()'s shape
// (race-rules.js: m/s, m/s², rad/s); the F1 keeps the race's own physics.
// Top speed and 0-100 km/h follow player-physics.js's power fade.
import { playerCarParams } from "../race/race-rules.js?v=3";

export const VEHICLES = {
  f1: {
    label: "F1",
    params: (effects) => playerCarParams(effects, false), // 317 km/h
  },
  cinquino: {
    label: "Cinquino",
    colors: { primary: 0x5c371f },
    // ~140 km/h, 0-100 in ~10 s.
    params: () => ({ maxSpeed: 39, reverseMaxSpeed: -10, accel: 3.5, brakeDecel: 22, coastDecel: 8, maxTurnRate: 1.6 }),
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
};
export const VEHICLE_IDS = Object.keys(VEHICLES);
export const DEFAULT_VEHICLE = "f1";

// Rivals' lanes (autopilot line, x2 units off the racing line) and pace.
// Inside lanes only: on this oval the slow cars run wide in the turns, and
// the outside lanes left the road (core/tools/validate-free-oval.mjs).
export const RIVAL_SLOTS = [
  { line: 1, pace: 0.92 },
  { line: 2.2, pace: 0.88 },
  { line: 3.4, pace: 0.95 },
  { line: 4.6, pace: 0.85 },
];

const STORAGE_KEY = "f1racer-free-car";

// ?car= wins, then the last pick, then the F1.
export function loadVehicleId() {
  const fromUrl = new URLSearchParams(location.search).get("car");
  if (VEHICLES[fromUrl]) return fromUrl;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (VEHICLES[stored]) return stored;
  } catch {}
  return DEFAULT_VEHICLE;
}

export function saveVehicleId(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
}
