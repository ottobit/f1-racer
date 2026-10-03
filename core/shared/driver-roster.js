// Canonical roster: one selected identity for the player, all others as AI.
// Paired team identities remain unique in solo and multiplayer races.
export const DRIVER_ROSTER = [
  { id: "rival-red", name: "Dani Muscle", team: "fenice" },
  { id: "rival-red-2", name: "Eddy Nitro", team: "fenice" },
  { id: "rival-blue", name: "Vivian Wendy", team: "nettuno" },
  { id: "rival-blue-2", name: "Peppy Bau", team: "nettuno" },
  { id: "rival-yellow", name: "Cookie", team: "solare" },
  { id: "rival-yellow-2", name: "Rocker Pino", team: "solare" },
  { id: "rival-green-1", name: "Alice AaA", team: "smeraldo" },
  { id: "rival-green-2", name: "May", team: "smeraldo" },
  { id: "rival-white-1", name: "Clopy", team: "artica" },
  { id: "rival-white-2", name: "Lola", team: "artica" },
  { id: "rival-black-1", name: "Nico Ombra", team: "ossidiana" },
  { id: "rival-black-2", name: "Mira Onyx", team: "ossidiana" },
];

export function driverById(driverId) {
  return DRIVER_ROSTER.find((driver) => driver.id === driverId) || DRIVER_ROSTER[0];
}
