import { CIRCUITS, LAPS_PER_RACE } from "./circuits.js";
import { computeStandings, resetChampionship } from "./championship.js";

function positionLabel(order) {
  const idx = order.indexOf("player");
  if (idx === -1) return "Da correre";
  return `${idx + 1}° posto`;
}

function render() {
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
      <a class="card-link" href="race.html?circuit=${circuit.id}">
        <article class="card">
          <span class="card-icon" aria-hidden="true">🏁</span>
          <h2>${circuit.name}</h2>
          <p>${LAPS_PER_RACE} giri contro 9 rivali${circuit.weather === "pioggia" ? " · 🌧️ sempre bagnato" : ""}</p>
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
