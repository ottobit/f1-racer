import { CIRCUITS, LAPS_PER_RACE } from "../shared/circuits.js?v=39";
import { computeStandings, resetChampionship } from "../shared/championship.js?v=1";
import { DRIVER_ROSTER } from "../shared/driver-roster.js?v=1";
import { SELECTABLE_DRIVER_IDS, displayDriverName, loadSelectedDriverId, saveSelectedDriverId } from "../shared/driver-selection.js?v=1";

const SELECTED_CIRCUIT_KEY = "f1racer-selected-circuit";

function positionLabel(order) {
  const idx = order.indexOf("player");
  if (idx === -1) return "Da correre";
  return `${idx + 1}° posto`;
}

// AI difficulty: a global setting (not per-circuit) carried into each race
// via a query param on the circuit link, and remembered here across visits.
const DIFFICULTY_KEY = "f1racer-difficulty";
const DIFFICULTY_OPTIONS = [
  { id: "facile", label: "Facile", note: "Più respiro" },
  { id: "normale", label: "Normale", note: "Bilanciata" },
  { id: "difficile", label: "Difficile", note: "Senza sconti" },
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
let selectedDriverId = loadSelectedDriverId();
let selectedCircuitIndex = 0;
let circuitSelectionInitialized = false;

const CIRCUIT_PERSONALITY = {
  vallechiara: { type: "Completo", note: "Curve veloci e frenate nette", level: "Medio" },
  portoscuro: { type: "Bagnato", note: "Precisione e aderenza ridotta", level: "Tecnico" },
  altomare: { type: "Alta velocità", note: "Rettifili lunghi e grandi appoggi", level: "Veloce" },
  montenero: { type: "Cittadino", note: "Stretto, nervoso, senza respiro", level: "Difficile" },
  colleverde: { type: "Flow", note: "Sequenze ampie tra le colline", level: "Medio" },
  marzamemi: { type: "Costiero", note: "Villette, oleandri e due cappi sul mare", level: "Tecnico" },
  pianalago: { type: "Lacustre", note: "Ampio ma con due curve vere da rispettare", level: "Medio" },
  serramonte: { type: "Montano", note: "Tre tornanti stretti, cambi di direzione continui", level: "Difficile" },
  baiadoro: { type: "Moderno", note: "Rettilineo lungo in un tornante tecnico", level: "Tecnico" },
};
// Fallback for a circuit missing from the table above — degrades that one
// slide instead of throwing and blanking the whole carousel for every
// circuit (see #24: a single missing entry broke rendering entirely).
const DEFAULT_PERSONALITY = { type: "Circuito", note: "", level: "" };

function circuitMap(points) {
  const xs = points.map(([x]) => x);
  const zs = points.map(([, z]) => z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const width = Math.max(1, maxX - minX), height = Math.max(1, maxZ - minZ);
  const scale = Math.min(78 / width, 58 / height);
  const offsetX = (100 - width * scale) / 2;
  const offsetY = (76 - height * scale) / 2;
  const path = points.map(([x, z]) => `${(offsetX + (x - minX) * scale).toFixed(1)},${(offsetY + (z - minZ) * scale).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 100 76" role="img" aria-label="Mappa del circuito"><polyline points="${path} ${path.split(" ")[0]}" /></svg>`;
}

function selectCircuit(index, announce = true) {
  selectedCircuitIndex = (index + CIRCUITS.length) % CIRCUITS.length;
  const selectedCircuit = CIRCUITS[selectedCircuitIndex];
  try { localStorage.setItem(SELECTED_CIRCUIT_KEY, selectedCircuit.id); } catch (e) {}
  const garageLink = document.querySelector(".home-command--garage");
  if (garageLink) garageLink.href = `garage.html?circuit=${selectedCircuit.id}`;
  const track = document.getElementById("circuit-list");
  track.style.transform = `translateX(-${selectedCircuitIndex * 100}%)`;
  track.querySelectorAll(".circuit-slide").forEach((slide, i) => {
    const active = i === selectedCircuitIndex;
    slide.setAttribute("aria-hidden", String(!active));
    slide.querySelector("a").tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-circuit-index]").forEach((dot) => {
    dot.setAttribute("aria-current", dot.dataset.circuitIndex === String(selectedCircuitIndex) ? "true" : "false");
  });
  if (announce) document.getElementById("circuit-live").textContent = `${selectedCircuit.name}, ${selectedCircuitIndex + 1} di ${CIRCUITS.length}`;
}

function renderDifficulty() {
  document.getElementById("difficulty-select").innerHTML = DIFFICULTY_OPTIONS.map(
    (opt) => `
      <button
        type="button"
        class="difficulty-btn difficulty-option${opt.id === difficulty ? " active" : ""}"
        data-difficulty="${opt.id}"
        role="radio"
        aria-checked="${opt.id === difficulty}"
      ><strong>${opt.label}</strong><small>${opt.note}</small></button>
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

function renderDriverSelect() {
  const html = SELECTABLE_DRIVER_IDS.map((driverId, index) => {
    const driver = DRIVER_ROSTER.find((entry) => entry.id === driverId);
    return `
      <button
        type="button"
        class="difficulty-btn driver-option${driverId === selectedDriverId ? " active" : ""}"
        data-driver-id="${driverId}"
        role="radio"
        aria-checked="${driverId === selectedDriverId}"
      ><span>${String(index + 1).padStart(2, "0")}</span><strong>${driver.name}</strong></button>
    `;
  }).join("");
  document.getElementById("driver-select").innerHTML = html;
}

document.getElementById("driver-select").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-driver-id]");
  if (!btn) return;
  selectedDriverId = btn.dataset.driverId;
  saveSelectedDriverId(selectedDriverId);
  render();
});

function render() {
  renderDifficulty();
  renderDriverSelect();
  const { standings, allRaced, state } = computeStandings(CIRCUITS);

  if (!circuitSelectionInitialized) {
    // Back from the garage (#151): keep the stored pick while it's still
    // unraced, otherwise move on to the next unraced circuit after it.
    let stored = null;
    try { stored = localStorage.getItem(SELECTED_CIRCUIT_KEY); } catch (e) {}
    const storedIndex = Math.max(0, CIRCUITS.findIndex((circuit) => circuit.id === stored));
    let nextRace = -1;
    for (let step = 0; step < CIRCUITS.length && nextRace < 0; step++) {
      const index = (storedIndex + step) % CIRCUITS.length;
      if (!state.raceResults[CIRCUITS[index].id]) nextRace = index;
    }
    selectedCircuitIndex = nextRace >= 0 ? nextRace : storedIndex;
    circuitSelectionInitialized = true;
  }

  const bannerEl = document.getElementById("champion-banner");
  if (allRaced) {
    const champion = standings[0];
    bannerEl.hidden = false;
    bannerEl.textContent =
      champion.id === selectedDriverId
        ? `🏆 Hai vinto il campionato del mondo con ${displayDriverName("player")}!`
        : `Campionato concluso: vince ${champion.name}. Azzera e riprova.`;
  } else {
    bannerEl.hidden = true;
  }

  document.getElementById("standings-body").innerHTML = standings
    .map(
      (d, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${displayDriverName(d.id)}</td>
          <td>${d.points}</td>
        </tr>
      `
    )
    .join("");

  document.getElementById("circuit-list").innerHTML = CIRCUITS.map((circuit, index) => {
    const order = state.raceResults[circuit.id];
    const status = order ? positionLabel(order) : "Da correre";
    const personality = CIRCUIT_PERSONALITY[circuit.id] || DEFAULT_PERSONALITY;
    return `
      <article class="circuit-slide" aria-label="${circuit.name}" aria-roledescription="slide">
        <div class="circuit-card">
          <div class="circuit-map">${circuitMap(circuit.points)}<span>${String(index + 1).padStart(2, "0")}</span></div>
          <div class="circuit-copy">
            <div class="circuit-meta"><span>${personality.type}</span><span>${personality.level}</span></div>
            <h2>${circuit.name}</h2>
            <p>${personality.note}</p>
            <div class="circuit-facts"><span><b>${LAPS_PER_RACE}</b> giri</span><span><b>9</b> rivali</span><span>${circuit.weather === "pioggia" ? "🌧️ Bagnato" : "☀️ Asciutto"}</span></div>
            <div class="circuit-launch"><span class="circuit-status">${status}</span><a class="circuit-race-link" href="race.html?circuit=${circuit.id}&difficulty=${difficulty}">SCENDI IN PISTA →</a></div>
          </div>
        </div>
      </article>
    `;
  }).join("");
  document.getElementById("circuit-dots").innerHTML = CIRCUITS.map((circuit, index) => `<button type="button" data-circuit-index="${index}" aria-label="Mostra ${circuit.name}"></button>`).join("");
  selectCircuit(selectedCircuitIndex, false);
}

document.getElementById("circuit-prev").addEventListener("click", () => selectCircuit(selectedCircuitIndex - 1));
document.getElementById("circuit-next").addEventListener("click", () => selectCircuit(selectedCircuitIndex + 1));
document.getElementById("circuit-dots").addEventListener("click", (e) => {
  const dot = e.target.closest("[data-circuit-index]");
  if (dot) selectCircuit(Number(dot.dataset.circuitIndex));
});
document.getElementById("circuit-carousel").addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") { e.preventDefault(); selectCircuit(selectedCircuitIndex - 1); }
  if (e.key === "ArrowRight") { e.preventDefault(); selectCircuit(selectedCircuitIndex + 1); }
});

