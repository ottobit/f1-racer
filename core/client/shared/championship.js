// Championship (#345): who finished where on each circuit, persisted in
// localStorage (no backend). One per series (series.js): the F1 world
// championship and the Classiche one, each with its own roster and storage.
// Shared between the menu page and the race page, which records a result
// right after a race ends.
import { DRIVER_ROSTER } from "../../shared/driver-roster.js?v=3";
import { loadSelectedDriverId } from "./driver-selection.js?v=3";
import { CLASSIC_ROSTER, loadClassicDriverId } from "./classic-series.js?v=4";

// Real F1 points system: only the top ten score, even as the grid grows.
export const POINTS_BY_POSITION = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export class Championship {
  // roster: [{ id, ... }]; loadPlayerId: the player's driver in this series.
  constructor({ storageKey, roster, loadPlayerId }) {
    Object.assign(this, { storageKey, roster, loadPlayerId });
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.raceResults) return parsed;
      }
    } catch (e) {
      // Ignore a corrupt or inaccessible localStorage and start fresh.
    }
    return { raceResults: {} };
  }

  save(state) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch (e) {
      // Private browsing / storage disabled: the championship just won't
      // persist across reloads, which is a reasonable degradation.
    }
  }

  // `finishOrder` is an array of driver ids, 1st place first.
  record(circuitId, finishOrder) {
    const state = this.load();
    state.raceResults[circuitId] = finishOrder;
    this.save(state);
    return state;
  }

  reset() {
    this.save({ raceResults: {} });
  }

  // The first circuit without a result, or null when the season is over.
  nextUnraced(circuits, state = this.load()) {
    return circuits.find((c) => !state.raceResults[c.id])?.id ?? null;
  }

  // Under way: some results, not all. The player's driver is locked (#155).
  inProgress(circuits, state = this.load()) {
    return circuits.some((c) => state.raceResults[c.id]) && !circuits.every((c) => state.raceResults[c.id]);
  }

  standings(circuits) {
    const state = this.load();
    const playerId = this.loadPlayerId();
    const totals = Object.fromEntries(this.roster.map((d) => [d.id, 0]));

    for (const circuit of circuits) {
      const order = state.raceResults[circuit.id];
      if (!order) continue;
      const seen = new Set();
      order.forEach((resultId, idx) => {
        const driverId = resultId === "player" ? playerId : resultId;
        // Legacy races may contain both `player` and the formerly duplicated AI
        // identity. Count that person once until the next result replaces it.
        if (seen.has(driverId)) return;
        seen.add(driverId);
        totals[driverId] = (totals[driverId] || 0) + (POINTS_BY_POSITION[idx] || 0);
      });
    }

    const standings = this.roster.map((d) => ({ ...d, points: totals[d.id] || 0 })).sort(
      (a, b) => b.points - a.points
    );
    const allRaced = circuits.every((c) => state.raceResults[c.id]);

    return { standings, allRaced, state };
  }
}

export const CHAMPIONSHIPS = Object.freeze({
  f1: new Championship({ storageKey: "f1racer-championship-v1", roster: DRIVER_ROSTER, loadPlayerId: loadSelectedDriverId }),
  classic: new Championship({ storageKey: "f1racer-championship-classic-v1", roster: CLASSIC_ROSTER, loadPlayerId: loadClassicDriverId }),
});
