import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CIRCUITS, getCircuit, LAPS_PER_RACE } from "./circuits.js";
import { DRIVERS, recordRaceResult } from "./championship.js";

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

const trackCurve = new THREE.CatmullRomCurve3(CONTROL_POINTS, true, "catmullrom", 0.5);

const CAR = {
  maxSpeed: 45,
  reverseMaxSpeed: -15,
  accel: 25,
  brakeDecel: 40,
  coastDecel: 15,
  maxTurnRate: 2.0, // rad/s ceiling; actual rate is scaled down further by
  // speed in update() below — a single quick tap used to be enough to spin
  // off track at top speed, so turn authority now drops off as you speed up
  // instead of maxing out there.
};
const CAR_SCALE = 0.55;

const AI = {
  maxSpeed: 38,
  accel: 22,
  turnRate: 2.1,
  lookahead: 10, // centerline samples ahead to steer toward
};

// Collisions: running wide costs grip (grass), hitting the wall costs most
// of your speed, and cars bumping each other lose speed and get pushed
// apart rather than overlapping. All tuned for arcade feel, not real physics.
const GRASS_LIMIT = TRACK_WIDTH / 2; // asphalt edge
const WALL_LIMIT = TRACK_WIDTH / 2 + 1.5; // just inside the barrier line
const GRASS_MAX_DECEL = 35; // units/s^2 of extra drag at the wall edge
const WALL_BOUNCE_SPEED_FACTOR = 0.25; // speed kept after hitting a wall
const CAR_RADIUS = 1.0; // rough footprint for car-vs-car contact
const CAR_BUMP_SPEED_FACTOR = 0.7; // speed kept by both cars on contact

// --- Track centerline sampling -------------------------------------------

const CENTERLINE_SAMPLES = 360;
const centerline = [];
for (let i = 0; i < CENTERLINE_SAMPLES; i++) {
  const p = trackCurve.getPointAt(i / CENTERLINE_SAMPLES);
  const tan = trackCurve.getTangentAt(i / CENTERLINE_SAMPLES);
  centerline.push({ x: p.x, z: p.z, tx: tan.x, tz: tan.z });
}

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
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.Fog(0x05060a, 150, 420);

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
scene.add(new THREE.HemisphereLight(0x8899bb, 0x0a0a10, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
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

// Barriers along both edges (visual only, no collision in v1)
function buildBarriers() {
  const group = new THREE.Group();
  const halfWidth = TRACK_WIDTH / 2 + 0.6;
  const barrierMaterial = new THREE.MeshStandardMaterial({ color: 0xdd2222 });
  const step = 6;

  for (let i = 0; i < centerline.length; i += step) {
    const p = centerline[i];
    const n = sideNormal(p);
    const heading = headingOf(p);

    for (const side of [1, -1]) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.8, 2.4),
        barrierMaterial
      );
      box.position.set(
        p.x + n.x * halfWidth * side,
        0.4,
        p.z + n.z * halfWidth * side
      );
      box.rotation.y = heading;
      group.add(box);
    }
  }
  return group;
}
scene.add(buildBarriers());

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

// Two AI rivals, colors matched to their championship driver ids. All three
// cars now line up on a real starting grid behind the start/finish line
// (staggered left/right like an F1 grid) instead of being scattered partway
// around the track already at speed — see startCountdown() for the 3-2-1.
const AI_DRIVERS = [
  { id: "rival-blue", color: 0x1c5fd6 },
  { id: "rival-yellow", color: 0xe6c229 },
];

const gridStart = centerline[0];
const gridHeading = headingOf(gridStart);
const gridBack = { x: -Math.sin(gridHeading), z: -Math.cos(gridHeading) };
const gridLateral = sideNormal(gridStart);
const GRID_ROW_GAP = 5; // meters behind the previous row
const GRID_LANE_OFFSET = Math.min(TRACK_WIDTH / 4, 3.2); // stay clear of grass

function gridSlot(row, lane) {
  return {
    x: gridStart.x + gridBack.x * GRID_ROW_GAP * row + gridLateral.x * GRID_LANE_OFFSET * lane,
    z: gridStart.z + gridBack.z * GRID_ROW_GAP * row + gridLateral.z * GRID_LANE_OFFSET * lane,
  };
}

// A real F1 grid is paired, not single-file: two cars side by side per row,
// each row staggered back from the one in front, sides alternating (odd
// positions on one side, even on the other) — not a zig-zag of one car
// per row.
const AI_GRID_SLOTS = [
  { row: 0, lane: 1 }, // P2, alongside pole, opposite side
  { row: 1, lane: -1 }, // P3, one row back, same side as pole
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
    x: pos.x,
    z: pos.z,
    heading: gridHeading,
    speed: 0,
    prevRawProgress: info.idx / centerline.length,
    totalProgress: 0,
    lap: 0,
  };
});

