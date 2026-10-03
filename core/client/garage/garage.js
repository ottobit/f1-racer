import {
  GARAGE_PARTS,
  loadGarageSetup,
  playerLivery,
  saveGarageSetup,
  setupEffects,
} from "../shared/garage-setup.js?v=31";
import { createShowroom } from "./showroom.js?v=44";
import { mountRoadGarage } from "./road-garage-ui.js?v=3";
import { VEHICLES, vehicleById } from "../shared/vehicle.js?v=1";
import { SERIES, loadSeries } from "../shared/series.js?v=1";
import { getCircuit } from "../../shared/circuits.js?v=41";
import { loadSelectedDriverId } from "../shared/driver-selection.js?v=3";
import { loadGraphicsProfile } from "../shared/graphics-profiles.js?v=4";
import { setupDiagnosticsOverlay } from "../race/race-diagnostics.js?v=1";

const SELECTED_CIRCUIT_KEY = "f1racer-selected-circuit";
const requestedCircuit = new URLSearchParams(location.search).get("circuit");
let storedCircuit = null;
try { storedCircuit = localStorage.getItem(SELECTED_CIRCUIT_KEY); } catch (e) {}
const targetCircuit = getCircuit(requestedCircuit || storedCircuit);

// Which car is in the garage (#323): ?car= wins, else the Classiche
// driver's car when that series is the home's pick, else the F1.
function garageVehicle() {
  const fromUrl = vehicleById(new URLSearchParams(location.search).get("car"));
  if (fromUrl) return fromUrl;
  const series = loadSeries();
  return series.vehicle(series.loadDriverId());
}
const vehicle = garageVehicle();
// Same device-signal profile the race applies to its renderer (#2).
const graphicsProfile = loadGraphicsProfile();
let diagnostics = null;
const onFrame = (dt) => diagnostics?.update(dt);

// Car picker: reload with ?car=, the simplest way to rebuild the showroom.
const pickerEl = document.getElementById("garage-car-select");
for (const car of Object.values(VEHICLES)) pickerEl.add(new Option(car.label, car.id, false, car === vehicle));
pickerEl.addEventListener("change", () => {
  const params = new URLSearchParams(location.search);
  params.set("car", pickerEl.value);
  location.search = params.toString();
});

// The F1 and the period cars have different garages (parts, paint).
if (vehicle === VEHICLES.f1) mountF1Garage();
else {
  // A Classiche driver's colours on their own car; the car's otherwise.
  const baseColors = SERIES.classic.baseColors(SERIES.classic.loadDriverId(), vehicle);
  const { renderer } = mountRoadGarage(vehicle, { baseColors, graphicsProfile, onFrame });
  diagnostics = setupDiagnosticsOverlay({ renderer, graphicsProfileId: graphicsProfile.id });
}

