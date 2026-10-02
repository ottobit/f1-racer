// Road-car garage (#323): per-car setup and paint for the period cars
// (road-cars.js), shared by the garage, free drive and the Classiche race.
// The F1 keeps its own garage (garage-setup.js). Effects are small
// multipliers on params() (maxSpeed, accel, brakeDecel, maxTurnRate), each a
// trade-off; colours null = the car's (or the driver's) own.
import { ROAD_CARS } from "./road-cars.js?v=1";

export const ROAD_GARAGE_KEY = "f1racer-road-garage-v1";
export const DEFAULT_ROAD_SETUP = { tyres: "balanced", gearing: "balanced", brakes: "balanced", suspension: "balanced", primary: null, secondary: null };
export const ROAD_PARTS = {
  tyres: { label: "Gomme", variants: {
    hard: { label: "Dure", maxSpeed: 0.02, maxTurnRate: -0.04 },
    balanced: { label: "Stradali" },
    soft: { label: "Sportive", maxSpeed: -0.02, maxTurnRate: 0.06 },
  } },
  gearing: { label: "Rapporti", variants: {
    short: { label: "Corti", accel: 0.08, maxSpeed: -0.05 },
    balanced: { label: "Di serie" },
    long: { label: "Lunghi", accel: -0.06, maxSpeed: 0.05 },
  } },
  brakes: { label: "Freni", variants: {
    drum: { label: "A tamburo", brakeDecel: -0.06, maxTurnRate: 0.02 },
    balanced: { label: "Di serie" },
    sport: { label: "Sportivi", brakeDecel: 0.08, maxTurnRate: -0.02 },
  } },
  suspension: { label: "Sospensioni", variants: {
    soft: { label: "Morbide", accel: 0.03, maxTurnRate: -0.03 },
    balanced: { label: "Di serie" },
    stiff: { label: "Rigide", brakeDecel: -0.03, maxTurnRate: 0.05 },
  } },
};
export const ROAD_STATS = { maxSpeed: "Velocità", accel: "Accelerazione", brakeDecel: "Frenata", maxTurnRate: "Sterzo" };
// Period paints for either role.
export const ROAD_PALETTE = [
  0xf2efe6, 0x111111, 0xb3121b, 0xf2b705, 0x7fb3d5, 0x2f6b4a, 0x5c371f, 0xe0703a, 0x1f3f8a, 0x9aa3a8,
];

function readAll() {
  try {
    const all = JSON.parse(localStorage.getItem(ROAD_GARAGE_KEY));
    return all && typeof all === "object" ? all : {};
  } catch {
    return {};
  }
}

function validColor(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffff ? value : null;
}

export function loadRoadSetup(id) {
  const saved = readAll()[id] || {};
  const setup = { ...DEFAULT_ROAD_SETUP };
  for (const part of Object.keys(ROAD_PARTS)) {
    if (ROAD_PARTS[part].variants[saved[part]]) setup[part] = saved[part];
  }
  setup.primary = validColor(saved.primary);
  setup.secondary = validColor(saved.secondary);
  return setup;
}

export function saveRoadSetup(id, setup) {
  if (!ROAD_CARS[id]) return;
  const all = readAll();
  all[id] = setup;
  try {
    localStorage.setItem(ROAD_GARAGE_KEY, JSON.stringify(all));
  } catch {}
}

// Sum of the chosen variants' effects per stat (0.05 = +5%).
export function roadSetupEffects(setup) {
  const effects = Object.fromEntries(Object.keys(ROAD_STATS).map((stat) => [stat, 0]));
  for (const part of Object.keys(ROAD_PARTS)) {
    const variant = ROAD_PARTS[part].variants[setup[part]] || {};
    for (const stat of Object.keys(ROAD_STATS)) effects[stat] += variant[stat] || 0;
  }
  return effects;
}

// base: the car's params() (maybe with rain applied); same shape back.
export function roadSetupParams(id, base, setup = loadRoadSetup(id)) {
  const effects = roadSetupEffects(setup);
  const params = { ...base };
  for (const stat of Object.keys(ROAD_STATS)) params[stat] = base[stat] * (1 + effects[stat]);
  return params;
}

// fallback: the colours the car would wear otherwise (car's or driver's).
export function roadColors(id, fallback = ROAD_CARS[id]?.colors ?? {}, setup = loadRoadSetup(id)) {
  return {
    ...fallback,
    ...(setup.primary !== null ? { primary: setup.primary } : {}),
    ...(setup.secondary !== null ? { secondary: setup.secondary } : {}),
  };
}
