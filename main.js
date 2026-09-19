import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CIRCUITS, getCircuit, LAPS_PER_RACE } from "./circuits.js";
import { DRIVERS, POINTS_BY_POSITION, recordRaceResult } from "./championship.js";

/*
 * F1 Racer — championship mode: a fixed-lap race against two AI rivals on
 * one of several circuits, feeding into a persisted points standings (see
 * championship.js / menu.js). Placeholder car/track geometry: primitives,
 * not real models. Track is a closed Catmull-Rom spline through
 * hand-placed control points — validated offline for minimum curvature
 * radius and self-intersection before shipping (see circuits.js).
 *
 * Heading convention used throughout: heading 0 means "facing world +Z",
 * and moving forward means dx = sin(heading), dz = cos(heading).
 */

const circuitId = new URLSearchParams(location.search).get("circuit");
const circuit = getCircuit(circuitId);

const TRACK_WIDTH = circuit.width;
const CONTROL_POINTS = circuit.points.map(([x, z]) => new THREE.Vector3(x, 0, z));

// Light dynamic weather: a fixed per-circuit trait (see circuits.js), not
// randomized per race. Rain only touches cornering grip and top speed —
// braking/acceleration feel is left alone — plus a darker, closer sky and
// fog so it also reads as wet at a glance, not just plays different.
const isRaining = circuit.weather === "pioggia";
const RAIN_TURN_RATE_MULTIPLIER = 0.82;
const RAIN_MAX_SPEED_MULTIPLIER = 0.93;

const trackCurve = new THREE.CatmullRomCurve3(CONTROL_POINTS, true, "catmullrom", 0.5);

// Top speed is tuned to a realistic F1 figure (maxSpeed is treated as m/s
// for the km/h readout below, so 84 -> ~302 km/h on a straight) rather than
// the earlier, much slower placeholder value — accel/brakeDecel/coastDecel
// scale up with it so 0-100%, braking distance, and grass drag all still
// feel like the same car, just faster.
const CAR = {
  maxSpeed: 84 * (isRaining ? RAIN_MAX_SPEED_MULTIPLIER : 1),
  reverseMaxSpeed: -28,
  accel: 47,
  brakeDecel: 75,
  coastDecel: 28,
  maxTurnRate: 2.0 * (isRaining ? RAIN_TURN_RATE_MULTIPLIER : 1), // rad/s ceiling; actual rate is scaled down further by
  // speed in update() below — a single quick tap used to be enough to spin
  // off track at top speed, so turn authority now drops off as you speed up
  // instead of maxing out there.
};
const CAR_SCALE = 0.55;

// AI difficulty: chosen on the circuit menu (menu.js), carried here as a
// query param, scaling how fast and how hard the rivals accelerate. Turn
// rate is left alone — they already steer within track limits regardless
// of difficulty, so a harder AI should out-pace you, not out-corner you
// unrealistically.
const DIFFICULTY_PRESETS = {
  facile: { speedMul: 0.88, accelMul: 0.85 },
  normale: { speedMul: 1, accelMul: 1 },
  difficile: { speedMul: 1.1, accelMul: 1.12 },
};
const difficulty = new URLSearchParams(location.search).get("difficulty");
const diffPreset = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normale;

const AI = {
  maxSpeed: 71 * diffPreset.speedMul * (isRaining ? RAIN_MAX_SPEED_MULTIPLIER : 1),
  accel: 41 * diffPreset.accelMul,
  turnRate: 2.1 * (isRaining ? RAIN_TURN_RATE_MULTIPLIER : 1),
  lookahead: 10, // centerline samples ahead to steer toward
};

// Tire wear: grip degrades gradually over the race distance, for both the
// player and the AI, cutting into cornering rate — real tires lose grip
// long before they lose straight-line pace, so only turn rate is affected,
// never top speed or acceleration. No pit stops in this game, so wear is
// simply a function of total race distance covered (reaches full wear
// exactly at the finish, same curve for everyone).
const TIRE_WEAR_MAX_TURN_PENALTY = 0.22; // steering authority lost at full wear
function tireGripFactor(totalProgress) {
  const wear = Math.min(totalProgress / LAPS_PER_RACE, 1);
  return 1 - TIRE_WEAR_MAX_TURN_PENALTY * wear;
}

// Collisions: running wide costs grip (grass), hitting the wall costs most
// of your speed, and cars bumping each other lose speed and get pushed
// apart rather than overlapping. All tuned for arcade feel, not real physics.
const GRASS_LIMIT = TRACK_WIDTH / 2; // asphalt edge, right where the kerb is painted
// Real curbs are meant to be driven over — riding one, or running a bit wide
// onto the grass past it, should only cost grip, never trigger the wall
// bounce below. At 1.5 units this margin was thin enough that clipping a
// kerb at speed (much easier now that top speed is ~2x what it was) would
// often overshoot straight into the wall in a single frame, which read as
// bouncing off the kerb itself. Widened to a real runoff area — checked
// against all three circuits' tightest corners (see the offline validation
// script) so opposing sides of a corner never get close enough for their
// off-track zones to overlap.
const WALL_LIMIT = TRACK_WIDTH / 2 + 4;
const GRASS_MAX_DECEL = 65; // units/s^2 of extra drag at the wall edge
const WALL_BOUNCE_SPEED_FACTOR = 0.25; // speed kept after hitting a wall
const CAR_RADIUS = 1.0; // rough footprint for car-vs-car contact
const CAR_BUMP_SPEED_FACTOR = 0.7; // speed kept by both cars on contact

// Collision damage: a hard wall impact costs some top speed for the rest
// of the race (front wing / suspension knock) — same rule for the player
// and every AI car. A gentle graze under the threshold leaves no mark, and
// total damage is capped well short of crippling, so a couple of offs hurt
// your pace without ending the race.
const DAMAGE_MIN_IMPACT_SPEED = 20; // wall hits below this speed leave no mark
const DAMAGE_PER_IMPACT_SPEED = 0.0015; // max-speed fraction lost per unit of speed above the threshold
const DAMAGE_MAX_SPEED_PENALTY = 0.25; // hard cap: never lose more than this

// Track limits (player only — AI already steers within bounds): running
// wide costs grip on the spot via the grass drag above, but real stewards
// also add a time penalty for repeatedly abusing the runoff. Each distinct
// excursion past the kerb counts once (entering-grass edge, not every
// frame spent there); more than a few in one lap adds a fixed penalty to
// that lap's recorded time, so it never beats a clean one on the board.
const TRACK_LIMIT_WARNING_THRESHOLD = 3; // excursions allowed before it costs time
const TRACK_LIMIT_PENALTY_MS = 1000;

