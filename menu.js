import { CIRCUITS, LAPS_PER_RACE } from "./circuits.js";
import { computeStandings, resetChampionship } from "./championship.js";

function positionLabel(order) {
  const idx = order.indexOf("player");
  if (idx === -1) return "Da correre";
  return `${idx + 1}° posto`;
}

// AI difficulty: a global setting (not per-circuit) carried into each race
// via a query param on the circuit link, and remembered here across visits.
const DIFFICULTY_KEY = "f1racer-difficulty";
const DIFFICULTY_OPTIONS = [
  { id: "facile", label: "Facile" },
  { id: "normale", label: "Normale" },
  { id: "difficile", label: "Difficile" },
];

function loadDifficulty() {
  try {
    const v = localStorage.getItem(DIFFICULTY_KEY);
    return DIFFICULTY_OPTIONS.some((o) => o.id === v) ? v : "normale";
  } catch (e) {
    return "normale";
  }
}

function saveDifficulty(v) {
  try {
    localStorage.setItem(DIFFICULTY_KEY, v);
  } catch (e) {
    // Private browsing / storage disabled: the choice just won't persist
    // across visits, which is a reasonable degradation.
  }
}

let difficulty = loadDifficulty();

function renderDifficulty() {
  document.getElementById("difficulty-select").innerHTML = DIFFICULTY_OPTIONS.map(
    (opt) => `
      <button
        type="button"
        class="difficulty-btn${opt.id === difficulty ? " active" : ""}"
        data-difficulty="${opt.id}"
        role="radio"
        aria-checked="${opt.id === difficulty}"
      >${opt.label}</button>
    `
  ).join("");
}

// Delegated on the container (not the buttons themselves) so the listener
// survives renderDifficulty() replacing the buttons' innerHTML each time.
document.getElementById("difficulty-select").addEventListener("click", (e) => {
  const btn = e.target.closest(".difficulty-btn");
  if (!btn) return;
  difficulty = btn.dataset.difficulty;
  saveDifficulty(difficulty);
  render();
});

function render() {
  renderDifficulty();
  const { standings, allRaced, state } = computeStandings(CIRCUITS);

  const bannerEl = document.getElementById("champion-banner");
  if (allRaced) {
    const champion = standings[0];
    bannerEl.hidden = false;
    bannerEl.textContent =
      champion.id === "player"
        ? "🏆 Hai vinto il campionato del mondo!"
        : `Campionato concluso: vince ${champion.name}. Azzera e riprova.`;
  } else {
    bannerEl.hidden = true;
  }

  document.getElementById("standings-body").innerHTML = standings
    .map(
      (d, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${d.name}</td>
          <td>${d.points}</td>
        </tr>
      `
    )
    .join("");

  document.getElementById("circuit-list").innerHTML = CIRCUITS.map((circuit) => {
    const order = state.raceResults[circuit.id];
    const status = order ? positionLabel(order) : "Da correre";
    return `
      <a class="card-link" href="race.html?circuit=${circuit.id}&difficulty=${difficulty}">
        <article class="card">
          <span class="card-icon" aria-hidden="true">🏁</span>
          <h2>${circuit.name}</h2>
          <p>${LAPS_PER_RACE} giri contro 9 rivali</p>
          <span class="circuit-status">${status}</span>
        </article>
      </a>
    `;
  }).join("");
}

document.getElementById("reset-btn").addEventListener("click", () => {
  if (confirm("Azzerare punti e risultati del campionato?")) {
    resetChampionship();
    render();
  }
});

render();