function mountF1Garage() {
  let setup = loadGarageSetup();
  const { car, renderer, focusPart } = createShowroom(document.getElementById("garage-canvas"), {
    colors: playerLivery(loadSelectedDriverId()),
    graphicsProfile,
    onFrame,
  });
  // Same opt-in overlay the race uses (?diag=1, #2) — off and DOM-free by
  // default, so a normal Garage visit is unaffected.
  diagnostics = setupDiagnosticsOverlay({ renderer, graphicsProfileId: graphicsProfile.id });

  function applyVisual() {
    car.traverse((o) => {
      if (o.name === "floorPanel") o.scale.x = setup.floor === "high" ? 1.08 : setup.floor === "low" ? 0.94 : 1;
      if (o.name === "diffuserFin") o.scale.y = setup.floor === "high" ? 1.5 : setup.floor === "low" ? 0.6 : 1;
      if (o.name === "setupSpring") o.scale.y = setup.suspension === "soft" ? 1.2 : setup.suspension === "stiff" ? 0.75 : 1;
      if (o.name === "setupCaliper") o.material.color.set(setup.brakes === "aggressive" ? 0xd54b38 : setup.brakes === "stable" ? 0x74b6c7 : 0xb69050);
    });
    const fw = car.getObjectByName("frontWing");
    const rw = car.getObjectByName("rearWing");
    if (fw) fw.rotation.x = setup.frontWing === "high" ? -0.16 : setup.frontWing === "low" ? 0.08 : -0.05;
    if (rw) {
      rw.position.y = setup.rearWing === "high" ? 1.08 : setup.rearWing === "low" ? 0.86 : 0.95;
      rw.rotation.x = setup.rearWing === "high" ? -0.18 : setup.rearWing === "low" ? 0.08 : 0;
    }
  }

  const labels = {
    speed: "Velocità",
    downforce: "Carico",
    braking: "Frenata",
    stability: "Stabilità",
    traction: "Trazione",
  };

  function renderUI() {
    const effects = setupEffects(setup);
    const base = { speed: 50, downforce: 50, braking: 50, stability: 50, traction: 50 };
    const stats = Object.entries(base)
      .map(([k, v]) => { const value = Math.max(10, Math.min(90, v + (effects[k] || 0) * 7)); return `<div><span>${labels[k]}</span><div><i style="width:${value}%"></i></div><b>${value}</b></div>`; })
      .join("");
    // Overlaid on the car on wide screens, inside the setup pane on phones.
    document.querySelectorAll("[data-garage-stats]").forEach((el) => { el.innerHTML = stats; });
    const recommendation = targetCircuit.recommendedSetup;
    const setupKeys = Object.keys(GARAGE_PARTS);
    const changes = setupKeys.filter((part) => setup[part] !== recommendation[part]);
    document.getElementById("garage-recommendation").innerHTML = `<div><span>CONSIGLIATO · ${targetCircuit.name}</span><p>${recommendation.reason}</p></div><ul>${setupKeys.map((part) => `<li class="${setup[part] === recommendation[part] ? "is-matched" : "is-change"}"><b>${GARAGE_PARTS[part].label}</b><span>${GARAGE_PARTS[part].variants[setup[part]].label} → ${GARAGE_PARTS[part].variants[recommendation[part]].label}</span></li>`).join("")}</ul><button type="button" data-apply-recommendation ${changes.length ? "" : "disabled"}>${changes.length ? `APPLICA ${changes.length} MODIFICHE` : "ASSETTO GIÀ APPLICATO"}</button>`;
    document.getElementById("garage-parts").innerHTML = Object.entries(GARAGE_PARTS)
      .map(([part, data]) => `<section class="garage-part"><h2>${data.label}</h2><div>${Object.entries(data.variants).map(([id, v]) => `<button draggable="true" data-part="${part}" data-id="${id}" aria-pressed="${setup[part] === id}" class="${setup[part] === id ? "active" : ""}">${v.label}</button>`).join("")}</div></section>`)
      .join("");
    document.querySelectorAll(".garage-mount").forEach((z) => z.classList.toggle("installed", !!setup[z.dataset.part]));
    applyVisual();
  }

  function mount(part, id) {
    if (!GARAGE_PARTS[part]?.variants[id]) return;
    setup[part] = id;
    saveGarageSetup(setup);
    renderUI();
    focusPart(part);
    const z = document.querySelector(`.garage-mount[data-part="${part}"]`);
    if (z) {
      z.classList.add("just-mounted");
      setTimeout(() => z.classList.remove("just-mounted"), 650);
    }
    document.getElementById("garage-status").textContent = `Assetto salvato · ${GARAGE_PARTS[part].label}: ${GARAGE_PARTS[part].variants[id].label}.`;
  }

  document.getElementById("garage-parts").addEventListener("dragstart", (e) => {
    const b = e.target.closest("[data-part]");
    if (!b) return;
    e.dataTransfer.setData("text/plain", JSON.stringify({ part: b.dataset.part, id: b.dataset.id }));
    document.body.dataset.dragPart = b.dataset.part;
    document.getElementById("garage-status").textContent = `Trascina ${GARAGE_PARTS[b.dataset.part].label} sulla zona evidenziata della monoposto.`;
  });

  document.getElementById("garage-parts").addEventListener("dragend", () => {
    delete document.body.dataset.dragPart;
  });

  document.getElementById("garage-parts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-part]");
    if (b) mount(b.dataset.part, b.dataset.id);
  });

  document.getElementById("garage-recommendation").addEventListener("click", (e) => {
    if (!e.target.closest("[data-apply-recommendation]")) return;
    Object.keys(GARAGE_PARTS).forEach((part) => { setup[part] = targetCircuit.recommendedSetup[part]; });
    saveGarageSetup(setup);
    renderUI();
    document.getElementById("garage-status").textContent = `Assetto consigliato per ${targetCircuit.name} applicato.`;
  });

  document.querySelectorAll(".garage-mount").forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (document.body.dataset.dragPart === zone.dataset.part) zone.classList.add("over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("over");
      try {
        const d = JSON.parse(e.dataTransfer.getData("text/plain"));
        if (d.part === zone.dataset.part) mount(d.part, d.id);
        else document.getElementById("garage-status").textContent = "Questo componente va montato sulla zona con lo stesso nome.";
      } catch (_) {}
    });
  });

  renderUI();
}
