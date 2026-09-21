export const TEAM_LIVERIES = [
  { id: "fenice", label: "Fenice", primary: 0xe10600, secondary: 0xf4d35e },
  { id: "nettuno", label: "Nettuno", primary: 0x1c5fd6, secondary: 0x6ee7f9 },
  { id: "solare", label: "Solare", primary: 0xe6c229, secondary: 0x111820 },
  { id: "smeraldo", label: "Smeraldo", primary: 0x1f9d4a, secondary: 0xc9f7d5 },
  { id: "artica", label: "Artica", primary: 0xf5f5f5, secondary: 0x7aa7c7 },
];

const LIVERY_BY_ID = Object.fromEntries(TEAM_LIVERIES.map((livery) => [livery.id, livery]));

export function liveryById(id) {
  return LIVERY_BY_ID[id] || LIVERY_BY_ID.fenice;
}

export function liveryIdForDriver(driverId) {
  if (driverId === "rival-red" || driverId === "rival-red-2" || driverId === "player") return "fenice";
  if (driverId === "rival-blue" || driverId === "rival-blue-2") return "nettuno";
  if (driverId === "rival-yellow" || driverId === "rival-yellow-2") return "solare";
  if (driverId === "rival-green-1" || driverId === "rival-green-2") return "smeraldo";
  if (driverId === "rival-white-1" || driverId === "rival-white-2") return "artica";
  return "fenice";
}

export const DRIVER_COCKPIT_THEMES = {
  "rival-red": {
    label: "Dani Muscle",
    motto: "PUSH",
    primary: 0xff2a16,
    secondary: 0xf5c84b,
    glow: 0xff7a2f,
  },
  "rival-red-2": {
    label: "Eddy Nitro",
    motto: "IGNITE",
    primary: 0xd9162b,
    secondary: 0xffc857,
    glow: 0xff5c35,
  },
  "rival-blue": {
    label: "Vivian Wendy",
    motto: "FLOW",
    primary: 0x5aa8ff,
    secondary: 0xf2f7ff,
    glow: 0x6ee7f9,
  },
  "rival-blue-2": {
    label: "Peppy Bau",
    motto: "BOOST",
    primary: 0x1c5fd6,
    secondary: 0xffd166,
    glow: 0x78f0ff,
  },
  "rival-yellow": {
    label: "Cookie",
    motto: "SWEET",
    primary: 0xe6c229,
    secondary: 0x2a1b10,
    glow: 0xfff08a,
  },
  "rival-yellow-2": {
    label: "Rocker Pino",
    motto: "LOUD",
    primary: 0xffc533,
    secondary: 0x161616,
    glow: 0xff6b35,
  },
  "rival-green-1": {
    label: "Alice AaA",
    motto: "APEX",
    primary: 0x28d66f,
    secondary: 0xe8fff1,
    glow: 0x8cffb1,
  },
  "rival-green-2": {
    label: "May",
    motto: "CALM",
    primary: 0x1f9d4a,
    secondary: 0xc9f7d5,
    glow: 0xb8ffdc,
  },
  "rival-white-1": {
    label: "Clopy",
    motto: "ICE",
    primary: 0xf5f5f5,
    secondary: 0x89c7ff,
    glow: 0xbfe8ff,
  },
  "rival-white-2": {
    label: "Lola",
    motto: "STAR",
    primary: 0xffffff,
    secondary: 0xf0a6ff,
    glow: 0xffc4f7,
  },
};

export function cockpitThemeForDriver(driverId) {
  return DRIVER_COCKPIT_THEMES[driverId] || DRIVER_COCKPIT_THEMES["rival-red"];
}
