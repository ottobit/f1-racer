// Road-car garage page (#323): the period car in the showroom, its setup
// (road-garage.js) and paint, saved per car. Same page and panes as the F1
// atelier; the F1-only bits (mount zones, circuit recommendation) are hidden.
import {
  ROAD_PALETTE,
  ROAD_PARTS,
  ROAD_STATS,
  roadColors,
  roadSetupEffects,
  saveRoadSetup,
} from "../shared/road-garage.js?v=1";
import { createShowroom } from "./showroom.js?v=47";

const KMH_PER_UNIT = 3.6;
const hex = (color) => `#${color.toString(16).padStart(6, "0")}`;

// baseColors: what the car wears with no paint chosen (the Classiche
// driver's colours, or the car's own).
// car: a RoadCar (shared/vehicle.js, #339).
export function mountRoadGarage(car, { baseColors, graphicsProfile, onFrame }) {
  const vehicle = car.id;
  let setup = car.loadGarage();
  const showroom = createShowroom(document.getElementById("garage-canvas"), {
    vehicle: car, colors: roadColors(vehicle, baseColors, setup), graphicsProfile, onFrame,
  });
  const status = document.getElementById("garage-status");
  const roles = car.colors.secondary === undefined ? ["primary"] : ["primary", "secondary"];

  document.body.classList.add("garage-road");
  document.getElementById("garage-recommendation").hidden = true;
  document.querySelector(".config-heading h2").innerHTML = "Assetto auto<span>01 / 04</span>";
  document.querySelector(".config-heading p").textContent = "Gomme, rapporti, freni, sospensioni e vernice.";
  document.querySelector(".atelier-title p").textContent = "La tua auto d'epoca. Il tuo equilibrio.";
  document.querySelector(".parts-heading").innerHTML = "COMPONENTI <span>TOCCA PER MONTARE</span>";
  document.querySelector(".car-caption > span").textContent = car.label.toUpperCase();
  status.textContent = "Assetto salvato automaticamente. Vale in Classiche e in guida libera.";

  function paintSection(role) {
    const current = setup[role];
    const swatches = ROAD_PALETTE.map((color) => `<button type="button" class="garage-swatch${current === color ? " active" : ""}" data-paint="${role}" data-color="${color}" aria-pressed="${current === color}" aria-label="Colore ${hex(color)}" style="background:${hex(color)}"></button>`).join("");
    return `<section class="garage-part garage-paint"><h2>${role === "primary" ? "Carrozzeria" : "Secondo colore"}</h2><div><button type="button" class="garage-swatch-own${current === null ? " active" : ""}" data-paint="${role}" data-color="" aria-pressed="${current === null}">Originale</button>${swatches}</div></section>`;
  }

  function renderUI() {
    const effects = roadSetupEffects(setup);
    const stats = Object.entries(ROAD_STATS)
      .map(([stat, label]) => { const value = Math.round(Math.max(10, Math.min(90, 50 + effects[stat] * 500))); return `<div><span>${label}</span><div><i style="width:${value}%"></i></div><b>${value}</b></div>`; })
      .join("");
    document.querySelectorAll("[data-garage-stats]").forEach((el) => { el.innerHTML = stats; });
    const topSpeed = Math.round(car.playerParams(false, setup).maxSpeed * KMH_PER_UNIT);
    document.querySelector(".car-caption p").textContent = `CLASSICHE · ${topSpeed} KM/H`;
    document.getElementById("garage-parts").innerHTML = Object.entries(ROAD_PARTS)
      .map(([part, data]) => `<section class="garage-part"><h2>${data.label}</h2><div>${Object.entries(data.variants).map(([id, v]) => `<button type="button" data-road-part="${part}" data-id="${id}" aria-pressed="${setup[part] === id}" class="${setup[part] === id ? "active" : ""}">${v.label}</button>`).join("")}</div></section>`)
      .join("") + roles.map(paintSection).join("");
  }

  document.getElementById("garage-parts").addEventListener("click", (e) => {
    const part = e.target.closest("[data-road-part]");
    const paint = e.target.closest("[data-paint]");
    if (part && ROAD_PARTS[part.dataset.roadPart]?.variants[part.dataset.id]) {
      const data = ROAD_PARTS[part.dataset.roadPart];
      setup[part.dataset.roadPart] = part.dataset.id;
      showroom.focusPart(part.dataset.roadPart);
      status.textContent = `Assetto salvato · ${data.label}: ${data.variants[part.dataset.id].label}.`;
    } else if (paint) {
      setup[paint.dataset.paint] = paint.dataset.color === "" ? null : Number(paint.dataset.color);
      showroom.repaint(roadColors(vehicle, baseColors, setup));
      status.textContent = "Vernice salvata.";
    } else {
      return;
    }
    saveRoadSetup(vehicle, setup);
    renderUI();
  });

  renderUI();
  return showroom;
}
