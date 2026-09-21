// Canonical ten-driver roster. A race always uses one selected identity for
// the player and the other nine as AI, so names can never be duplicated.
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
];

export function driverById(driverId) {
  return DRIVER_ROSTER.find((driver) => driver.id === driverId) || DRIVER_ROSTER[0];
}
