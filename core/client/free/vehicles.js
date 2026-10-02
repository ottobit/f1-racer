// Free-drive garage (#311, #313, #315): the F1 plus every road car
// (shared/road-cars.js), the saved pick and the rivals' lanes. The F1 keeps
// the race's own physics.
import { playerCarParams } from "../race/race-rules.js?v=3";
import { ROAD_CARS } from "../shared/road-cars.js?v=1";

export const VEHICLES = {
  f1: {
    label: "F1",
    params: (effects) => playerCarParams(effects, false), // 317 km/h
  },
  ...ROAD_CARS,
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
  { line: 5.8, pace: 0.9 },
  { line: 7, pace: 0.87 },
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