// --- Track centerline sampling -------------------------------------------

const CENTERLINE_SAMPLES = 360;
const centerline = [];
for (let i = 0; i < CENTERLINE_SAMPLES; i++) {
  const p = trackCurve.getPointAt(i / CENTERLINE_SAMPLES);
  const tan = trackCurve.getTangentAt(i / CENTERLINE_SAMPLES);
  centerline.push({ x: p.x, z: p.z, tx: tan.x, tz: tan.z });
}

// --- Minimap geometry ------------------------------------------------------
// The track never moves, so the world-to-minimap mapping (scale + offset
// to fit the circuit's bounding box into the canvas, preserving its aspect
// ratio) is worked out once here rather than every frame.
const MINIMAP_CANVAS_SIZE = 130;
const MINIMAP_PADDING = 10;
let minimapScale = 1;
let minimapOffsetX = 0;
let minimapOffsetZ = 0;
{
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of centerline) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  const innerSize = MINIMAP_CANVAS_SIZE - MINIMAP_PADDING * 2;
  minimapScale = innerSize / Math.max(spanX, spanZ);
  minimapOffsetX = MINIMAP_PADDING + (innerSize - spanX * minimapScale) / 2 - minX * minimapScale;
  minimapOffsetZ = MINIMAP_PADDING + (innerSize - spanZ * minimapScale) / 2 - minZ * minimapScale;
}
function minimapPoint(x, z) {
  return { x: x * minimapScale + minimapOffsetX, y: z * minimapScale + minimapOffsetZ };
}
const minimapTrackPoints = centerline.map((p) => minimapPoint(p.x, p.z));

function headingOf(p) {
  return Math.atan2(p.tx, p.tz);
}

// Unit vector perpendicular to the direction of travel at a track point.
function sideNormal(p) {
  return { x: p.tz, z: -p.tx };
}

// Nearest centerline sample to (x, z): its index (for progress/lookahead),
// its own coordinates, and the straight-line distance to it (used as a
// stand-in for lateral offset from the track for the boundary collision).
function nearestTrackInfo(x, z) {
  let bestIdx = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < centerline.length; i++) {
    const p = centerline[i];
    const dx = p.x - x;
    const dz = p.z - z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIdx = i;
    }
  }
  const p = centerline[bestIdx];
  return { idx: bestIdx, x: p.x, z: p.z, dist: Math.sqrt(bestDistSq) };
}

// Updates a car's fair, start-offset-independent progress accumulator (see
// the comment by `state` below for why raw track-progress isn't enough) and
// returns true the frame a lap just ticked over.
function advanceProgress(car, rawProgress) {
  let delta = rawProgress - car.prevRawProgress;
  if (delta < -0.5) delta += 1; // wrapped forward past 1 -> 0
  else if (delta > 0.5) delta -= 1; // wrapped backward past 0 -> 1
  car.prevRawProgress = rawProgress;
  car.totalProgress += delta;

  const newLap = Math.floor(car.totalProgress);
  if (newLap > car.lap) {
    car.lap = newLap;
    return true;
  }
  return false;
}

// --- Scene setup -----------------------------------------------------------

const scene = new THREE.Scene();
const skyColor = isRaining ? 0x1b232c : 0x05060a;
scene.background = new THREE.Color(skyColor);
scene.fog = new THREE.Fog(skyColor, isRaining ? 90 : 150, isRaining ? 260 : 420);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById("app").appendChild(renderer.domElement);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Lights
scene.add(new THREE.HemisphereLight(0x8899bb, 0x0a0a10, isRaining ? 0.7 : 1.1));
const sun = new THREE.DirectionalLight(0xffffff, isRaining ? 0.7 : 1.2);
sun.position.set(80, 120, 40);
scene.add(sun);

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1400, 1400),
  new THREE.MeshStandardMaterial({ color: 0x0c3d1a, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Road surface: triangle strip built from left/right edges of the centerline
function buildRoadMesh() {
  const positions = [];
  const indices = [];
  const halfWidth = TRACK_WIDTH / 2;

  for (let i = 0; i <= centerline.length; i++) {
    const p = centerline[i % centerline.length];
    const n = sideNormal(p);
    positions.push(p.x + n.x * halfWidth, 0.01, p.z + n.z * halfWidth);
    positions.push(p.x - n.x * halfWidth, 0.01, p.z - n.z * halfWidth);
  }

  for (let i = 0; i < centerline.length; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x2b2e36,
    roughness: 0.9,
  });
  return new THREE.Mesh(geometry, material);
}
scene.add(buildRoadMesh());

// Kerbs ("cordoli"): the red-and-white painted strip along the edge of the
// tarmac on a real circuit — flat, part of the road surface, not a wall.
// The previous version here was a row of standing red boxes (0.8 units
// tall, sparsely spaced) that read as a barrier/wall rather than a curb.
// This paints a low, near-continuous alternating stripe right at the
// asphalt edge instead — the actual off-track boundary (grass drag, then
// the invisible wall) still sits further out, unchanged; this is purely
// the visual marker real curbs are.
function buildKerbs() {
  const group = new THREE.Group();
  const halfWidth = TRACK_WIDTH / 2; // right at the tarmac edge
  const redMat = new THREE.MeshStandardMaterial({ color: 0xcc1f1f, roughness: 0.75 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.75 });
  const step = 3;
  const segmentLength = (trackCurve.getLength() / centerline.length) * step * 1.08; // slight overlap so bands read as continuous, not gapped

  for (let i = 0; i < centerline.length; i += step) {
    const p = centerline[i];
    const n = sideNormal(p);
    const heading = headingOf(p);
    const material = Math.floor(i / step) % 2 === 0 ? redMat : whiteMat;

    for (const side of [1, -1]) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.05, segmentLength),
        material
      );
      box.position.set(
        p.x + n.x * halfWidth * side,
        0.015,
        p.z + n.z * halfWidth * side
      );
      box.rotation.y = heading;
      group.add(box);
    }
  }
  return group;
}
scene.add(buildKerbs());

// Start/finish line: a group so the flattening rotation (local X) and the
// heading rotation (group Y) don't get tangled up in Euler order.
{
  const p = centerline[0];
  const lineGroup = new THREE.Group();
  lineGroup.position.set(p.x, 0.02, p.z);
  lineGroup.rotation.y = headingOf(p);

  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_WIDTH, 2),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  line.rotation.x = -Math.PI / 2;
  lineGroup.add(line);
  scene.add(lineGroup);
}

