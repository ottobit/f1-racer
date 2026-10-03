// Series (#341): what a solo race is run as, F1 or Classiche (#317), and
// everything that differs between them: who the player drives, in which
// colours, the rival field, driver names, points, DRS/ERS and the race link.
// A room always races F1s (race-multiplayer.js).
import { DRIVER_ROSTER } from "../../shared/driver-roster.js?v=3";
import { displayDriverName, loadSelectedDriverId } from "./driver-selection.js?v=3";
import { liveryById } from "./driver-themes.js?v=28";
import { playerLivery } from "./garage-setup.js?v=31";
import { CLASSIC_ROSTER, classicDriverById, loadClassicDriverId } from "./classic-series.js?v=3";
import { VEHICLES, vehicleById } from "./vehicle.js?v=1";

export class Series {
  constructor({ id, label, launchLabel, query, awardsPoints, drsErs }) {
    Object.assign(this, { id, label, launchLabel, query, awardsPoints, drsErs });
  }

  // The driver id the player last picked for this series.
  loadDriverId() { throw new Error("not implemented"); }
  // The Vehicle that driver races.
  vehicle(_driverId) { throw new Error("not implemented"); }
  // What the player's car wears.
  playerColors(_driverId) { throw new Error("not implemented"); }
  // The other drivers: [{ id, livery, vehicle }].
  rivals(_playerDriverId) { throw new Error("not implemented"); }
  // driverId may be "player".
  driverName(_driverId, _playerDriverId) { throw new Error("not implemented"); }

  raceTitle(circuitName) { return circuitName; }
}

class F1Series extends Series {
  constructor() {
    super({ id: "f1", label: "F1", launchLabel: "SCENDI IN PISTA →", query: "", awardsPoints: true, drsErs: true });
  }

  loadDriverId() { return loadSelectedDriverId(); }
  vehicle() { return VEHICLES.f1; }
  playerColors(driverId) { return playerLivery(driverId); }
  rivals(playerDriverId) {
    return DRIVER_ROSTER
      .filter((driver) => driver.id !== playerDriverId)
      .map((driver) => ({ id: driver.id, livery: liveryById(driver.team), vehicle: VEHICLES.f1 }));
  }
  driverName(driverId) { return displayDriverName(driverId); }
}

// Solo only, no championship points, period cars without DRS/ERS.
class ClassicSeries extends Series {
  constructor() {
    super({ id: "classic", label: "Classiche", launchLabel: "CLASSICHE →", query: "&series=classic", awardsPoints: false, drsErs: false });
  }

  loadDriverId() { return loadClassicDriverId(); }
  vehicle(driverId) { return vehicleById(classicDriverById(driverId).car); }
  // A driver's colours on their own car; the car's own on any other.
  baseColors(driverId, vehicle) {
    const driver = classicDriverById(driverId);
    return { ...vehicle.colors, ...(driver?.car === vehicle.id ? driver.colors : {}) };
  }
  playerColors(driverId) {
    const vehicle = this.vehicle(driverId);
    return vehicle.paint(this.baseColors(driverId, vehicle));
  }
  // One-make (#321): every rival drives the player's car, in its own colours.
  rivals(playerDriverId) {
    const vehicle = this.vehicle(playerDriverId);
    return CLASSIC_ROSTER
      .filter((driver) => driver.id !== playerDriverId)
      .map((driver) => ({ id: driver.id, livery: driver.colors, vehicle }));
  }
  driverName(driverId, playerDriverId) {
    return classicDriverById(driverId === "player" ? playerDriverId : driverId)?.name ?? driverId;
  }
  raceTitle(circuitName) { return `Classiche · ${circuitName}`; }
}

export const SERIES = Object.freeze({ f1: new F1Series(), classic: new ClassicSeries() });

export function seriesById(id) {
  return SERIES[id] ?? SERIES.f1;
}

const SERIES_KEY = "f1racer-series";

// Home's last pick.
export function loadSeries() {
  try {
    return seriesById(localStorage.getItem(SERIES_KEY));
  } catch {
    return SERIES.f1;
  }
}

export function saveSeries(series) {
  try {
    localStorage.setItem(SERIES_KEY, series.id);
  } catch {}
}
