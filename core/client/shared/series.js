// Series (#341): what a solo race is run as, F1 or Classiche (#317), and
// everything that differs between them: who the player drives, in which
// colours, the rival field, driver names, championship, DRS/ERS and the
// race link.
// A room always races F1s (race-multiplayer.js).
import { DRIVER_ROSTER } from "../../shared/driver-roster.js?v=3";
import { displayDriverName, loadSelectedDriverId } from "./driver-selection.js?v=3";
import { liveryById } from "./driver-themes.js?v=28";
import { playerLivery } from "./garage-setup.js?v=31";
import { CLASSIC_ROSTER, classicDriverById, loadClassicDriverId } from "./classic-series.js?v=4";
import { VEHICLES, vehicleById } from "./vehicle.js?v=1";
import { CHAMPIONSHIPS } from "./championship.js?v=4";

export class Series {
  constructor({ id, label, launchLabel, query, championship, drsErs }) {
    Object.assign(this, { id, label, launchLabel, query, championship, drsErs });
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
  // A roster driver's { primary, secondary? } (standings stripe).
  driverColors(_driverId) { throw new Error("not implemented"); }

  raceTitle(circuitName) { return circuitName; }
  // "Hai vinto il campionato …" (#359).
  get championshipName() { return this.label; }
}

class F1Series extends Series {
  constructor() {
    super({ id: "f1", label: "F1", launchLabel: "SCENDI IN PISTA →", query: "", championship: CHAMPIONSHIPS.f1, drsErs: true });
  }

  loadDriverId() { return loadSelectedDriverId(); }
  get championshipName() { return "del mondo"; }
  vehicle() { return VEHICLES.f1; }
  playerColors(driverId) { return playerLivery(driverId); }
  rivals(playerDriverId) {
    return DRIVER_ROSTER
      .filter((driver) => driver.id !== playerDriverId)
      .map((driver) => ({ id: driver.id, livery: liveryById(driver.team), vehicle: VEHICLES.f1 }));
  }
  driverName(driverId) { return displayDriverName(driverId); }
  driverColors(driverId) {
    const livery = liveryById(DRIVER_ROSTER.find((driver) => driver.id === driverId).team);
    return { primary: livery.primary, secondary: livery.secondary };
  }
}

// Solo only, its own championship (#345), period cars without DRS/ERS.
class ClassicSeries extends Series {
  constructor() {
    super({ id: "classic", label: "Classiche", launchLabel: "CLASSICHE →", query: "&series=classic", championship: CHAMPIONSHIPS.classic, drsErs: false });
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
  driverColors(driverId) { return classicDriverById(driverId).colors; }
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