// Paints a numbered grid box on the tarmac at a starting slot — what
// actually makes a grid a *grid* rather than just "three cars parked in a
// row": each position is its own marked, numbered spot on the track.
function buildGridNumberTexture(number) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 10;
  ctx.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "bold 130px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(number), canvas.width / 2, canvas.height / 2 + 6);
  return new THREE.CanvasTexture(canvas);
}

function addGridBoxMarking(slot, number) {
  const group = new THREE.Group();
  group.position.set(slot.x, 0.03, slot.z);
  group.rotation.y = slot.heading;

  const material = new THREE.MeshBasicMaterial({
    map: buildGridNumberTexture(number),
    transparent: true,
    depthWrite: false,
  });
  const box = new THREE.Mesh(new THREE.PlaneGeometry(3, 6), material);
  box.rotation.x = -Math.PI / 2;
  group.add(box);
  scene.add(group);
}

// Narrows the +Z half of a box geometry's X extent, turning it into a
// wedge that tapers toward the front (local +Z is "front" throughout).
function taperFront(geometry, frontScale) {
  const pos = geometry.attributes.position;
  let maxZ = 0;
  for (let i = 0; i < pos.count; i++) maxZ = Math.max(maxZ, pos.getZ(i));
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z > 0) {
      const t = z / maxZ;
      pos.setX(i, pos.getX(i) * (1 - t * (1 - frontScale)));
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// Stylised open-wheel race car (own silhouette, not a licensed vehicle):
// tapered tub, nose cone, front/rear wings, side pods, four rolling wheels.
// Local +Z is "front" throughout, matching the heading convention above.
function buildCar(paintColor) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color: paintColor,
    roughness: 0.35,
    metalness: 0.15,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xcfcfcf,
    roughness: 0.3,
    metalness: 0.7,
  });

  const tub = new THREE.Mesh(
    taperFront(new THREE.BoxGeometry(1.7, 0.5, 3, 4, 1, 4), 0.45),
    paint
  );
  tub.position.y = 0.42;
  group.add(tub);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 8), paint);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.38, 2.0);
  group.add(nose);

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.32, 0.9), dark);
  cockpit.position.set(0, 0.78, 0.1);
  group.add(cockpit);

  for (const side of [1, -1]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.32, 1.3), paint);
    pod.position.set(0.68 * side, 0.4, -0.4);
    group.add(pod);
  }

  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.06, 0.4), accent);
  frontWing.position.set(0, 0.2, 2.35);
  group.add(frontWing);

  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.45), dark);
  rearWing.position.set(0, 0.95, -1.55);
  group.add(rearWing);
  for (const side of [1, -1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), dark);
    strut.position.set(0.65 * side, 0.72, -1.55);
    group.add(strut);
  }

  const wheelRadius = 0.4;
  const wheelPositions = [
    [0.82, wheelRadius, 1.05],
    [-0.82, wheelRadius, 1.05],
    [0.82, wheelRadius, -1.05],
    [-0.82, wheelRadius, -1.05],
  ];
  const wheels = wheelPositions.map(([x, y, z]) => {
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.3, 16),
      tireMat
    );
    tire.rotation.z = Math.PI / 2;
    wheel.add(tire);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.32, 10),
      rimMat
    );
    rim.rotation.z = Math.PI / 2;
    wheel.add(rim);
    wheel.position.set(x, y, z);
    group.add(wheel);
    return wheel;
  });

  group.scale.setScalar(CAR_SCALE);
  return { group, wheels, wheelRadius: wheelRadius * CAR_SCALE };
}

// Player car
const playerCar = buildCar(0xe10600);
scene.add(playerCar.group);

// Nine AI rivals in five colour pairs (teammates share a livery, like real
// F1 teams) plus the player makes a full ten-car grid. Colors matched to
// their championship driver ids in championship.js. All ten cars line up on
// a real starting grid behind the start/finish line instead of being
// scattered partway around the track already at speed — see
// startCountdown() for the 3-2-1.
const AI_DRIVERS = [
  { id: "rival-red", color: 0xe10600 }, // player's teammate
  { id: "rival-blue", color: 0x1c5fd6 },
  { id: "rival-blue-2", color: 0x1c5fd6 },
  { id: "rival-yellow", color: 0xe6c229 },
  { id: "rival-yellow-2", color: 0xe6c229 },
  { id: "rival-green-1", color: 0x1f9d4a },
  { id: "rival-green-2", color: 0x1f9d4a },
  { id: "rival-white-1", color: 0xf5f5f5 },
  { id: "rival-white-2", color: 0xf5f5f5 },
];

// --- DRS ---------------------------------------------------------------
//
// A short zone near the start/finish straight: a car within roughly one
// second of the car directly ahead gets a temporary top-speed boost while
// in the zone — the rubber-banding real DRS gives on a pit straight,
// simplified to no separate detection point and no manual button (this
// game has no extra input to spare for one).
const DRS_ZONE_FRACTION = 0.1; // first 10% of the lap, right after the line
const DRS_GAP_SECONDS = 1.0;
const DRS_SPEED_MULTIPLIER = 1.15;

// Sets car.drsActive for this frame on every car in `cars` (player state
// object + aiCars), based on each one's gap — in seconds, estimated from
// its own current speed — to whoever is directly ahead of it on track.
// Uses each car's totalProgress from the end of the previous frame, which
// is what's available before this frame has moved anyone yet.
function updateDrsEligibility(cars) {
  const order = [...cars].sort((a, b) => b.totalProgress - a.totalProgress);
  for (let i = 0; i < order.length; i++) {
    const car = order[i];
    const lapFraction = car.totalProgress - Math.floor(car.totalProgress);
    if (i === 0 || lapFraction >= DRS_ZONE_FRACTION) {
      car.drsActive = false;
      continue;
    }
    const ahead = order[i - 1];
    const gapMeters = (ahead.totalProgress - car.totalProgress) * TRACK_LENGTH;
    const gapSeconds = gapMeters / Math.max(Math.abs(car.speed), 1);
    car.drsActive = gapSeconds < DRS_GAP_SECONDS;
  }
}

const GRID_ROW_GAP = 5; // meters behind the previous row
const GRID_LANE_OFFSET = Math.min(TRACK_WIDTH / 4, 3.2); // stay clear of grass
const TRACK_LENGTH = trackCurve.getLength();
const GRID_ROW_SAMPLES = Math.max(
  1,
  Math.round((GRID_ROW_GAP / TRACK_LENGTH) * centerline.length)
);