// --- State -------------------------------------------------------------

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
  heading: gridHeading,
  speed: 0,
  lap: 0,
  lapStartTime: performance.now(),
  currentLapTime: 0,
  bestLapTime: null,
  prevRawProgress: 0,
  totalProgress: 0,
};

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

// --- HUD -----------------------------------------------------------------

const circuitNameEl = document.getElementById("circuit-name");
const positionEl = document.getElementById("position");
const lapEl = document.getElementById("lap");
const timeEl = document.getElementById("time");
const bestEl = document.getElementById("best");
const speedValueEl = document.getElementById("speed-value");
const gaugeFillEl = document.getElementById("gauge-fill");
const gaugeNeedleEl = document.getElementById("gauge-needle-group");
const shiftLedEls = Array.from(document.querySelectorAll(".shift-led"));
const GAUGE_ARC_LENGTH = Math.PI * 90; // matches the SVG arc's radius (90)
const GAUGE_MAX_KMH = 180; // matches the dial's printed 0/60/120/180 labels
gaugeFillEl.style.strokeDasharray = `${GAUGE_ARC_LENGTH}`;

circuitNameEl.textContent = circuit.name;

const KMH_PER_UNIT = 3.6; // treat CAR.maxSpeed's units as m/s for display

function formatTime(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
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
  const speedKmh = Math.abs(state.speed) * KMH_PER_UNIT;
  speedValueEl.textContent = Math.round(speedKmh);

  const gaugeRatio = Math.min(speedKmh / GAUGE_MAX_KMH, 1);
  gaugeFillEl.style.strokeDashoffset = `${GAUGE_ARC_LENGTH * (1 - gaugeRatio)}`;
  gaugeNeedleEl.setAttribute(
    "transform",
    `translate(100,100) rotate(${-90 + gaugeRatio * 180})`
  );

  // Shift lights: an F1-wheel touch, lighting up left to right with speed
  // rather than RPM (this car has no gearbox to shift), green -> red.
  const litCount = Math.round(gaugeRatio * shiftLedEls.length);
  shiftLedEls.forEach((led, i) => led.classList.toggle("is-lit", i < litCount));
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

function updateAiCar(car, dt) {
  const info = nearestTrackInfo(car.x, car.z);
  const target = centerline[(info.idx + AI.lookahead) % centerline.length];
  const toTarget = Math.atan2(target.x - car.x, target.z - car.z);
  let err = toTarget - car.heading;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;

  car.speed = Math.min(AI.maxSpeed, car.speed + AI.accel * dt);
  const rate = AI.turnRate * (0.35 + 0.65 * Math.min(car.speed / AI.maxSpeed, 1));
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
  const points = [25, 18, 15][position - 1] || 0;

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

function update(dt) {
  if (raceState === "finished") return;

  if (raceState === "countdown") {
    // Cars sit frozen on the grid until the lights go out.
    applyToMesh(playerCar, state.x, state.z, state.heading, 0, dt);
    for (const car of aiCars) applyToMesh(car, car.x, car.z, car.heading, 0, dt);
    updateChaseCamera(dt);
    updateHud();
    return;
  }

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
  state.speed = Math.max(
    CAR.reverseMaxSpeed,
    Math.min(CAR.maxSpeed, state.speed)
  );

  // Steering (disabled when nearly stationary; direction flips in reverse).
  // Turn authority tapers off with speed — real cars don't snap-turn flat
  // out, and without that a single quick tap at top speed was enough to
  // run off track. Touch input is analog (touchSteer); keyboard is digital,
  // full deflection either way.
  const speedFactor = Math.min(Math.abs(state.speed) / CAR.maxSpeed, 1);
  const turnRate = CAR.maxTurnRate * (1 - 0.55 * speedFactor);
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
  for (const car of aiCars) updateAiCar(car, dt);
  resolveCarCollisions([state, ...aiCars]);

  applyToMesh(playerCar, state.x, state.z, state.heading, state.speed, dt);
  for (const car of aiCars) applyToMesh(car, car.x, car.z, car.heading, car.speed, dt);

  // Lap timing (current/best lap) uses the same fair progress accumulator
  // that drives race position, so it lines up with the lap count shown.
  const justCompletedLap = advanceProgress(state, info.idx / centerline.length);
  const now = performance.now();
  if (justCompletedLap) {
    const lapTime = now - state.lapStartTime;
    if (state.bestLapTime === null || lapTime < state.bestLapTime) {
      state.bestLapTime = lapTime;
    }
    state.lapStartTime = now;
  }
  state.currentLapTime = now - state.lapStartTime;

  if (raceState === "racing" && state.totalProgress >= LAPS_PER_RACE) {
    finishRace();
  }

  updateChaseCamera(dt);

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