let swipeStartX = null;
let suppressCircuitClick = false;
const viewport = document.querySelector(".circuit-viewport");
viewport.addEventListener("pointerdown", (e) => {
  // Desktop uses the visible arrows, so mouse clicks must never enter the
  // swipe-capture path. Likewise the explicit race CTA always owns its tap.
  if (e.pointerType === "mouse" || e.target.closest(".circuit-race-link")) {
    swipeStartX = null;
    suppressCircuitClick = false;
    return;
  }
  swipeStartX = e.clientX;
  suppressCircuitClick = false;
  viewport.setPointerCapture(e.pointerId);
});
viewport.addEventListener("pointerup", (e) => {
  if (swipeStartX === null) return;
  const delta = e.clientX - swipeStartX;
  swipeStartX = null;
  if (Math.abs(delta) > 42) {
    suppressCircuitClick = true;
    selectCircuit(selectedCircuitIndex + (delta < 0 ? 1 : -1));
  }
});
viewport.addEventListener("pointercancel", () => { swipeStartX = null; });
viewport.addEventListener("click", (e) => {
  if (!suppressCircuitClick) return;
  e.preventDefault();
  suppressCircuitClick = false;
}, true);

document.getElementById("reset-btn").addEventListener("click", () => {
  if (confirm("Azzerare punti e risultati del campionato?")) {
    resetChampionship();
    render();
  }
});

render();