// Places a grid slot by walking backward along the actual centerline from
// the start/finish line, not offsetting in one fixed direction — a couple
// of these circuits have the line sitting just before a bend, and a
// straight-line offset there cut across the grass instead of following the
// road. Each slot also takes its own heading from the curve at that point.
function gridSlot(row, lane) {
  const idx =
    (((-row * GRID_ROW_SAMPLES) % centerline.length) + centerline.length) %
    centerline.length;
  const p = centerline[idx];
  const lateral = sideNormal(p);
  return {
    x: p.x + lateral.x * GRID_LANE_OFFSET * lane,
    z: p.z + lateral.z * GRID_LANE_OFFSET * lane,
    heading: headingOf(p),
  };
}

// A real F1 grid is paired, not single-file: two cars side by side per row,
// each row staggered back from the one in front, sides alternating (odd
// positions on one side, even on the other) — not a zig-zag of one car
// per row. Each colour pair shares a row, so teammates start side by side,
// just like the player's own row-0 teammate.
const AI_GRID_SLOTS = [
  { row: 0, lane: 1 }, // P2, red teammate, alongside pole
  { row: 1, lane: -1 }, // P3
  { row: 1, lane: 1 }, // P4, blue teammate
  { row: 2, lane: -1 }, // P5
  { row: 2, lane: 1 }, // P6, yellow teammate
  { row: 3, lane: -1 }, // P7
  { row: 3, lane: 1 }, // P8, green teammate
  { row: 4, lane: -1 }, // P9
  { row: 4, lane: 1 }, // P10, white teammate
];
const aiCars = AI_DRIVERS.map((driver, i) => {
  const model = buildCar(driver.color);
  scene.add(model.group);
  const slot = AI_GRID_SLOTS[i];
  const pos = gridSlot(slot.row, slot.lane);
  const info = nearestTrackInfo(pos.x, pos.z);
  return {
    ...model,
    driverId: driver.id,
    color: driver.color,
    x: pos.x,
    z: pos.z,
    heading: pos.heading,
    speed: 0,
    prevRawProgress: info.idx / centerline.length,
    totalProgress: 0,
    lap: 0,
    damage: 0,
    drsActive: false,
  };
});

// --- State -------------------------------------------------------------

// --- Ghost lap ---------------------------------------------------------
// A translucent replay of the player's own best lap on this circuit,
// persisted in localStorage so it's already there next time this circuit
// loads (mirrors the "race your own best lap" ghost in modern F1 games).
const GHOST_STORAGE_KEY = "f1racer-ghost-v1";
const GHOST_SAMPLE_INTERVAL_MS = 100;

function loadGhost(circuitId) {
  try {
    const raw = localStorage.getItem(GHOST_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : null;
    return all && all[circuitId] ? all[circuitId] : null;
  } catch (e) {
    return null; // corrupt or inaccessible localStorage: just start without a ghost
  }
}

function saveGhost(circuitId, ghost) {
  try {
    const raw = localStorage.getItem(GHOST_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[circuitId] = ghost;
    localStorage.setItem(GHOST_STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    // Private browsing / storage disabled: the ghost won't persist across
    // reloads, which is a reasonable degradation.
  }
}

let ghostLap = loadGhost(circuit.id); // { lapTimeMs, samples: [{t, x, z, heading}] } | null
let currentLapSamples = [];
let lastGhostSampleT = -Infinity;

const ghostCar = buildCar(0xffffff);
ghostCar.group.visible = false;
ghostCar.group.traverse((obj) => {
  if (obj.isMesh) {
    obj.material.transparent = true;
    obj.material.opacity = 0.35;
    obj.material.depthWrite = false;
  }
});
scene.add(ghostCar.group);

// Race position/lap counting uses `totalProgress`, a monotonic "laps
// travelled since the start" accumulator, rather than each car's raw
// track-progress fraction. Raw progress depends on where a car started
// (the AI cars begin partway around the track to stagger them visually),
// so comparing raw fractions directly would unfairly credit whoever
// started closer to the line. Accumulating deltas since each car's own
// start makes lap count and race position fair regardless of start offset.
const start = gridSlot(0, -1); // pole position, left side of the front row
const state = {
  x: start.x,
  z: start.z,
  heading: start.heading,
  speed: 0,
  lap: 0,
  lapStartTime: performance.now(),
  currentLapTime: 0,
  bestLapTime: null,
  prevRawProgress: 0,
  totalProgress: 0,
  damage: 0,
  drsActive: false,
  wasOffTrack: false,
  trackLimitViolationsThisLap: 0,
  lastLapPenaltyMs: 0,
};

addGridBoxMarking(start, 1);
aiCars.forEach((car, i) => addGridBoxMarking(car, i + 2));

// "countdown" (grid, frozen, waiting for the 3-2-1) -> "racing" -> "finished"
let raceState = "countdown";

const input = { forward: false, back: false, left: false, right: false };
const KEY_MAP = {
  ArrowUp: "forward",
  KeyW: "forward",
  ArrowDown: "back",
  KeyS: "back",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};

window.addEventListener("keydown", (e) => {
  const action = KEY_MAP[e.code];
  if (action) input[action] = true;
});
window.addEventListener("keyup", (e) => {
  const action = KEY_MAP[e.code];
  if (action) input[action] = false;
});

// Camera mode: chase (default, third-person) or cockpit (first-person, from
// the driver's seat). The player's own car model is hidden in cockpit mode
// — you're sitting inside it, so it would otherwise sit in front of the view
// blocking most of the track.
let cameraMode = "chase";
window.addEventListener("keydown", (e) => {
  if (e.code !== "KeyC") return;
  cameraMode = cameraMode === "chase" ? "cockpit" : "chase";
  playerCar.group.visible = cameraMode !== "cockpit";
});

// Touch controls (buttons are hidden on non-touch devices via CSS, but the
// bindings are harmless either way).
function bindHoldButton(id, action) {
  const el = document.getElementById(id);
  if (!el) return;
  const press = (e) => {
    e.preventDefault();
    input[action] = true;
  };
  const release = (e) => {
    e.preventDefault();
    input[action] = false;
  };
  el.addEventListener("pointerdown", press);
  el.addEventListener("pointerup", release);
  el.addEventListener("pointerleave", release);
  el.addEventListener("pointercancel", release);
}
bindHoldButton("btn-gas", "forward");
bindHoldButton("btn-brake", "back");

// The wheel is one continuous drag surface, not two independent buttons:
// a finger pressed on the left half and dragged to the right half (without
// lifting) needs to switch from steering left to steering right. Two plain
// buttons can't do that — a touch is implicitly captured by whichever
// element it started on, so sliding across never reaches the sibling's own
// pointerdown. Tracking pointermove on one element with setPointerCapture
// sidesteps that entirely.
// Analog, not on/off: how far the drag sits from the wheel's centre sets
// how hard you're turning (-1 full left .. 1 full right). A binary "which
// half is the finger on" meant every touch was a full-lock turn, which at
// speed was enough to run off track from a single light tap.
let touchSteer = 0;

const wheelEl = document.getElementById("wheel-control");
if (wheelEl) {
  let activePointerId = null;

  const steerFromEvent = (e) => {
    const rect = wheelEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const raw = (e.clientX - centerX) / (rect.width / 2);
    touchSteer = Math.max(-1, Math.min(1, raw));
  };

  wheelEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    activePointerId = e.pointerId;
    wheelEl.setPointerCapture(e.pointerId);
    steerFromEvent(e);
  });
  wheelEl.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activePointerId) return;
    steerFromEvent(e);
  });
  const releaseWheel = (e) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    touchSteer = 0;
  };
  wheelEl.addEventListener("pointerup", releaseWheel);
  wheelEl.addEventListener("pointercancel", releaseWheel);
}

