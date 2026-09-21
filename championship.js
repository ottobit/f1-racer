// Championship state: who finished where on each circuit, persisted in
// localStorage (no backend). Shared between the menu page and the race
// page, which records a result right after a race ends.

const STORAGE_KEY = "f1racer-championship-v1";

import { DRIVER_ROSTER } from "./driver-roster.js";
import { loadSelectedDriverId } from "./driver-selection.js";

export const DRIVERS = DRIVER_ROSTER;

// Real F1 points system (top 10 score) — fits a ten-car grid exactly.
export const POINTS_BY_POSITION = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.raceResults) return parsed;
    }
  } catch (e) {
    // Ignore a corrupt or inaccessible localStorage and start fresh.
  }
  return { raceResults: {} };
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Private browsing / storage disabled: the championship just won't
    // persist across reloads, which is a reasonable degradation.
  }
}

// `finishOrder` is an array of driver ids, 1st place first.
export function recordRaceResult(circuitId, finishOrder) {
  const state = loadState();
  state.raceResults[circuitId] = finishOrder;
  saveState(state);
  return state;
}

export function resetChampionship() {
  saveState({ raceResults: {} });
}

export function computeStandings(circuits) {
  const state = loadState();
  const selectedDriverId = loadSelectedDriverId();
  const totals = Object.fromEntries(DRIVERS.map((d) => [d.id, 0]));

  for (const circuit of circuits) {
    const order = state.raceResults[circuit.id];
    if (!order) continue;
    const seen = new Set();
    order.forEach((resultId, idx) => {
      const driverId = resultId === "player" ? selectedDriverId : resultId;
      // Legacy races may contain both `player` and the formerly duplicated AI
      // identity. Count that person once until the next result replaces it.
      if (seen.has(driverId)) return;
      seen.add(driverId);
      totals[driverId] = (totals[driverId] || 0) + (POINTS_BY_POSITION[idx] || 0);
    });
  }

  const standings = DRIVERS.map((d) => ({ ...d, points: totals[d.id] || 0 })).sort(
    (a, b) => b.points - a.points
  );
  const allRaced = circuits.every((c) => state.raceResults[c.id]);

  return { standings, allRaced, state };
}
