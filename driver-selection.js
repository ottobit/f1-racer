import { DRIVER_ROSTER, driverById } from "./driver-roster.js";

const SELECTED_DRIVER_KEY = "f1racer-selected-driver-v1";
export const SELECTABLE_DRIVER_IDS = DRIVER_ROSTER.map((driver) => driver.id);

export function loadSelectedDriverId() {
  try {
    const value = localStorage.getItem(SELECTED_DRIVER_KEY);
    return SELECTABLE_DRIVER_IDS.includes(value) ? value : "rival-red";
  } catch (e) {
    return "rival-red";
  }
}

export function saveSelectedDriverId(driverId) {
  if (!SELECTABLE_DRIVER_IDS.includes(driverId)) return;
  try {
    localStorage.setItem(SELECTED_DRIVER_KEY, driverId);
  } catch (e) {
    // Storage unavailable: the selection falls back on next visit.
  }
}

export function selectedPlayerName() {
  return driverById(loadSelectedDriverId()).name;
}

export function displayDriverName(driverId) {
  if (driverId === "player") return selectedPlayerName();
  return driverById(driverId).name;
}