// --- Gears -------------------------------------------------------------
//
// Eight forward gears (typical of a modern F1 car), mapped onto the 0..1
// fraction of top speed at which each one tops out — not evenly spaced,
// since a real gearbox's lower gears cover much less ground than its
// higher ones. There's no manual shifting; the gear is purely a function
// of current speed.
const GEAR_THRESHOLDS = [0.09, 0.19, 0.31, 0.45, 0.6, 0.75, 0.89, 1.0];

// Which gear a fraction of top speed falls in, plus how far through that
// gear's own speed band the car sits (0..1, resets to 0 on every shift).
// That second number is what makes the engine note and shift lights climb
// through a gear and drop back down at the next shift, instead of just
// tracking raw speed in a straight line.
function gearInfo(speedRatio) {
  const ratio = Math.min(Math.max(speedRatio, 0), 1);
  let gear = GEAR_THRESHOLDS.length;
  for (let g = 0; g < GEAR_THRESHOLDS.length; g++) {
    if (ratio <= GEAR_THRESHOLDS[g]) {
      gear = g + 1;
      break;
    }
  }
  const lower = gear === 1 ? 0 : GEAR_THRESHOLDS[gear - 2];
  const upper = GEAR_THRESHOLDS[gear - 1];
  const rpmRatio = upper > lower ? (ratio - lower) / (upper - lower) : 1;
  return { gear, rpmRatio: Math.min(Math.max(rpmRatio, 0), 1) };
}

// --- Engine sound ----------------------------------------------------------
//
// Synthesised, not a sample — this site has no audio assets and no build
// step to fetch/bundle one. Two detuned oscillators (a low sawtooth for
// body, a square an octave-and-a-half up for grit) through a lowpass filter
// whose cutoff opens up with revs, roughly like an engine's tone
// brightening as it climbs through a gear — see gearInfo() above for why
// that's gear-relative "revs" and not just raw speed. Browsers block audio
// before any user gesture, so the AudioContext is only created lazily on
// the first key/touch input.

let audioCtx = null;
let engineGain = null;
let engineFilter = null;
let engineOsc1 = null;
let engineOsc2 = null;

function initEngineSound() {
  if (audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return; // no Web Audio support: fail silent, not fatal
  audioCtx = new Ctx();

  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0;

  engineFilter = audioCtx.createBiquadFilter();
  engineFilter.type = "lowpass";
  engineFilter.frequency.value = 300;

  engineOsc1 = audioCtx.createOscillator();
  engineOsc1.type = "sawtooth";
  engineOsc1.frequency.value = 45;

  engineOsc2 = audioCtx.createOscillator();
  engineOsc2.type = "square";
  engineOsc2.frequency.value = 45 * 1.5;
  const osc2Gain = audioCtx.createGain();
  osc2Gain.gain.value = 0.25;

  engineOsc1.connect(engineFilter);
  engineOsc2.connect(osc2Gain).connect(engineFilter);
  engineFilter.connect(engineGain).connect(audioCtx.destination);

  engineOsc1.start();
  engineOsc2.start();
}

// speedRatio (0..1 of top speed) drives volume, which should keep rising
// with real speed; rpmRatio (0..1, resets each gear — see gearInfo()) drives
// pitch and filter brightness, which should climb through a gear and drop
// at the next shift, the way an engine actually sounds. Silent during the
// grid countdown (raceState isn't "racing" yet) so the note only kicks in
// once the lights go out.
function updateEngineSound(speedRatio, rpmRatio) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const baseFreq = 55 + rpmRatio * 190;
  engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.04);
  engineOsc2.frequency.setTargetAtTime(baseFreq * 1.5, now, 0.04);
  engineFilter.frequency.setTargetAtTime(320 + rpmRatio * 2400, now, 0.04);
  const targetGain = raceState === "racing" ? 0.05 + speedRatio * 0.09 : 0;
  engineGain.gain.setTargetAtTime(targetGain, now, 0.08);
}

// A short percussive "thunk" layered over the continuous engine tone, fired
// once per gear change (see updateHud). The pitch drop in the engine note
// already implies a shift; a discrete click sells it as one.
function playShiftClick() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(80, now + 0.05);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.16, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.08);
}

window.addEventListener("keydown", initEngineSound, { once: true });
window.addEventListener("pointerdown", initEngineSound, { once: true });

// --- HUD -----------------------------------------------------------------

const circuitNameEl = document.getElementById("circuit-name");
const positionEl = document.getElementById("position");
const lapEl = document.getElementById("lap");
const timeEl = document.getElementById("time");
const bestEl = document.getElementById("best");
const damageRowEl = document.getElementById("damage-row");
const damageEl = document.getElementById("damage");
const tireWearEl = document.getElementById("tire-wear");
const speedValueEl = document.getElementById("speed-value");
const speedFillEl = document.getElementById("speed-fill");
const gearValueEl = document.getElementById("gear-value");
const drsIndicatorEl = document.getElementById("drs-indicator");
const shiftLedEls = Array.from(document.querySelectorAll(".shift-led"));
const penaltyNoticeEl = document.getElementById("penalty-notice");
const minimapCtx = document.getElementById("minimap").getContext("2d");
const GAUGE_MAX_KMH = 300; // bar reads full at a realistic F1 top speed
let lastGearLabel = null;
let gearFlashTimeout = null;
let penaltyNoticeTimeout = null;

circuitNameEl.textContent = isRaining ? `${circuit.name} · 🌧️ Pioggia` : circuit.name;

const KMH_PER_UNIT = 3.6; // treat CAR.maxSpeed's units as m/s for display

function formatTime(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}

