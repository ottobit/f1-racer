// Championship state: who finished where on each circuit, persisted in
// localStorage (no backend). Shared between the menu page and the race
// page, which records a result right after a race ends.

const STORAGE_KEY = "f1racer-championship-v1";

// Five fictional scuderie (one per grid colour, own livery, not a real F1
// team) with two drivers each — the player rides for Fenice alongside an
// AI teammate, matching the paired grid in main.js.
export const DRIVERS = [
  { id: "player", name: "Tu (Fenice)" },
  { id: "rival-red", name: "Dani Muscle (Fenice)" },
  { id: "rival-blue", name: "Vivian Wendy (Nettuno)" },
  { id: "rival-blue-2", name: "Peppy Bau (Nettuno)" },
  { id: "rival-yellow", name: "Cookie (Solare)" },
  { id: "rival-yellow-2", name: "Rocker Pino (Solare)" },
  { id: "rival-green-1", name: "Alice AaA (Smeraldo)" },
  { id: "rival-green-2", name: "May (Smeraldo)" },
  { id: "rival-white-1", name: "Clopy (Artica)" },
  { id: "rival-white-2", name: "Lola (Artica)" },
];

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
  const totals = Object.fromEntries(DRIVERS.map((d) => [d.id, 0]));

  for (const circuit of circuits) {
    const order = state.raceResults[circuit.id];
    if (!order) continue;
    order.forEach((driverId, idx) => {
      totals[driverId] = (totals[driverId] || 0) + (POINTS_BY_POSITION[idx] || 0);
    });
  }

  const standings = DRIVERS.map((d) => ({ ...d, points: totals[d.id] || 0 })).sort(
    (a, b) => b.points - a.points
  );
  const allRaced = circuits.every((c) => state.raceResults[c.id]);

  return { standings, allRaced, state };
}
