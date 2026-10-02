// Classiche (#317): the period-car series beside F1. Twelve made-up drivers,
// two per road car (shared/road-cars.js), each pair in its own colours like
// F1 team-mates. Picking one on home switches the series; race.html reads
// ?series=classic. Solo only: no championship points, no multiplayer.
// One-make races (#321): the driver picks the car, and the other eleven
// drivers race that same car in their own colours.
export const CLASSIC_ROSTER = [
  { id: "classic-gino", name: "Nonno Gino", car: "cinquino", colors: { primary: 0x5c371f } },
  { id: "classic-pina", name: "Zia Pina", car: "cinquino", colors: { primary: 0xe8dcc0 } },
  { id: "classic-sandro", name: "Sandro Sterzo", car: "pandina", colors: { primary: 0xf1f1ee } },
  { id: "classic-lella", name: "Lella Frizione", car: "pandina", colors: { primary: 0xc8302c } },
  { id: "classic-rocco", name: "Rocco Cabrio", car: "spider", colors: { primary: 0xb3121b } },
  { id: "classic-vera", name: "Vera Brezza", car: "spider", colors: { primary: 0x1f4d36 } },
  { id: "classic-beppe", name: "Beppe Bagagli", car: "pulmino", colors: { primary: 0x7fb3d5, secondary: 0xf2efe6 } },
  { id: "classic-tina", name: "Tina Gita", car: "pulmino", colors: { primary: 0xe8892b, secondary: 0xf2efe6 } },
  { id: "classic-tony", name: "Big Tony", car: "muscle", colors: { primary: 0xf2b705, secondary: 0x111111 } },
  { id: "classic-ray", name: "Ray Cromo", car: "muscle", colors: { primary: 0x15171b, secondary: 0xe8892b } },
  { id: "classic-ugo", name: "Ugo Bauletto", car: "familiare", colors: { primary: 0x2f6b4a } },
  { id: "classic-rina", name: "Rina Picnic", car: "familiare", colors: { primary: 0x9fc3d8 } },
];

const SERIES_KEY = "f1racer-series";
const CLASSIC_DRIVER_KEY = "f1racer-classic-driver";

export function classicDriverById(id) {
  return CLASSIC_ROSTER.find((driver) => driver.id === id) || null;
}

function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

// "f1" | "classic"; home's last pick.
export function loadSeries() {
  return load(SERIES_KEY) === "classic" ? "classic" : "f1";
}

export function saveSeries(series) {
  save(SERIES_KEY, series === "classic" ? "classic" : "f1");
}

export function loadClassicDriverId() {
  const id = load(CLASSIC_DRIVER_KEY);
  return classicDriverById(id) ? id : CLASSIC_ROSTER[0].id;
}

export function saveClassicDriverId(id) {
  if (classicDriverById(id)) save(CLASSIC_DRIVER_KEY, id);
}