// One-shot toast for a track-limits penalty, fired from the lap-completion
// check in update() (not every updateHud() call) so it flashes once per
// penalized lap instead of staying lit for the whole next one.
function showPenaltyNotice(penaltyMs) {
  penaltyNoticeEl.textContent = `Track limits — +${(penaltyMs / 1000).toFixed(1)}s`;
  clearTimeout(penaltyNoticeTimeout);
  penaltyNoticeEl.classList.add("visible");
  penaltyNoticeTimeout = setTimeout(() => penaltyNoticeEl.classList.remove("visible"), 2500);
}

// Redraws the top-down circuit trace and every car's live dot. The track
// outline itself never changes, so only its points are precomputed; the
// dots are the only thing recomputed each call.
function drawMinimap() {
  const ctx = minimapCtx;
  ctx.clearRect(0, 0, MINIMAP_CANVAS_SIZE, MINIMAP_CANVAS_SIZE);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  minimapTrackPoints.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.stroke();

  const drawDot = (x, z, fillStyle, radius) => {
    const p = minimapPoint(x, z);
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  };

  for (const car of aiCars) {
    drawDot(car.x, car.z, `#${car.color.toString(16).padStart(6, "0")}`, 2.5);
  }
  // Drawn last (and outlined) so the player's own dot never gets buried
  // under an AI one when they're close together on track.
  const playerPoint = minimapPoint(state.x, state.z);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(playerPoint.x, playerPoint.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Ranks all three cars by race progress (see `advanceProgress`), most
// distance travelled first. Used for both the live HUD position and the
// final classification when the race ends.
function currentRaceOrder() {
  return [
    { driverId: "player", totalProgress: state.totalProgress },
    ...aiCars.map((c) => ({ driverId: c.driverId, totalProgress: c.totalProgress })),
  ].sort((a, b) => b.totalProgress - a.totalProgress);
}

function updateHud() {
  const order = currentRaceOrder();
  const position = order.findIndex((o) => o.driverId === "player") + 1;
  positionEl.textContent = `P${position}`;
  lapEl.textContent = `Giro ${Math.min(state.lap + 1, LAPS_PER_RACE)}/${LAPS_PER_RACE}`;
  timeEl.textContent = formatTime(state.currentLapTime);
  bestEl.textContent = state.bestLapTime
    ? `Migliore ${formatTime(state.bestLapTime)}`
    : "Migliore --:--.--";
  tireWearEl.textContent = `Gomme ${Math.round(tireGripFactor(state.totalProgress) * 100)}%`;
  damageRowEl.hidden = state.damage <= 0;
  damageEl.textContent = `Danni ${Math.round(state.damage * 100)}%`;
  const speedKmh = Math.abs(state.speed) * KMH_PER_UNIT;
  speedValueEl.textContent = Math.round(speedKmh);

  const gaugeRatio = Math.min(speedKmh / GAUGE_MAX_KMH, 1);
  speedFillEl.style.width = `${gaugeRatio * 100}%`;

  drsIndicatorEl.classList.toggle("drs-active", state.drsActive);

  const { gear, rpmRatio } = gearInfo(Math.abs(state.speed) / CAR.maxSpeed);
  const gearLabel = Math.abs(state.speed) < 0.6 ? "N" : state.speed < 0 ? "R" : String(gear);
  if (gearLabel !== lastGearLabel) {
    gearValueEl.textContent = gearLabel;
    if (lastGearLabel !== null) {
      // Restart the CSS flash animation even if it's still mid-run from a
      // rapid-fire shift, and give the audio "thunk" its visual half.
      clearTimeout(gearFlashTimeout);
      gearValueEl.classList.remove("gear-shift");
      void gearValueEl.offsetWidth;
      gearValueEl.classList.add("gear-shift");
      gearFlashTimeout = setTimeout(() => gearValueEl.classList.remove("gear-shift"), 220);
      playShiftClick();
    }
    lastGearLabel = gearLabel;
  }

  // Shift lights sweep through each gear and reset at the next one, green
  // -> red, like a rev limiter — tied to rpmRatio (gear-relative), not
  // overall speed, so they visibly reset on every shift.
  const litCount = Math.round(rpmRatio * shiftLedEls.length);
  shiftLedEls.forEach((led, i) => led.classList.toggle("is-lit", i < litCount));

  updateEngineSound(Math.abs(state.speed) / CAR.maxSpeed, rpmRatio);
  drawMinimap();
}

// --- Main loop -------------------------------------------------------------

const clock = new THREE.Clock();

function applyToMesh(model, x, z, heading, speed, dt) {
  model.group.position.set(x, 0, z);
  model.group.rotation.y = heading;
  const spin = (speed * dt) / model.wheelRadius;
  for (const wheel of model.wheels) wheel.rotation.x -= spin;
}

// Keeps a car (player or AI) on the track: grass beyond the asphalt bleeds
// speed off faster (lost grip), and the wall beyond that stops it hard and
// pushes it back in-bounds, instead of letting it drive through scenery.
function applyTrackBoundary(car, dt, info) {
  info = info || nearestTrackInfo(car.x, car.z);
  if (info.dist > WALL_LIMIT) {
    const impactSpeed = Math.abs(car.speed);
    if (impactSpeed > DAMAGE_MIN_IMPACT_SPEED) {
      const extra = (impactSpeed - DAMAGE_MIN_IMPACT_SPEED) * DAMAGE_PER_IMPACT_SPEED;
      car.damage = Math.min(DAMAGE_MAX_SPEED_PENALTY, car.damage + extra);
    }
    const inv = info.dist > 0 ? 1 / info.dist : 0;
    const nx = (car.x - info.x) * inv;
    const nz = (car.z - info.z) * inv;
    // Pull back inside the limit with a little clearance, not pinned
    // exactly on it — sitting exactly at the boundary re-triggers this
    // every single frame, which used to keep the car permanently glued
    // to the wall at near-zero speed even while still accelerating.
    car.x = info.x + nx * (WALL_LIMIT - 0.3);
    car.z = info.z + nz * (WALL_LIMIT - 0.3);
    car.speed *= WALL_BOUNCE_SPEED_FACTOR;
    // Turn the car back toward the track instead of leaving it aimed at
    // the wall — otherwise holding the throttle just drives it straight
    // back into the same spot next frame.
    const inward = Math.atan2(-nx, -nz);
    let diff = inward - car.heading;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    car.heading += diff * 0.6;
  } else if (info.dist > GRASS_LIMIT) {
    const t = (info.dist - GRASS_LIMIT) / (WALL_LIMIT - GRASS_LIMIT);
    const decel = GRASS_MAX_DECEL * t * dt;
    if (car.speed > 0) car.speed = Math.max(0, car.speed - decel);
    else if (car.speed < 0) car.speed = Math.min(0, car.speed + decel);
  }
  return info;
}

// Cheap circle-vs-circle bump: push overlapping cars apart and dock both
// some speed, so contact costs you something instead of cars overlapping.
function resolveCarCollisions(cars) {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dz) || 0.0001;
      const minDist = CAR_RADIUS * 2;
      if (dist < minDist) {
        const overlap = minDist - dist;
        const nx = dx / dist;
        const nz = dz / dist;
        a.x -= nx * overlap * 0.5;
        a.z -= nz * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.z += nz * overlap * 0.5;
        a.speed *= CAR_BUMP_SPEED_FACTOR;
        b.speed *= CAR_BUMP_SPEED_FACTOR;
      }
    }
  }
}

