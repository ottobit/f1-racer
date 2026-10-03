// Circuit definitions and race format, shared by the browser and the room
// server (core/shared/: no DOM, no three). Control
// points are hand-placed and should be checked before being added here —
// run `node tools/validate-circuits.mjs <id>` (see #6), which verifies
// closure, winding, segment length, min curvature radius and minimum
// non-adjacent centerline separation against this same data. Tight corners
// can make the road ribbon or the wall-bounce collision behave oddly.

export const LAPS_PER_RACE = 5;
// Tyre life is fixed, not tied to race length (#149): a set is fully worn
// after this many laps, so a car that never boxes runs the last laps of a
// race on dead tyres.
export const TYRE_LIFE_LAPS = 3;
// Qualifying length: the race page's own timer and the room server's
// (which times multiplayer qualifying out for every client) both use it.
export const QUALIFYING_DURATION_MS = 60000;

export const CIRCUITS = [
  {
    id: "vallechiara",
    name: "Autodromo di Vallechiara",
    width: 14,
    recommendedSetup: { frontWing:"balanced", rearWing:"balanced", floor:"high", brakes:"aggressive", suspension:"balanced", reason:"Carico dal fondo per le curve veloci, senza sacrificare il rettilineo." },
    points: [
      [-100, 65], [30, 80], [100, 40], [90, -30], [40, -80], [-50, -95],
      [-120, -50], [-135, 10],
    ],
  },
  {
    id: "portoscuro",
    name: "Circuito di Portoscuro",
    width: 12,
    recommendedSetup: { frontWing:"high", rearWing:"high", floor:"high", brakes:"stable", suspension:"soft", reason:"Massima aderenza e risposta progressiva sul bagnato." },
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
    recommendedSetup: { frontWing:"low", rearWing:"low", floor:"low", brakes:"aggressive", suspension:"stiff", reason:"Bassa resistenza per i lunghi rettifili e piattaforma rigida negli appoggi." },
    points: [
      [-160, 90], [40, 120], [150, 60], [170, -40], [80, -120],
      [-60, -140], [-170, -70], [-190, 20],
    ],
  },
  {
    id: "montenero",
    name: "Circuito di Montenero",
    // Competitive street layout: no longer a scaled-down Colleverde. The
    // eastern side is a long acceleration zone into a heavy braking corner;
    // the north-middle pair forms a fast S, and the western loop tightens
    // into a slow restart before the technical final sector. It stays narrow
    // and wall-close, but now offers several distinct attack/preparation
    // zones instead of one continuous sequence of similarly paced bends.
    width: 11,
    recommendedSetup: { frontWing:"high", rearWing:"balanced", floor:"high", brakes:"aggressive", suspension:"balanced", reason:"Carico anteriore per la esse, stabilità in staccata e trazione per il tornante senza sacrificare il rettilineo principale." },
    points: [
      [165, -10], [165, 58], [120, 98], [58, 92], [18, 68], [-32, 102],
      [-108, 88], [-150, 55], [-160, 10], [-138, -32], [-86, -45],
      [-35, -30], [-5, -78], [62, -108], [128, -72],
    ],
  },
  {
    id: "colleverde",
    name: "Circuito di Colleverde",
    // A flowing, mostly high-speed hillside circuit rather than a technical
    // one (that's Montenero's job) — wide, sweeping corners with generous
    // curvature throughout, for a fifth layout that plays differently from
    // all four above instead of just being a fifth version of the same
    // shape. Star-convex around the origin like Montenero's points (each
    // one at its own angle, further out or in than its neighbours), which
    // is what keeps the closed spline from looping back and crossing
    // itself — checked offline (min curvature radius comfortably above the
    // wall margin, no grid slot off track) before being added here.
    width: 13,
    recommendedSetup: { frontWing:"balanced", rearWing:"low", floor:"high", brakes:"aggressive", suspension:"stiff", reason:"Fondo efficiente e retrotreno scarico per conservare velocità nelle sequenze ampie." },
    points: [
      [148, 26], [84, 78], [20, 77], [-30, 90], [-101, 82], [-144, 16],
      [-108, -53], [-46, -77], [2, -70], [57, -82], [125, -52],
    ],
  },
  {
    id: "marzamemi",
    name: "Circuito di Marzamemi",
    width: 9,
    theme: "marzamemi",
    curveTension: 0.18,
    recommendedSetup: { frontWing:"high", rearWing:"balanced", floor:"high", brakes:"aggressive", suspension:"soft", reason:"Carico anteriore e sospensioni morbide per i due cappi stretti e l'asfalto urbano sconnesso." },
    // The supplied route is an elongated coastal dogbone. The real streets
    // share a central corridor; the race adaptation separates the two legs
    // enough for a closed spline, walls and ten cars while preserving both
    // end loops and the long Viale degli Oleandri character.
    points: [
      // Map-image coordinates: long diagonal, angular coastal loop, then
      // the shorter rectangular inland loop. Keep corner approach points
      // close so interpolation rounds only the apex, not the whole block.
      [110, 679], [220, 628], [380, 554], [500, 494],
      [552, 468], [568, 464], [577, 474], [582, 497],
      [588, 541], [587, 557], [569, 559], [554, 554],
      [526, 536], [509, 532], [454, 533], [430, 540],
      [391, 573], [365, 589], [260, 637], [243, 645],
      [239, 656], [244, 686], [243, 699], [229, 707],
      [145, 749], [110, 760], [96, 760], [85, 752], [76, 741],
      [61, 733], [55, 717], [57, 706], [73, 698],
    ].map(([x, z]) => [(x - 320) * 1.4, (z - 620) * 1.4]),
  },
  {
    id: "pianalago",
    name: "Circuito di Pianalago",
    // A lakeside layout: still the most flowing of the three newest
    // circuits, but no longer a pure oval — two real corners (apex points
    // tightened well past their neighbours) break up the sweeps. Star-convex
    // control points, generated procedurally with a hairpin-insertion pass
    // (tight approach/apex/exit triple at each corner, same technique as
    // Marzamemi's real corners) and validated with
    // `node tools/validate-circuits.mjs pianalago` (#6) — 0 errors/warnings,
    // minimum curvature radius comfortably (~15%) above the wall margin.
    width: 15,
    curveTension: 0.5,
    recommendedSetup: { frontWing:"low", rearWing:"low", floor:"balanced", brakes:"stable", suspension:"soft", reason:"Curve ampie e mai strette: bassa resistenza e un assetto comodo battono il carico puro." },
    points: [
      [170, -3], [131, 107], [98, 112], [17, 85], [-48, 141], [-76, 135],
      [-143, 51], [-126, -49], [-97, -57], [-32, -57], [1, -112], [24, -122],
      [116, -95],
    ],
  },
  {
    id: "serramonte",
    name: "Circuito di Serramonte",
    // A tight mountain-pass circuit — the narrowest and technically
    // tightest layout in the roster, now with three genuine hairpins (not
    // just tight sweeps) carved in via the same corner-insertion technique
    // as Marzamemi. Frequent direction changes reward a rigid platform over
    // Montenero's traction-focused softness. Star-convex control points,
    // generated procedurally and validated with
    // `node tools/validate-circuits.mjs serramonte` (#6) — 0 errors/
    // warnings, minimum curvature radius comfortably (~18%) above the wall
    // margin.
    width: 10,
    curveTension: 0.5,
    recommendedSetup: { frontWing:"high", rearWing:"high", floor:"high", brakes:"aggressive", suspension:"stiff", reason:"Tornanti ravvicinati e cambi di direzione continui: serve una piattaforma rigida, non morbida." },
    points: [
      [146, -2], [144, 24], [93, 82], [42, 140], [22, 137], [-61, 108],
      [-81, 99], [-103, 35], [-124, -29], [-144, -56], [-78, -128],
      [-44, -113], [19, -101], [82, -89], [98, -80],
    ],
  },
  {
    id: "baiadoro",
    name: "Circuito di Baiadoro",
    // A modern, mixed-character seaside layout: one long straight leads
    // into a tighter technical complex — now a real single hairpin, not
    // just a gentler sweep, carved in via the same corner-insertion
    // technique as Marzamemi. The widest circuit in the roster, matching its
    // long-straight DRS-zone identity. Star-convex control points, generated
    // procedurally and validated with `node tools/validate-circuits.mjs
    // baiadoro` (#6) — 0 errors/warnings, minimum curvature radius
    // comfortably (~17%) above the wall margin.
    width: 17,
    curveTension: 0.5,
    recommendedSetup: { frontWing:"balanced", rearWing:"low", floor:"balanced", brakes:"aggressive", suspension:"balanced", reason:"Retrotreno scarico per il lungo rettilineo, freni aggressivi per il complesso tecnico finale." },
    points: [
      [128, 0], [125, 101], [27, 177], [-87, 149], [-137, 53], [-103, -39],
      [-65, -42], [-32, -58], [-2, -78], [11, -76], [74, -60],
    ],
  },
];

export function getCircuit(id) {
  return CIRCUITS.find((c) => c.id === id) || CIRCUITS[0];
}
