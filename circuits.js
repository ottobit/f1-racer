// Circuit definitions shared between the menu and the race page. Control
// points are hand-placed and validated offline (min curvature radius and
// minimum non-adjacent centerline separation, both comfortably above the
// track's own wall margin) before being added here — see the project's
// dev notes if you add a new one, tight corners can make the road ribbon
// or the wall-bounce collision behave oddly.

export const LAPS_PER_RACE = 3;

export const CIRCUITS = [
  {
    id: "vallechiara",
    name: "Autodromo di Vallechiara",
    width: 14,
    points: [
      [-100, 65], [30, 80], [100, 40], [90, -30], [40, -80], [-50, -95],
      [-120, -50], [-135, 10],
    ],
  },
  {
    id: "portoscuro",
    name: "Circuito di Portoscuro",
    width: 12,
    // The one circuit that's always wet — a fixed trait of this track (like
    // Spa's weather reputation in real F1), not a random per-race dice roll.
    weather: "pioggia",
    points: [
      [-70, 40], [-20, 55], [30, 50], [52, 12], [48, -18], [45, -45],
      [30, -60], [-20, -65], [-55, -40], [-75, -5],
    ],
  },
  {
    id: "altomare",
    name: "Circuito di Altomare",
    width: 16,
    points: [
      [-160, 90], [40, 120], [150, 60], [170, -40], [80, -120],
      [-60, -140], [-170, -70], [-190, 20],
    ],
  },
  {
    id: "montenero",
    name: "Circuito di Montenero",
    // The tightest, narrowest circuit of the four — a technical street
    // layout rather than a flowing high-speed one, for genuine variety
    // rather than a fourth copy of the same shape at a different size.
    // Control points are star-convex around the origin (each one further
    // out or in than its neighbours, listed in angle order), which is what
    // guarantees the closed spline below can't loop back and cross itself
    // — see the validation script referenced above for the actual numbers
    // (minimum curvature radius, wall-margin safety, grid slots on track).
    width: 11,
    points: [
      [130, 0], [95, 55], [35, 61], [0, 55], [-38, 65], [-87, 50],
      [-120, 0], [-87, -50], [-33, -56], [0, -50], [38, -65], [95, -55],
    ],
  },
];

export function getCircuit(id) {
  return CIRCUITS.find((c) => c.id === id) || CIRCUITS[0];
}