// AI steering had no idea other cars existed — it always aimed straight at
// the centerline, so with ten cars on the grid, any two side by side would
// both steer back onto the same line and stay locked together, re-colliding
// every frame instead of the one push-apart nudge resolving it. This adds a
// lateral-only nudge (along the track's own side-normal, not back toward or
// away along it) away from anything within AI_AVOID_RADIUS, so cars settle
// into their own line instead of fighting over one.
const AI_AVOID_RADIUS = 4.5;
const AI_AVOID_STRENGTH = 10;

function updateAiCar(car, dt, allCars) {
  const info = nearestTrackInfo(car.x, car.z);
  const target = centerline[(info.idx + AI.lookahead) % centerline.length];

  const lateral = sideNormal(centerline[info.idx]);
  let avoidPush = 0;
  for (const other of allCars) {
    if (other === car) continue;
    const dx = car.x - other.x;
    const dz = car.z - other.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.001 && dist < AI_AVOID_RADIUS) {
      const closeness = (AI_AVOID_RADIUS - dist) / AI_AVOID_RADIUS;
      const side = dx * lateral.x + dz * lateral.z;
      if (side !== 0) avoidPush += Math.sign(side) * closeness;
    }
  }
  const aimX = target.x + lateral.x * avoidPush * AI_AVOID_STRENGTH;
  const aimZ = target.z + lateral.z * avoidPush * AI_AVOID_STRENGTH;

  const toTarget = Math.atan2(aimX - car.x, aimZ - car.z);
  let err = toTarget - car.heading;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;

  const aiMaxSpeed =
    AI.maxSpeed * (1 - car.damage) * (car.drsActive ? DRS_SPEED_MULTIPLIER : 1);
  car.speed = Math.min(aiMaxSpeed, car.speed + AI.accel * dt);
  const rate =
    AI.turnRate *
    (0.35 + 0.65 * Math.min(car.speed / AI.maxSpeed, 1)) *
    tireGripFactor(car.totalProgress);
  if (err > 0.02) car.heading += rate * dt;
  if (err < -0.02) car.heading -= rate * dt;

  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  const afterInfo = applyTrackBoundary(car, dt);
  advanceProgress(car, afterInfo.idx / centerline.length);
}

function driverName(driverId) {
  const driver = DRIVERS.find((d) => d.id === driverId);
  return driver ? driver.name : driverId;
}

function finishRace() {
  raceState = "finished";
  const order = currentRaceOrder().map((o) => o.driverId);
  const state2 = recordRaceResult(circuit.id, order);

  const position = order.indexOf("player") + 1;
  const points = POINTS_BY_POSITION[position - 1] || 0;

  document.getElementById("results-title").textContent =
    position === 1 ? "Vittoria!" : `Arrivato ${position}°`;
  document.getElementById("results-order").innerHTML = order
    .map((driverId, i) => {
      const isPlayer = driverId === "player";
      return `<li class="${isPlayer ? "is-player" : ""}"><span>${i + 1}. ${driverName(
        driverId
      )}</span></li>`;
    })
    .join("");
  document.getElementById("results-points").textContent = `+${points} punti`;

  const nextCircuitId = getNextUnracedCircuitId(state2);
  const nextLink = document.getElementById("results-next");
  if (nextCircuitId) {
    nextLink.href = `race.html?circuit=${nextCircuitId}`;
    nextLink.textContent = "Prossimo circuito";
  } else {
    nextLink.href = "index.html";
    nextLink.textContent = "Vedi classifica finale";
  }

  document.getElementById("results-overlay").hidden = false;
}

function getNextUnracedCircuitId(champState) {
  const raced = new Set(Object.keys(champState.raceResults));
  const next = CIRCUITS.find((c) => !raced.has(c.id));
  return next ? next.id : null;
}

// Chase camera math, shared by the countdown grid shot and the race loop.
function updateChaseCamera(dt) {
  const camDistance = 9;
  const camHeight = 4.5;
  const desiredX = state.x - Math.sin(state.heading) * camDistance;
  const desiredZ = state.z - Math.cos(state.heading) * camDistance;
  camera.position.lerp(
    new THREE.Vector3(desiredX, camHeight, desiredZ),
    1 - Math.pow(0.001, dt)
  );
  const lookTarget = new THREE.Vector3(
    state.x + Math.sin(state.heading) * 4,
    1,
    state.z + Math.cos(state.heading) * 4
  );
  camera.lookAt(lookTarget);
}

// Cockpit view: rigidly attached to the car (no lerp/lag, unlike the chase
// cam above — you're bolted into the seat), roughly at driver eye height
// and nudged slightly forward of the car's own origin.
function updateCockpitCamera() {
  const eyeHeight = 1.0;
  const forwardOffset = 0.3;
  camera.position.set(
    state.x + Math.sin(state.heading) * forwardOffset,
    eyeHeight,
    state.z + Math.cos(state.heading) * forwardOffset
  );
  const lookTarget = new THREE.Vector3(
    state.x + Math.sin(state.heading) * 20,
    eyeHeight - 0.1,
    state.z + Math.cos(state.heading) * 20
  );
  camera.lookAt(lookTarget);
}

function updateCamera(dt) {
  if (cameraMode === "cockpit") updateCockpitCamera();
  else updateChaseCamera(dt);
}

