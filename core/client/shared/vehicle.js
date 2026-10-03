// Drivable cars as objects (#339): one Vehicle per car, so race, free drive,
// garage and the AI calibration ask the car instead of branching on
// `id === "f1"`. Pure data and physics (no three, no DOM): Node tools load
// it too. The 3D model is built by vehicle-view.js, keyed on `kind`.
//
//   stockParams(isRaining)      the car as it leaves the factory: what a
//                               rival drives (#329 parity starts here)
//   playerParams(isRaining, g)  stock + the player's garage g for this car
//   loadGarage()                that garage, as saved (F1 setup or road setup)
//   stockColors(teamLivery)     what it wears unpainted: the F1 its team's
//                               livery, a period car its factory colours
//   paint(base)                 the player's garage paint over base
//
// Params have race-rules.js playerCarParams()'s shape (m/s, m/s², rad/s).
import { RAIN_MAX_SPEED_MULTIPLIER, RAIN_TURN_RATE_MULTIPLIER, playerCarParams } from "../race/race-rules.js?v=5";
import { DEFAULT_SETUP, loadGarageSetup, setupEffects } from "./garage-setup.js?v=31";
import { ROAD_CARS } from "./road-cars.js?v=1";
import { loadRoadSetup, roadColors, roadSetupParams } from "./road-garage.js?v=1";

export class Vehicle {
  constructor({ id, kind, label, noun, colors, showroomScale, playerDetail, exhaustFlames }) {
    this.id = id;
    this.kind = kind;
    this.label = label;
    // What the car is, for copy and screen readers ("Monoposto 3D").
    this.noun = noun;
    this.colors = colors;
    // Showroom plinth scale: the cars differ in length (F1 ~5, road ~3.5).
    this.showroomScale = showroomScale;
    // The player's own car in detail trim on track (#325: a period car is
    // one car, no batching; the F1 keeps the lighter model).
    this.playerDetail = playerDetail;
    // Exhaust pops (race-exhaust.js): the flame sits on the F1's tailpipe.
    this.exhaustFlames = exhaustFlames;
  }

  stockParams() {
    throw new Error(`${this.constructor.name}.stockParams() not implemented`);
  }

  playerParams() {
    throw new Error(`${this.constructor.name}.playerParams() not implemented`);
  }

  loadGarage() {
    return null;
  }

  stockColors() {
    return this.colors;
  }

  paint(base = this.colors) {
    return base;
  }
}

// The F1: limits from race-rules.js, tuned by the F1 garage (garage-setup.js).
export class F1Car extends Vehicle {
  constructor() {
    super({ id: "f1", kind: "f1", label: "F1", noun: "Monoposto", colors: {}, showroomScale: 1.15, playerDetail: false, exhaustFlames: true });
  }

  stockParams(isRaining) {
    return playerCarParams(setupEffects(DEFAULT_SETUP), isRaining);
  }

  playerParams(isRaining, garage = this.loadGarage()) {
    return playerCarParams(setupEffects(garage), isRaining);
  }

  loadGarage() {
    return loadGarageSetup();
  }

  stockColors(teamLivery) {
    return teamLivery;
  }
}

// A period car (road-cars.js): its own limits, the F1's rain penalties, tuned
// by its road garage (road-garage.js), painted in its garage colours.
export class RoadCar extends Vehicle {
  constructor(id, spec) {
    super({ id, kind: "road", label: spec.label, noun: "Auto", colors: spec.colors, showroomScale: 1.6, playerDetail: true, exhaustFlames: false });
    this.spec = spec;
  }

  stockParams(isRaining) {
    const params = this.spec.params();
    if (!isRaining) return params;
    return { ...params, maxSpeed: params.maxSpeed * RAIN_MAX_SPEED_MULTIPLIER, maxTurnRate: params.maxTurnRate * RAIN_TURN_RATE_MULTIPLIER };
  }

  playerParams(isRaining, garage = this.loadGarage()) {
    return roadSetupParams(this.id, this.stockParams(isRaining), garage);
  }

  loadGarage() {
    return loadRoadSetup(this.id);
  }

  paint(base = this.colors) {
    return roadColors(this.id, base);
  }
}

export const VEHICLES = Object.freeze({
  f1: new F1Car(),
  ...Object.fromEntries(Object.entries(ROAD_CARS).map(([id, spec]) => [id, new RoadCar(id, spec)])),
});
export const VEHICLE_IDS = Object.keys(VEHICLES);

export function vehicleById(id) {
  return VEHICLES[id] ?? null;
}
