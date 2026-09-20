import {
  GARAGE_LIVERIES,
  GARAGE_PARTS,
  loadGarageSetup,
  saveGarageSetup,
  selectedGarageLivery,
  setupEffects,
} from "./garage-setup.js";
import { createShowroom } from "./showroom.js";

let setup = loadGarageSetup();
const { car, focusPart, setLivery } = createShowroom(document.getElementById("garage-canvas"), {
  livery: selectedGarageLivery(setup),
});

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
  setLivery(selectedGarageLivery(setup));
}

const labels = {
  speed: "Velocità",
  downforce: "Carico",
  braking: "Frenata",
  stability: "Stabilità",
  traction: "Trazione",
};

function hex(color) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function renderUI() {
  const effects = setupEffects(setup);
  const base = { speed: 50, downforce: 50, braking: 50, stability: 50, traction: 50 };
  document.getElementById("garage-stats").innerHTML = Object.entries(base)
    .map(([k, v]) => `<div><span>${labels[k]}</span><div><i style="width:${Math.max(10, Math.min(90, v + (effects[k] || 0) * 7))}%"></i></div></div>`)
    .join("");
  document.getElementById("garage-liveries").innerHTML = `<span>LIVREA GARA</span>${GARAGE_LIVERIES.map((livery) => `<button class="livery-choice ${setup.livery === livery.id ? "active" : ""}" data-livery="${livery.id}" aria-pressed="${setup.livery === livery.id}" aria-label="${livery.label}"><i style="--primary:${hex(livery.primary)};--secondary:${hex(livery.secondary)}"></i><b>${livery.label}</b></button>`).join("")}`;
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
  document.getElementById("garage-status").textContent = `${GARAGE_PARTS[part].label}: ${GARAGE_PARTS[part].variants[id].label} montato.`;
}

function chooseLivery(id) {
  if (!GARAGE_LIVERIES.some((livery) => livery.id === id)) return;
  setup.livery = id;
  saveGarageSetup(setup);
  renderUI();
  document.getElementById("garage-status").textContent = `Livrea ${selectedGarageLivery(setup).label} salvata per la prossima gara.`;
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

document.getElementById("garage-liveries").addEventListener("click", (e) => {
  const b = e.target.closest("[data-livery]");
  if (b) chooseLivery(b.dataset.livery);
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