function update(dt) {
  if (raceState === "finished") return;

  if (raceState === "countdown") {
    // Cars sit frozen on the grid until the lights go out.
    applyToMesh(playerCar, state.x, state.z, state.heading, 0, dt);
    for (const car of aiCars) applyToMesh(car, car.x, car.z, car.heading, 0, dt);
    updateCamera(dt);
    updateHud();
    return;
  }

  updateDrsEligibility([state, ...aiCars]);

  // Longitudinal control
  if (input.forward) {
    state.speed += CAR.accel * dt;
  } else if (input.back) {
    state.speed -= CAR.brakeDecel * dt;
  } else {
    const decel = CAR.coastDecel * dt;
    if (state.speed > 0) state.speed = Math.max(0, state.speed - decel);
    else if (state.speed < 0) state.speed = Math.min(0, state.speed + decel);
  }
  const playerMaxSpeed =
    CAR.maxSpeed * (1 - state.damage) * (state.drsActive ? DRS_SPEED_MULTIPLIER : 1);
  state.speed = Math.max(
    CAR.reverseMaxSpeed,
    Math.min(playerMaxSpeed, state.speed)
  );

  // Steering (disabled when nearly stationary; direction flips in reverse).
  // Turn authority tapers off with speed — real cars don't snap-turn flat
  // out, and without that a single quick tap at top speed was enough to
  // run off track. Touch input is analog (touchSteer); keyboard is digital,
  // full deflection either way.
  const speedFactor = Math.min(Math.abs(state.speed) / CAR.maxSpeed, 1);
  const turnRate =
    CAR.maxTurnRate * (1 - 0.55 * speedFactor) * tireGripFactor(state.totalProgress);
  const steerSign = state.speed >= 0 ? 1 : -1;
  const keyboardSteer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const steerAmount = touchSteer !== 0 ? touchSteer : keyboardSteer;
  if (Math.abs(state.speed) > 0.05 && steerAmount !== 0) {
    // steerAmount is positive for "right" (right arrow, or a drag to the
    // right half of the wheel) — heading decreases for a right turn, which
    // got flipped by mistake when the wheel became analog. That's what
    // made the car turn opposite to the input.
    state.heading -= turnRate * dt * steerSign * steerAmount;
  }

  // Integrate position (matches the heading convention used by the track)
  state.x += Math.sin(state.heading) * state.speed * dt;
  state.z += Math.cos(state.heading) * state.speed * dt;

  const info = nearestTrackInfo(state.x, state.z);
  applyTrackBoundary(state, dt, info);

  // One violation per excursion (the moment it crosses out, not every
  // frame spent off), so lightly touching the runoff for a full second
  // doesn't rack up dozens of "offences" on its own.
  const isOffTrack = info.dist > GRASS_LIMIT;
  if (isOffTrack && !state.wasOffTrack) state.trackLimitViolationsThisLap++;
  state.wasOffTrack = isOffTrack;

  const allCars = [state, ...aiCars];
  for (const car of aiCars) updateAiCar(car, dt, allCars);
  resolveCarCollisions(allCars);

  applyToMesh(playerCar, state.x, state.z, state.heading, state.speed, dt);
  for (const car of aiCars) applyToMesh(car, car.x, car.z, car.heading, car.speed, dt);

  // Lap timing (current/best lap) uses the same fair progress accumulator
  // that drives race position, so it lines up with the lap count shown.
  const justCompletedLap = advanceProgress(state, info.idx / centerline.length);
  const now = performance.now();
  if (justCompletedLap) {
    const penaltyMs =
      state.trackLimitViolationsThisLap > TRACK_LIMIT_WARNING_THRESHOLD
        ? TRACK_LIMIT_PENALTY_MS
        : 0;
    const lapTime = now - state.lapStartTime + penaltyMs;
    if (state.bestLapTime === null || lapTime < state.bestLapTime) {
      state.bestLapTime = lapTime;
      // Only a lap that just beat the record becomes the new ghost — the
      // buffer being flushed here is the lap that just ended, sampled as
      // it happened (see below), not a lap replayed after the fact.
      if (currentLapSamples.length > 1) {
        ghostLap = { lapTimeMs: lapTime, samples: currentLapSamples };
        saveGhost(circuit.id, ghostLap);
      }
    }
    state.lastLapPenaltyMs = penaltyMs;
    state.trackLimitViolationsThisLap = 0;
    state.lapStartTime = now;
    if (penaltyMs > 0) showPenaltyNotice(penaltyMs);
    currentLapSamples = [];
    lastGhostSampleT = -Infinity;
  }
  state.currentLapTime = now - state.lapStartTime;

  if (state.currentLapTime - lastGhostSampleT >= GHOST_SAMPLE_INTERVAL_MS) {
    currentLapSamples.push({ t: state.currentLapTime, x: state.x, z: state.z, heading: state.heading });
    lastGhostSampleT = state.currentLapTime;
  }

  // Ghost playback: replay the best-lap samples on a loop keyed to the
  // current lap's own clock, so the ghost always shows where that lap was
  // at this same moment in time.
  if (ghostLap && ghostLap.samples.length > 1) {
    const samples = ghostLap.samples;
    const t = state.currentLapTime % ghostLap.lapTimeMs;
    let i = 0;
    while (i < samples.length - 1 && samples[i + 1].t < t) i++;
    const a = samples[i];
    const b = samples[Math.min(i + 1, samples.length - 1)];
    const span = b.t - a.t || 1;
    const frac = Math.min(Math.max((t - a.t) / span, 0), 1);
    const gx = a.x + (b.x - a.x) * frac;
    const gz = a.z + (b.z - a.z) * frac;
    let dh = b.heading - a.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const gheading = a.heading + dh * frac;
    applyToMesh(ghostCar, gx, gz, gheading, 0, dt);
    ghostCar.group.visible = true;
  } else {
    ghostCar.group.visible = false;
  }

  if (raceState === "racing" && state.totalProgress >= LAPS_PER_RACE) {
    finishRace();
  }

  updateCamera(dt);

  // Widening the FOV with speed is a cheap, common trick for a felt sense
  // of acceleration — the world seems to rush past faster at the edges.
  const speedFov = Math.min(Math.abs(state.speed) / CAR.maxSpeed, 1);
  const targetFov = 58 + speedFov * 12;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();

  updateHud();
}

// Real standing start: cars sit on the grid (see AI_GRID_SLOTS above) while
// this counts down, then everyone is free to move at once. state.lapStartTime
// is reset to the moment the lights go out, not construction time, so the
// on-screen lap clock doesn't start ticking during the countdown itself.
function startCountdown() {
  const el = document.getElementById("countdown-overlay");
  const steps = ["3", "2", "1", "VIA!"];
  let i = 0;
  function tick() {
    if (!el) return;
    el.textContent = steps[i];
    el.hidden = false;
    i++;
    if (i < steps.length) {
      setTimeout(tick, 900);
    } else {
      setTimeout(() => {
        el.hidden = true;
        state.lapStartTime = performance.now();
        raceState = "racing";
      }, 600);
    }
  }
  tick();
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

startCountdown();
animate();
