import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CIRCUITS, getCircuit, LAPS_PER_RACE } from "./circuits.js";
import { DRIVERS, POINTS_BY_POSITION, recordRaceResult } from "./championship.js";
import { setupEffects } from "./garage-setup.js";

import { buildCar as buildCarModel, createStudioEnvironment } from "./car-model.js";

const GARAGE_EFFECTS = setupEffects();

/*
 * F1 Racer — championship mode: a fixed-lap race against two AI rivals on
 * one of several circuits, feeding into a persisted points standings (see
 * championship.js / menu.js). Procedural car/track geometry;
 * no external model assets. Track is a closed Catmull-Rom spline through
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
  maxSpeed: 84 * (1 + GARAGE_EFFECTS.speed * 0.006) * (isRaining ? RAIN_MAX_SPEED_MULTIPLIER : 1),
  reverseMaxSpeed: -28,
  accel: 47 * (1 + GARAGE_EFFECTS.traction * 0.006),
  brakeDecel: 75 * (1 + GARAGE_EFFECTS.braking * 0.018),
  coastDecel: 28,
  maxTurnRate: 2.0 * (1 + GARAGE_EFFECTS.downforce * 0.012) * (isRaining ? RAIN_TURN_RATE_MULTIPLIER : 1), // rad/s ceiling; actual rate is scaled down further by
  // speed in update() below — a single quick tap used to be enough to spin
  // off track at top speed, so turn authority now drops off as you speed up
  // instead of maxing out there.
};
const CAR_SCALE = 0.55;
const PLAYER_VISUAL_SCALE = 1.25;

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
  lookahead: 10, // base centerline samples ahead to steer toward
  cornerLookahead: 22, // samples used to preview upcoming bends
  brakeDecel: 68,
};

// Tire wear: grip degrades gradually over the race distance, for both the
// player and the AI, cutting into cornering rate — real tires lose grip
// long before they lose straight-line pace, so only turn rate is affected,
// never top speed or acceleration. No pit stops in this game, so wear is
// simply a function of total race distance covered (reaches full wear
// exactly at the finish, same curve for everyone).
const TIRE_WEAR_MAX_TURN_PENALTY = 0.22; // steering authority lost at full wear

// Lightweight race compounds. The race remains browser-friendly, but tyre
// choice now changes initial grip and the rate at which grip is lost.
const TYRE_COMPOUNDS = {
  soft: { label: "SOFT", grip: 1.06, wearRate: 1.35 },
  medium: { label: "MED", grip: 1.0, wearRate: 1.0 },
  hard: { label: "HARD", grip: 0.95, wearRate: 0.75 },
};
const TYRE_ORDER = ["soft", "medium", "hard"];
const ERS_SPEED_MULTIPLIER = 1.05;
const ERS_DRAIN_PER_SECOND = 24;
const ERS_RECHARGE_PER_SECOND = 7;
const PIT_ZONE_START = 0.94;
const PIT_ZONE_END = 0.06;
const PIT_SPEED_LIMIT = 18;
const PIT_SERVICE_MS = 2200;

function tireGripFactor(totalProgress, car = null) {
  const tyre = TYRE_COMPOUNDS[car?.tyreCompound] || TYRE_COMPOUNDS.medium;
  const distance = car?.tyreProgress ?? totalProgress;
  const wear = Math.min(Math.max(distance / LAPS_PER_RACE, 0), 1);
  const wetGrip = isRaining ? 0.82 : 1;
  return tyre.grip * (1 - TIRE_WEAR_MAX_TURN_PENALTY * wear * tyre.wearRate) * wetGrip;
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
const WALL_LIMIT = TRACK_WIDTH / 2 + 4; // legacy distance used for runoff drag ramp; no invisible hard stop
// Ramped from zero at the grass edge up to this at the wall, 65 (barely
// above coastDecel) never shed enough speed over a typical excursion at
// top speed to avoid still slamming the wall at near-full pace — the
// runoff read as decorative rather than as grass. Raised well past
// brakeDecel and front-loaded (see the 0.45 floor below) so running wide
// costs real speed immediately, not just right before the wall.
const GRASS_MAX_DECEL = 240 * (1 - GARAGE_EFFECTS.runoff * 0.035); // units/s^2 of extra drag in the runoff
const WALL_BOUNCE_SPEED_FACTOR = 0.25; // speed kept after hitting a wall
const CAR_RADIUS = 1.0; // rough footprint for car-vs-car contact
const CAR_BUMP_SPEED_FACTOR = 0.7; // speed kept by both cars on contact

// Safety car: a real multi-car pile-up (several distinct cars hitting a
// wall in a short window — not just routine jostling, which happens
// constantly and involves at most two) triggers a caution period. Nobody
// gets an actual pace car to follow (that's a lot of extra machinery for
// an arcade game); everyone's pace is simply capped for a while instead,
// same rule for player and AI.
const INCIDENT_WINDOW_MS = 2500; // wall hits within this window count together
const INCIDENT_CAR_THRESHOLD = 3; // distinct cars hitting a wall = a real incident
const CAUTION_DURATION_MS = 12000;
const CAUTION_COOLDOWN_MS = 10000; // minimum gap before another can trigger
const CAUTION_SPEED_FACTOR = 0.45;

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
  const previousRaw = car.prevRawProgress;
  // A lap only counts after the car has visited the opposite half of the
  // circuit and then crossed start/finish in the forward direction. This
  // prevents progress spikes, spins around the line or collision pushes from
  // producing an early race verdict.
  if (rawProgress > 0.42 && rawProgress < 0.58) car.lapCheckpointPassed = true;
  const crossedFinishForward = previousRaw > 0.82 && rawProgress < 0.18;
  if (crossedFinishForward && car.lapCheckpointPassed) {
    car.completedLaps = (car.completedLaps || 0) + 1;
    car.lapCheckpointPassed = false;
  }
  let delta = rawProgress - previousRaw;
  if (delta < -0.5) delta += 1; // wrapped forward past 1 -> 0
  else if (delta > 0.5) delta -= 1; // wrapped backward past 0 -> 1
  car.prevRawProgress = rawProgress;
  car.totalProgress += delta;
  car.tyreProgress = Math.max(0, (car.tyreProgress || 0) + delta);

  const newLap = Math.floor(car.totalProgress);
  if (newLap > car.lap) {
    car.lap = newLap;
    return true;
  }
  return false;
}

// --- Scene setup -----------------------------------------------------------

const scene = new THREE.Scene();

// Sky: a gradient dome (vertex-colored, no texture/shader needed) instead of
// a flat background color, which read as an unfinished void behind an
// otherwise daylit green ground and track. A real 3D dome — unlike setting
// scene.background to a flat 2D texture — properly turns with the camera as
// the car corners instead of the sky sticking to the screen.
const SKY_HORIZON = isRaining ? 0xaab0b8 : 0xbfe0f5;
const SKY_ZENITH = isRaining ? 0x6b7480 : 0x1e5fc0;
scene.background = new THREE.Color(SKY_HORIZON);
scene.fog = new THREE.Fog(SKY_HORIZON, isRaining ? 90 : 150, isRaining ? 260 : 420);

{
  const skyGeometry = new THREE.SphereGeometry(700, 24, 16);
  const skyPos = skyGeometry.attributes.position;
  const skyColors = new Float32Array(skyPos.count * 3);
  const zenith = new THREE.Color(SKY_ZENITH);
  const horizon = new THREE.Color(SKY_HORIZON);
  const blended = new THREE.Color();
  for (let i = 0; i < skyPos.count; i++) {
    // Blend only above the horizon line (y=0) — below it the dome is behind
    // the ground/fog anyway, so there's no point spending gradient range on
    // sky colors that never show.
    const t = THREE.MathUtils.clamp(skyPos.getY(i) / 700, 0, 1);
    blended.copy(horizon).lerp(zenith, Math.pow(t, 0.6));
    skyColors[i * 3] = blended.r;
    skyColors[i * 3 + 1] = blended.g;
    skyColors[i * 3 + 2] = blended.b;
  }
  skyGeometry.setAttribute("color", new THREE.BufferAttribute(skyColors, 3));
  const sky = new THREE.Mesh(
    skyGeometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    })
  );
  scene.add(sky);
}

// A handful of soft cloud billboards scattered around the circuit, high up
// and always facing the camera (THREE.Sprite) — cheap compared to a real
// volumetric or textured skybox, and enough to read as "sky" rather than
// an empty dome. Excluded from fog (like the dome itself) so they don't
// fade into invisibility at the distance they're placed.
function buildCloudTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  // A few overlapping soft puffs instead of one perfect circle, so it
  // reads as an irregular cloud rather than a flat glowing disc.
  const puffs = [
    [0.5, 0.55, 0.42],
    [0.3, 0.52, 0.3],
    [0.7, 0.52, 0.3],
    [0.5, 0.34, 0.3],
  ];
  for (const [cx, cy, r] of puffs) {
    const grad = ctx.createRadialGradient(cx * size, cy * size, 0, cx * size, cy * size, r * size);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx * size, cy * size, r * size, 0, Math.PI * 2);
    ctx.fill();
  }
  return new THREE.CanvasTexture(canvas);
}

const cloudGroup = new THREE.Group();
{
  const cloudTexture = buildCloudTexture();
  const cloudTint = isRaining ? 0x9aa3ad : 0xffffff;
  const cloudCount = isRaining ? 14 : 8;
  const cloudOpacity = isRaining ? 0.6 : 0.8;
  for (let i = 0; i < cloudCount; i++) {
    const cloud = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: cloudTexture,
        color: cloudTint,
        transparent: true,
        opacity: cloudOpacity,
        depthWrite: false,
        fog: false,
      })
    );
    const angle = (i / cloudCount) * Math.PI * 2 + Math.random() * 0.4;
    const radius = 260 + Math.random() * 220;
    const scale = 70 + Math.random() * 90;
    cloud.scale.set(scale, scale * 0.55, 1);
    cloud.position.set(
      Math.cos(angle) * radius,
      (isRaining ? 65 : 110) + Math.random() * 60,
      Math.sin(angle) * radius
    );
    cloudGroup.add(cloud);
  }
  scene.add(cloudGroup);
}

// --- Weather / impact effects ---------------------------------------------
// Rain is a lightweight world-space particle field, kept deliberately small
// so the game remains comfortable on mobile GPUs. Particles are recycled
// around the player instead of allocating new objects every frame.
const rainCount = isRaining ? 850 : 0;
let rainPoints = null;
let rainPositions = null;
if (isRaining) {
  rainPositions = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    rainPositions[i * 3] = (Math.random() - 0.5) * 90;
    rainPositions[i * 3 + 1] = 8 + Math.random() * 65;
    rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 90;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xbfd8ef,
    size: 0.09,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  rainPoints = new THREE.Points(geometry, material);
  scene.add(rainPoints);
}

const impactSparks = [];

function spawnImpactSparks(x, z) {
  for (let i = 0; i < 7; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 5, 5),
      new THREE.MeshBasicMaterial({
        color: 0xffd166,
        transparent: true,
        opacity: 0.95,
      })
    );
    mesh.position.set(x, 0.45 + Math.random() * 0.35, z);
    scene.add(mesh);
    impactSparks.push({
      mesh,
      vx: (Math.random() - 0.5) * 5,
      vy: 1.5 + Math.random() * 3.5,
      vz: (Math.random() - 0.5) * 5,
      life: 0.22 + Math.random() * 0.22,
    });
  }
}

function updateImpactSparks(dt) {
  for (let i = impactSparks.length - 1; i >= 0; i--) {
    const spark = impactSparks[i];
    spark.life -= dt;
    spark.vy -= 9 * dt;
    spark.mesh.position.x += spark.vx * dt;
    spark.mesh.position.y += spark.vy * dt;
    spark.mesh.position.z += spark.vz * dt;
    spark.mesh.material.opacity = Math.max(0, spark.life * 4);
    if (spark.life <= 0) {
      scene.remove(spark.mesh);
      spark.mesh.geometry.dispose();
      spark.mesh.material.dispose();
      impactSparks.splice(i, 1);
    }
  }
}

function updateRain(dt) {
  if (!rainPoints || !rainPositions) return;
  const px = state.x;
  const pz = state.z;
  for (let i = 0; i < rainCount; i++) {
    const j = i * 3;
    rainPositions[j] += 4 * dt;
    rainPositions[j + 1] -= 58 * dt;
    rainPositions[j + 2] += 7 * dt;
    const dx = rainPositions[j] - px;
    const dz = rainPositions[j + 2] - pz;
    if (rainPositions[j + 1] < 0 || dx * dx + dz * dz > 70 * 70) {
      rainPositions[j] = px + (Math.random() - 0.5) * 90;
      rainPositions[j + 1] = 38 + Math.random() * 55;
      rainPositions[j + 2] = pz + (Math.random() - 0.5) * 90;
    }
  }
  rainPoints.geometry.attributes.position.needsUpdate = true;
}

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const carEnvironment = createStudioEnvironment(renderer);
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
  const heading = headingOf(p);
  // Grid boxes (see addGridBoxMarking below) are 6 units long, centered on
  // this same point for row 0 — drawing the line here too cut pole and P2's
  // boxes in half instead of sitting ahead of them like a real line does.
  // Shifted forward past the box's own front edge (half its length, +3)
  // plus a clear gap so the line reads as its own separate marking.
  const LINE_OFFSET = 5;
  const lineGroup = new THREE.Group();
  lineGroup.position.set(
    p.x + Math.sin(heading) * LINE_OFFSET,
    0.02,
    p.z + Math.cos(heading) * LINE_OFFSET
  );
  lineGroup.rotation.y = heading;

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
  const w = canvas.width;
  const h = canvas.height;

  // A faint fill instead of just an outline on transparent — real grid
  // boxes are painted panels, not wireframes.
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(9, 9, w - 18, h - 18);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 10;
  ctx.strokeRect(9, 9, w - 18, h - 18);

  // Checkered strip along the front edge — the edge the car's nose points
  // toward, which the plane's rotation (see addGridBoxMarking) puts at the
  // BOTTOM of this canvas, not the top: canvas-top ends up behind the car
  // instead, which is where an earlier version of this wrongly drew it.
  const checkRows = 2;
  const checkCols = 6;
  const checkH = 16;
  const cellW = (w - 18) / checkCols;
  for (let row = 0; row < checkRows; row++) {
    for (let col = 0; col < checkCols; col++) {
      const isDark = (row + col) % 2 === 0;
      ctx.fillStyle = isDark ? "rgba(20,20,24,0.9)" : "rgba(255,255,255,0.9)";
      ctx.fillRect(9 + col * cellW, h - 9 - (row + 1) * checkH, cellW, checkH);
    }
  }

  // Number badge: a filled roundel behind the digit reads as an actual
  // marking at a glance, rather than plain outlined text floating on the
  // panel.
  const badgeY = h / 2 + 10;
  const badgeR = 58;
  ctx.beginPath();
  ctx.arc(w / 2, badgeY, badgeR, 0, Math.PI * 2);
  ctx.fillStyle = number === 1 ? "rgba(225,6,0,0.85)" : "rgba(255,255,255,0.16)";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "bold 96px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Rotate the digit 180° so it reads toward the start/finish direction.
  ctx.save();
  ctx.translate(w / 2, badgeY + 4);
  ctx.rotate(Math.PI);
  ctx.fillText(String(number), 0, 0);
  ctx.restore();
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

// Shared visual model; race physics and collision dimensions remain independent.
function buildCar(color) {
  const model = buildCarModel(color, { scale: CAR_SCALE });
  model.group.traverse(o => { if (o.isMesh) { o.material.envMap = carEnvironment.texture; o.material.envMapIntensity = .65; } });
  return model;
}

// Player car
const playerCar = buildCar(0xe10600);
// Make the player's car easier to read in chase view without changing the
// shared car geometry, wheel metadata, physics or collision dimensions.
playerCar.group.scale.multiplyScalar(PLAYER_VISUAL_SCALE);
scene.add(playerCar.group);

// Nine AI rivals in five colour pairs (teammates share a livery, like real
// F1 teams) plus the player makes a full ten-car grid. Colors matched to
// their championship driver ids in championship.js. All ten cars line up on
// a real starting grid behind the start/finish line instead of being
// scattered partway around the track already at speed — see
// startRaceCountdown() for the 3-2-1. Grid order itself comes from
// qualifying (see finishQualifying()), not this fixed identity order.
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

// A real F1 grid is single-file, not paired: each position steps back from
// the one before it and alternates side, so P1/P3/P5/... form one diagonal
// line and P2/P4/P6/... form the other — not two cars sharing a row before
// the next pair steps back. (An earlier version of this paired them up
// instead, which doesn't match what a real F1 grid looks like.)
const AI_GRID_SLOTS = [
  { row: 1, lane: 1 }, // P2
  { row: 2, lane: -1 }, // P3
  { row: 3, lane: 1 }, // P4
  { row: 4, lane: -1 }, // P5
  { row: 5, lane: 1 }, // P6
  { row: 6, lane: -1 }, // P7
  { row: 7, lane: 1 }, // P8
  { row: 8, lane: -1 }, // P9
  { row: 9, lane: 1 }, // P10
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
    tyreCompound: "medium",
    tyreProgress: 0,
    ersCharge: 100,
    ersActive: false,
    pitState: "none",
    pitServiceEndTime: 0,
    hasPitted: false,
    lastImpactEffectTime: 0,
  };
});

// All 10 physical grid slots, pole first — used to place whoever ends up
// in each position once qualifying (below) decides the order. The visual
// grid-box markings further down are painted at these same fixed slots
// regardless of who ends up there, so they don't need this list themselves.
const ALL_GRID_SLOTS = [{ row: 0, lane: -1 }, ...AI_GRID_SLOTS];

// The AI only appears once the grid order is set (see finishQualifying) —
// during qualifying it's a solo flying lap, no traffic.
aiCars.forEach((car) => (car.group.visible = false));

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
  completedLaps: 0,
  lapCheckpointPassed: false,
  lapStartTime: performance.now(),
  currentLapTime: 0,
  bestLapTime: null,
  prevRawProgress: 0,
  totalProgress: 0,
  damage: 0,
  drsActive: false,
  tyreCompound: "medium",
  tyreProgress: 0,
  ersCharge: 100,
  ersActive: false,
  pitState: "none",
  pitServiceEndTime: 0,
  pitRequested: false,
  lastImpactEffectTime: 0,
  cameraShake: 0,
  // Physics extension: lateral velocity and yaw-rate make the car carry
  // momentum through corners instead of moving only along its heading.
  lateralSpeed: 0,
  yawRate: 0,
  wasOffTrack: false,
  trackLimitViolationsThisLap: 0,
  lastLapPenaltyMs: 0,
};

addGridBoxMarking(start, 1);
aiCars.forEach((car, i) => addGridBoxMarking(car, i + 2));

// "countdown" (grid, frozen, waiting for the 3-2-1) -> "racing" -> "finished"
let raceState = "countdown";

// A short solo qualifying session decides the grid order below, before the
// race itself begins — see startQualifyingCountdown()/finishQualifying().
// "qualifying" -> "race" (raceState then takes over exactly as before).
let sessionPhase = "qualifying";
let qualiState = "countdown"; // "countdown" -> "running"
const QUALIFYING_DURATION_MS = 60000;
let qualiTimeRemainingMs = QUALIFYING_DURATION_MS;
let qualiBestTime = null;

// "none" -> "active" (see INCIDENT_CAR_THRESHOLD above) -> "none" again
// once CAUTION_DURATION_MS elapses.
let cautionState = "none";
let cautionEndTime = 0;
let lastCautionEndTime = -Infinity;
let incidentLog = []; // { time, carId }

// Called on every hard wall impact (see applyTrackBoundary); tracks how
// many distinct cars have hit a wall recently and opens a caution period
// once that count looks like a real incident rather than one car running
// wide on its own. A no-op outside the actual race (qualifying is solo,
// and countdown/finished don't need caution handling either).
function logIncident(carId) {
  if (raceState !== "racing") return;
  const now = performance.now();
  incidentLog.push({ time: now, carId });
  incidentLog = incidentLog.filter((e) => now - e.time < INCIDENT_WINDOW_MS);
  const distinctCars = new Set(incidentLog.map((e) => e.carId));
  if (
    distinctCars.size >= INCIDENT_CAR_THRESHOLD &&
    cautionState === "none" &&
    now - lastCautionEndTime > CAUTION_COOLDOWN_MS
  ) {
    cautionState = "active";
    cautionEndTime = now + CAUTION_DURATION_MS;
    cautionBannerEl.hidden = false;
  }
}

function cautionSpeedMultiplier() {
  return cautionState === "active" ? CAUTION_SPEED_FACTOR : 1;
}

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

function setTyreCompound(name) {
  if (!TYRE_COMPOUNDS[name]) return;
  if (raceState === "racing" && state.pitState !== "servicing") return;
  state.tyreCompound = name;
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyE" && raceState === "racing" && state.pitState === "none") {
    state.ersActive = !state.ersActive;
  }
  if (e.code === "KeyP" && raceState === "racing") {
    state.pitRequested = true;
  }
  if (e.code === "Digit1") setTyreCompound("soft");
  if (e.code === "Digit2") setTyreCompound("medium");
  if (e.code === "Digit3") setTyreCompound("hard");
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
let engineOsc3 = null;
let engineHighpass = null;
let engineCompressor = null;

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
  engineOsc2.type = "triangle";
  engineOsc2.frequency.value = 45 * 2;
  const osc2Gain = audioCtx.createGain();
  osc2Gain.gain.value = 0.32;

  engineOsc3 = audioCtx.createOscillator();
  engineOsc3.type = "sawtooth";
  engineOsc3.frequency.value = 45 * 3;
  const osc3Gain = audioCtx.createGain();
  osc3Gain.gain.value = 0.1;

  engineHighpass = audioCtx.createBiquadFilter();
  engineHighpass.type = "highpass";
  engineHighpass.frequency.value = 70;
  engineCompressor = audioCtx.createDynamicsCompressor();
  engineCompressor.threshold.value = -18;
  engineCompressor.knee.value = 12;
  engineCompressor.ratio.value = 4;

  engineOsc1.connect(engineFilter);
  engineOsc2.connect(osc2Gain).connect(engineFilter);
  engineOsc3.connect(osc3Gain).connect(engineFilter);
  engineFilter.connect(engineHighpass).connect(engineGain).connect(engineCompressor).connect(audioCtx.destination);

  engineOsc1.start();
  engineOsc2.start();
  engineOsc3.start();
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
  const baseFreq = 70 + rpmRatio * 260;
  engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.025);
  engineOsc2.frequency.setTargetAtTime(baseFreq * 2.01, now, 0.025);
  engineOsc3.frequency.setTargetAtTime(baseFreq * 3.02, now, 0.025);
  engineFilter.frequency.setTargetAtTime(650 + rpmRatio * 4200 + speedRatio * 900, now, 0.035);
  engineHighpass.frequency.setTargetAtTime(65 + speedRatio * 70, now, 0.08);
  const targetGain = raceState === "racing" ? 0.045 + speedRatio * 0.11 : 0;
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
const cautionBannerEl = document.getElementById("caution-banner");
const damageRowEl = document.getElementById("damage-row");
const damageEl = document.getElementById("damage");
const tireWearEl = document.getElementById("tire-wear");
const speedValueEl = document.getElementById("speed-value");
const speedFillEl = document.getElementById("speed-fill");
const gearValueEl = document.getElementById("gear-value");
const drsIndicatorEl = document.getElementById("drs-indicator");
const ersIndicatorEl = document.getElementById("ers-indicator");
const tyreCompoundEl = document.getElementById("tyre-compound");
const slipValueEl = document.getElementById("slip-value");
const lateralValueEl = document.getElementById("lateral-value");
const shiftLedEls = Array.from(document.querySelectorAll(".shift-led"));
const hintEl = document.getElementById("hint");
const penaltyNoticeEl = document.getElementById("penalty-notice");
const minimapCtx = document.getElementById("minimap").getContext("2d");
const GAUGE_MAX_KMH = 300; // bar reads full at a realistic F1 top speed
let lastGearLabel = null;
let gearFlashTimeout = null;
let penaltyNoticeTimeout = null;

// Weather badge stays on the circuit name in every phase; the "Qualifica"
// suffix only applies until the race itself starts (see finishQualifying).
function circuitLabel() {
  return isRaining ? `${circuit.name} · 🌧️ Pioggia` : circuit.name;
}
const RACE_HINT_TEXT = hintEl.textContent;
circuitNameEl.textContent = `${circuitLabel()} · Qualifica`;
hintEl.textContent = "Giro di qualifica: fai il miglior tempo per partire davanti in griglia";

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

// Speed/gear/shift-lights/engine sound/tire-damage readouts: identical
// whether qualifying or racing (all derived from `state` alone, not race
// progress or the session timer), so both HUD update functions below
// share this instead of duplicating it.
function updateSpeedoHud() {
  const speedKmh = Math.abs(state.speed) * KMH_PER_UNIT;
  speedValueEl.textContent = Math.round(speedKmh);

  const gaugeRatio = Math.min(speedKmh / GAUGE_MAX_KMH, 1);
  speedFillEl.style.width = `${gaugeRatio * 100}%`;

  drsIndicatorEl.classList.toggle("drs-active", state.drsActive);
  const gripPercent = Math.round(tireGripFactor(state.totalProgress, state) * 100);
  if (ersIndicatorEl) {
    ersIndicatorEl.textContent = `ERS ${Math.round(state.ersCharge)}%`;
    ersIndicatorEl.classList.toggle("ers-active", state.ersActive);
  }
  if (tyreCompoundEl) {
    tyreCompoundEl.textContent = TYRE_COMPOUNDS[state.tyreCompound].label;
    tyreCompoundEl.dataset.compound = state.tyreCompound;
  }
  const lateralLimit = Math.max(Math.abs(state.speed) * 0.32, 1);
  const slipPercent = Math.round(
    Math.min(Math.abs(state.lateralSpeed) / lateralLimit, 1) * 100
  );
  tireWearEl.textContent = `Gomme ${gripPercent}%`;
  if (slipValueEl) slipValueEl.textContent = `${slipPercent}%`;
  if (lateralValueEl) lateralValueEl.textContent = `${Math.round(Math.abs(state.lateralSpeed) * KMH_PER_UNIT)} km/h`;
  damageRowEl.hidden = state.damage <= 0;
  damageEl.textContent = `Danni ${Math.round(state.damage * 100)}%`;

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

function updateHud() {
  const order = currentRaceOrder();
  const position = order.findIndex((o) => o.driverId === "player") + 1;
  positionEl.textContent = `P${position}`;
  lapEl.textContent = `Giro ${Math.min(state.lap + 1, LAPS_PER_RACE)}/${LAPS_PER_RACE}`;
  timeEl.textContent = formatTime(state.currentLapTime);
  bestEl.textContent = state.bestLapTime
    ? `Migliore ${formatTime(state.bestLapTime)}`
    : "Migliore --:--.--";
  updateSpeedoHud();
}

// Reuses the same stat readouts as the race HUD (position/lap/time/best),
// repurposed for the session timer and this lap's/best qualifying time —
// no separate markup needed for what is, visually, the same instrument
// cluster in a different mode.
function updateQualifyingHud() {
  positionEl.textContent = "Q";
  const remainingSeconds = Math.max(0, Math.ceil(qualiTimeRemainingMs / 1000));
  lapEl.textContent = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  timeEl.textContent = formatTime(state.currentLapTime);
  bestEl.textContent = qualiBestTime !== null
    ? `Migliore ${formatTime(qualiBestTime)}`
    : "Migliore --:--.--";
  updateSpeedoHud();
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
  if (info.dist > GRASS_LIMIT) {
    // Kerbs/runoff are traversable. Going wider progressively adds drag,
    // but never snaps the car back to an invisible boundary or kills all
    // momentum. Physical barrier meshes remain visual; a future barrier
    // collider can use explicit geometry rather than track-width distance.
    const runoffDepth = Math.max(0, info.dist - GRASS_LIMIT);
    const t = Math.min(runoffDepth / Math.max(WALL_LIMIT - GRASS_LIMIT, 0.01), 1);
    const decel = GRASS_MAX_DECEL * (0.28 + 0.72 * t) * dt;
    const crawlSpeed = 8;
    if (car.speed > crawlSpeed) car.speed = Math.max(crawlSpeed, car.speed - decel);
    else if (car.speed < -crawlSpeed) car.speed = Math.min(-crawlSpeed, car.speed + decel);
  }
  return info;
}

// Cheap circle-vs-circle bump: push overlapping cars apart and dock both
// some speed, so contact costs you something instead of cars overlapping.
function resolveCarCollisions(cars) {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const dist = Math.hypot(dx, dz) || 0.0001;
      const minDist = CAR_RADIUS * 2;
      if (dist >= minDist) continue;

      const nx = dx / dist, nz = dz / dist;
      const overlap = minDist - dist;
      // Positional correction has a tiny cushion so the same pair does not
      // remain interpenetrating and get "punched" apart again next frame.
      const correction = overlap * 0.52 + 0.025;
      a.x -= nx * correction; a.z -= nz * correction;
      b.x += nx * correction; b.z += nz * correction;

      // Resolve only closing velocity along the contact normal. Cars moving
      // together no longer both lose 30% speed just because their circles
      // touched; side-to-side rubbing is mild, nose-to-tail contact transfers
      // momentum progressively.
      const avx = Math.sin(a.heading) * a.speed;
      const avz = Math.cos(a.heading) * a.speed;
      const bvx = Math.sin(b.heading) * b.speed;
      const bvz = Math.cos(b.heading) * b.speed;
      const closing = (avx - bvx) * nx + (avz - bvz) * nz;
      if (closing > 0) {
        const impulse = closing * 0.34;
        a.speed = Math.max(0, a.speed - impulse);
        b.speed = Math.max(0, b.speed + impulse * 0.72);
        if ("lateralSpeed" in a) a.lateralSpeed -= impulse * 0.12;
        if ("lateralSpeed" in b) b.lateralSpeed += impulse * 0.12;
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

// Builds a lightweight racing profile from the actual centerline. The
// accumulated heading change over the next few samples tells the AI whether
// a corner is coming and how severe it is, so it can brake before the apex
// instead of discovering the bend only when the waypoint is already beside
// the car.
function aiCornerProfile(startIdx) {
  let totalTurn = 0;
  let maxTurnStep = 0;
  let previousHeading = headingOf(centerline[startIdx]);

  for (let step = 1; step <= AI.cornerLookahead; step++) {
    const idx = (startIdx + step) % centerline.length;
    const heading = headingOf(centerline[idx]);
    let delta = heading - previousHeading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    totalTurn += delta;
    maxTurnStep = Math.max(maxTurnStep, Math.abs(delta));
    previousHeading = heading;
  }

  // A full corner can accumulate roughly a radian or more of heading change
  // over the preview window. Clamp to keep the controller predictable on
  // the hand-authored circuits.
  const severity = Math.min(
    1,
    Math.max(Math.abs(totalTurn) * 0.72, maxTurnStep * 6)
  );
  return { turn: totalTurn, severity };
}

function progressGapAhead(from, to) {
  let gap = to.totalProgress - from.totalProgress;
  while (gap < 0) gap += 1;
  return gap;
}

function updateAiCar(car, dt, allCars) {
  const now = performance.now();
  if (updateAiPitStop(car, now)) return;

  const info = nearestTrackInfo(car.x, car.z);
  const profile = aiCornerProfile(info.idx);
  const speedRatio = Math.min(Math.abs(car.speed) / AI.maxSpeed, 1);

  // Look farther ahead at speed, but shorten the preview in a heavy corner
  // so the target does not jump across the apex.
  const dynamicLookahead = Math.max(
    6,
    AI.lookahead + Math.round(speedRatio * 10) - Math.round(profile.severity * 5)
  );
  const targetIndex = (info.idx + dynamicLookahead) % centerline.length;
  const target = centerline[targetIndex];

  const lateral = sideNormal(centerline[info.idx]);
  let lineOffset = -Math.sign(profile.turn || 1) * (0.3 + profile.severity * 0.9);

  // Tactical traffic layer: if another car is close ahead, move to the side
  // opposite its current lateral position. If another car is close behind,
  // favour the inside of the next corner to defend without teleporting lanes.
  let nearestAhead = null;
  let nearestAheadGap = Infinity;
  let nearestBehindGap = Infinity;
  let nearestBehind = null;
  for (const other of allCars) {
    if (other === car) continue;
    const gapAhead = progressGapAhead(car, other);
    const gapBehind = progressGapAhead(other, car);
    const worldDist = Math.hypot(car.x - other.x, car.z - other.z);

    if (gapAhead > 0 && gapAhead < 0.012 && worldDist < 14 && gapAhead < nearestAheadGap) {
      nearestAhead = other;
      nearestAheadGap = gapAhead;
    }
    if (gapBehind > 0 && gapBehind < 0.012 && worldDist < 10 && gapBehind < nearestBehindGap) {
      nearestBehind = other;
      nearestBehindGap = gapBehind;
    }
  }

  if (nearestAhead) {
    const otherSide = (nearestAhead.x - target.x) * lateral.x +
      (nearestAhead.z - target.z) * lateral.z;
    const passSide = otherSide >= 0 ? -1 : 1;
    lineOffset = passSide * (0.8 + profile.severity * 0.45);
  } else if (nearestBehind) {
    lineOffset = -Math.sign(profile.turn || 1) * (0.9 + profile.severity * 0.35);
  }

  // Small avoidance force remains useful for actual contact, but the target
  // line now gives the AI a deliberate place to race rather than constantly
  // steering back to the centreline.
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

  const aimX =
    target.x +
    lateral.x * (lineOffset + avoidPush * AI_AVOID_STRENGTH * 0.12);
  const aimZ =
    target.z +
    lateral.z * (lineOffset + avoidPush * AI_AVOID_STRENGTH * 0.12);

  const toTarget = Math.atan2(aimX - car.x, aimZ - car.z);
  let err = toTarget - car.heading;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;

  // Corner speed model: reduce target speed before the turn, then accelerate
  // once the preview is clear. Damage, DRS and caution still layer on top.
  const cornerSpeedFactor = 1 - profile.severity * 0.48;
  const baseTargetSpeed = AI.maxSpeed * cornerSpeedFactor;
  const tacticalBoost = nearestAhead && profile.severity < 0.25 ? 1.04 : 1;
  const aiMaxSpeed =
    baseTargetSpeed *
    tacticalBoost *
    (1 - car.damage) *
    (car.drsActive ? DRS_SPEED_MULTIPLIER : 1) *
    (car.ersActive ? ERS_SPEED_MULTIPLIER : 1) *
    cautionSpeedMultiplier();

  if (car.speed > aiMaxSpeed) {
    car.speed = Math.max(aiMaxSpeed, car.speed - AI.brakeDecel * dt);
  } else {
    car.speed = Math.min(aiMaxSpeed, car.speed + AI.accel * dt);
  }

  const rate =
    AI.turnRate *
    (0.35 + 0.65 * Math.min(car.speed / AI.maxSpeed, 1)) *
    tireGripFactor(car.totalProgress, car);
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
const CHASE_CAM_BASE_DISTANCE = 6.4;
const CHASE_CAM_BASE_FOV = 58; // matches updateSpeedFov's resting FOV
// camera.fov is a VERTICAL field of view — on a wide-and-short viewport
// (a phone in landscape, aspect ratio well past 2:1) that same vertical FOV
// implies a much wider horizontal FOV than on a taller/squarer screen, so
// everything at a fixed distance (the car included) reads smaller purely
// from the aspect ratio, independent of the speed-FOV effect below. Only
// pulls the camera in for screens wider than this baseline — never pushes
// it out for taller ones, which already frame the car generously.
const CHASE_CAM_BASE_ASPECT = 1.7; // roughly 16:9, a typical landscape desktop/tablet
const CHASE_CAM_LANDSCAPE_MAX_DISTANCE = 4.35;

function isCompactLandscapeViewport() {
  return window.innerWidth > window.innerHeight && window.innerHeight <= 520;
}

function updateChaseCamera(dt) {
  // updateSpeedFov widens the FOV with speed for a sense of acceleration,
  // but a wider FOV alone makes everything at a fixed distance — the car
  // included — read smaller, which was the opposite of "feels faster".
  // Pulling the camera in as the FOV widens keeps the car's own size on
  // screen roughly constant; the world rushing past at the (still wider)
  // edges is what should carry the speed sensation, not the car shrinking.
  const fovScale =
    Math.tan(THREE.MathUtils.degToRad(CHASE_CAM_BASE_FOV / 2)) /
    Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const aspectScale = Math.min(1, CHASE_CAM_BASE_ASPECT / camera.aspect);
  let camDistance = CHASE_CAM_BASE_DISTANCE * fovScale * aspectScale;
  let camHeight = 3.55;

  // On short mobile landscape viewports the perceived car size can collapse
  // as the browser chrome and speed-FOV both change the framing. Use an
  // explicit close chase framing there instead of letting the generic
  // desktop distance dominate. This affects only the camera, never physics.
  if (isCompactLandscapeViewport()) {
    camDistance = Math.min(camDistance, CHASE_CAM_LANDSCAPE_MAX_DISTANCE);
    camHeight = 2.85;
  }
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

  if (state.cameraShake > 0) {
    const shake = state.cameraShake * 0.22;
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    camera.position.z += (Math.random() - 0.5) * shake;
    state.cameraShake = Math.max(0, state.cameraShake - dt * 1.8);
  }
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

// Player-only physics (throttle/brake, steering, position integration,
// track-limit collision) — shared by qualifying (solo) and the race
// (alongside the AI), so the two stay in perfect lockstep instead of two
// hand-maintained copies drifting apart. Returns the resulting
// nearestTrackInfo, which the caller needs for lap-progress tracking.
function integratePlayerMotion(dt) {
  // Longitudinal control. A lightweight traction circle couples throttle /
  // braking with lateral demand: asking the tyres to turn leaves less grip
  // available to accelerate or brake. This makes trail braking and clean
  // corner exits matter without requiring a full rigid-body tyre model.
  const preSpeedFactor = Math.min(Math.abs(state.speed) / CAR.maxSpeed, 1);
  const preLateralDemand = Math.min(
    Math.abs(state.lateralSpeed) / Math.max(Math.abs(state.speed) * 0.3, 1),
    1
  );
  const brakingLoadTransfer = input.back ? 0.12 + 0.12 * preSpeedFactor : 0;
  const accelerationLoadTransfer = input.forward ? 0.08 + 0.08 * preSpeedFactor : 0;
  const longitudinalGripBudget = Math.max(0.5, 1 - preLateralDemand * 0.42);
  if (input.forward) {
    const traction = longitudinalGripBudget * (1 - accelerationLoadTransfer * 0.35);
    state.speed += CAR.accel * traction * dt;
  } else if (input.back) {
    const brakeAuthority = longitudinalGripBudget * (1 + brakingLoadTransfer * 0.25);
    state.speed -= CAR.brakeDecel * brakeAuthority * dt;
  } else {
    const decel = CAR.coastDecel * dt;
    if (state.speed > 0) state.speed = Math.max(0, state.speed - decel);
    else if (state.speed < 0) state.speed = Math.min(0, state.speed + decel);
  }
  const playerMaxSpeed =
    CAR.maxSpeed *
    (1 - state.damage) *
    (state.drsActive ? DRS_SPEED_MULTIPLIER : 1) *
    (state.ersActive ? ERS_SPEED_MULTIPLIER : 1) *
    cautionSpeedMultiplier();
  state.speed = Math.max(
    CAR.reverseMaxSpeed,
    Math.min(playerMaxSpeed, state.speed)
  );

  // Steering / cornering.
  //
  // The old model changed heading directly and then moved the car only along
  // that heading. That is stable and arcade-friendly, but it gives the car
  // no lateral momentum. Keep the same input contract while adding a small
  // dynamic layer: yaw rate builds toward a grip-limited target and lateral
  // velocity is damped rather than snapped to zero. This gives us controllable
  // slip, understeer and tyre-grip effects without turning the browser game
  // into a full rigid-body simulator.
  const speedFactor = Math.min(Math.abs(state.speed) / CAR.maxSpeed, 1);
  const grip = tireGripFactor(state.totalProgress, state);
  const steerSign = state.speed >= 0 ? 1 : -1;
  const keyboardSteer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const steerAmount = touchSteer !== 0 ? touchSteer : keyboardSteer;

  // Braking loads the front axle and sharpens initial turn-in; power shifts
  // load rearward and slightly reduces front authority. At high combined
  // demand the available grip saturates progressively rather than switching.
  const loadTransferSteer = input.back ? 1.08 : input.forward ? 0.94 : 1;
  const combinedDemand = Math.min(Math.abs(state.lateralSpeed) / Math.max(Math.abs(state.speed) * 0.28, 1), 1);
  const gripSaturation = 1 - combinedDemand * 0.22;
  const speedSteerLimit = (1 - 0.55 * speedFactor) * loadTransferSteer * gripSaturation;
  const targetYawRate =
    -steerAmount *
    CAR.maxTurnRate *
    speedSteerLimit *
    grip *
    steerSign;

  // Steering response is intentionally finite: changing direction creates
  // a short transition instead of an instantaneous heading change.
  const yawResponse = 7.5;
  state.yawRate += (targetYawRate - state.yawRate) * Math.min(1, yawResponse * dt);
  if (Math.abs(state.speed) < 0.05 || steerAmount === 0) {
    state.yawRate *= Math.max(0, 1 - dt * 5);
  }
  state.heading += state.yawRate * dt;

  // Lateral momentum. The target is proportional to speed and steering, but
  // tyre grip limits how much of it survives. Low grip therefore produces a
  // wider line and more slide rather than simply reducing turn rate.
  const lateralAxisX = -Math.cos(state.heading);
  const lateralAxisZ = Math.sin(state.heading);
  const maxLateral = Math.abs(state.speed) * 0.32;
  const desiredLateral =
    steerAmount * Math.abs(state.speed) * 0.16 * (0.55 + 0.45 * grip) * steerSign;
  // Recovery is deliberately progressive. Heavy braking while cornering can
  // loosen the rear; throttle asks for traction and therefore damps lateral
  // recovery a little until the wheel is unwound.
  const rearStability = input.back ? 0.86 : input.forward ? 0.92 : 1;
  const lateralResponse = (5.0 + grip * 3.0) * rearStability;
  state.lateralSpeed +=
    (desiredLateral - state.lateralSpeed) *
    Math.min(1, lateralResponse * dt);

  // Tyre slip grows when requested lateral motion exceeds available grip.
  // A small slip penalty feeds back into longitudinal speed, so entering a
  // corner too aggressively costs exit speed instead of producing a free
  // pivot around the car's centre.
  state.lateralSpeed = Math.max(
    -maxLateral,
    Math.min(maxLateral, state.lateralSpeed)
  );
  const slipRatio =
    maxLateral > 0.001
      ? Math.min(Math.abs(state.lateralSpeed) / maxLateral, 1)
      : 0;
  const cornerDrag = 1 + slipRatio * (1.8 - grip);
  if (state.speed > 0) {
    state.speed = Math.max(0, state.speed - state.speed * (cornerDrag - 1) * 0.9 * dt);
  }

  // Integrate both velocity components in world space.
  const forwardX = Math.sin(state.heading);
  const forwardZ = Math.cos(state.heading);
  state.x +=
    (forwardX * state.speed + lateralAxisX * state.lateralSpeed) * dt;
  state.z +=
    (forwardZ * state.speed + lateralAxisZ * state.lateralSpeed) * dt;

  const info = nearestTrackInfo(state.x, state.z);
  applyTrackBoundary(state, dt, info);

  // One violation per excursion (the moment it crosses out, not every
  // frame spent off), so lightly touching the runoff for a full second
  // doesn't rack up dozens of "offences" on its own.
  const isOffTrack = info.dist > GRASS_LIMIT;
  if (isOffTrack && !state.wasOffTrack) state.trackLimitViolationsThisLap++;
  state.wasOffTrack = isOffTrack;

  return info;
}

// Shared speed-effect update (FOV widening) — cosmetic, identical in
// qualifying and racing.
function updateSpeedFov(dt) {
  const speedFov = Math.min(Math.abs(state.speed) / CAR.maxSpeed, 1);
  const targetFov = 58 + speedFov * 12;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
}

// Synthesizes a plausible AI qualifying lap time from its own pace, rather
// than actually simulating nine solo flying laps — invisible to the
// player either way, and this is far cheaper. A flat-out reference time
// (track length / top speed) scaled up for the corners an AI can't take at
// full speed, plus a little per-driver spread so the AI grid order isn't
// identical every single qualifying session.
function synthesizeAiQualiTime() {
  const idealLapTimeMs = (TRACK_LENGTH / AI.maxSpeed) * 1000;
  const CORNERING_LOSS_FACTOR = 1.35;
  const variance = 0.94 + Math.random() * 0.12; // +/-6% spread between AI drivers
  return idealLapTimeMs * CORNERING_LOSS_FACTOR * variance;
}

// Places whichever driver qualified into each of the 10 fixed physical
// grid slots (pole first), and resets that car's per-lap bookkeeping for
// the race about to start.
function applyGridPositions(order) {
  order.forEach((driverId, i) => {
    const slot = ALL_GRID_SLOTS[i];
    const pos = gridSlot(slot.row, slot.lane);
    const info = nearestTrackInfo(pos.x, pos.z);
    const car = driverId === "player" ? state : aiCars.find((c) => c.driverId === driverId);
    car.x = pos.x;
    car.z = pos.z;
    car.heading = pos.heading;
    car.speed = 0;
    car.lateralSpeed = 0;
    car.yawRate = 0;
    car.prevRawProgress = info.idx / centerline.length;
    car.totalProgress = 0;
    car.tyreProgress = 0;
    car.lap = 0;
    car.completedLaps = 0;
    car.lapCheckpointPassed = false;
    car.ersCharge = 100;
    car.ersActive = false;
    car.pitState = "none";
    car.pitServiceEndTime = 0;
    car.hasPitted = false;
  });
}

// Ends the qualifying session: combines the player's best flying lap (or
// no time at all, if they never completed one — same as a real DNF in
// qualifying, sent to the back) with synthesized AI times, sorts fastest
// first, and hands that order to applyGridPositions() before handing off
// to the race's own countdown.
function finishQualifying() {
  const results = [
    { id: "player", time: qualiBestTime === null ? Infinity : qualiBestTime },
    ...AI_DRIVERS.map((driver) => ({ id: driver.id, time: synthesizeAiQualiTime() })),
  ];
  results.sort((a, b) => a.time - b.time);
  applyGridPositions(results.map((r) => r.id));
  aiCars.forEach((car) => {
    car.group.visible = true;
    applyToMesh(car, car.x, car.z, car.heading, 0, 0);
  });
  applyToMesh(playerCar, state.x, state.z, state.heading, 0, 0);

  state.speed = 0;
  state.currentLapTime = 0;
  state.bestLapTime = null;
  circuitNameEl.textContent = circuitLabel();
  hintEl.textContent = RACE_HINT_TEXT;

  sessionPhase = "race";
  raceState = "countdown";
  startRaceCountdown();
}

function updateQualifying(dt) {
  const now = performance.now();

  if (qualiState === "countdown") {
    // Car sits frozen at the line until the lights go out, same as the
    // race's own grid start.
    applyToMesh(playerCar, state.x, state.z, state.heading, 0, dt);
    updateCamera(dt);
    updateQualifyingHud();
    return;
  }

  const info = integratePlayerMotion(dt);
  applyToMesh(playerCar, state.x, state.z, state.heading, state.speed, dt);

  // Multiple flying laps are allowed within the session — only the best
  // one counts, same as a real qualifying hour.
  const justCompletedLap = advanceProgress(state, info.idx / centerline.length);
  if (justCompletedLap) {
    const lapTime = now - state.lapStartTime;
    if (qualiBestTime === null || lapTime < qualiBestTime) {
      qualiBestTime = lapTime;
    }
    state.lapStartTime = now;
  }
  state.currentLapTime = now - state.lapStartTime;

  qualiTimeRemainingMs = Math.max(0, qualiTimeRemainingMs - dt * 1000);

  updateCamera(dt);
  updateSpeedFov(dt);
  updateQualifyingHud();

  if (qualiTimeRemainingMs <= 0) finishQualifying();
}

function isInPitZone(car) {
  const fraction = car.totalProgress - Math.floor(car.totalProgress);
  return fraction >= PIT_ZONE_START || fraction <= PIT_ZONE_END;
}

function updateEnergyRecovery(cars, dt) {
  for (const car of cars) {
    if (car === state) {
      if (state.pitState === "servicing") {
        state.ersActive = false;
        continue;
      }
      if (state.ersActive && state.ersCharge > 0) {
        state.ersCharge = Math.max(0, state.ersCharge - ERS_DRAIN_PER_SECOND * dt);
        if (state.ersCharge <= 0) state.ersActive = false;
      } else {
        const recharge = input.back ? ERS_RECHARGE_PER_SECOND * 1.8 : ERS_RECHARGE_PER_SECOND;
        state.ersCharge = Math.min(100, state.ersCharge + recharge * dt);
      }
    } else {
      if (
        car.ersCharge > 0 &&
        car.drsActive &&
        car.speed > AI.maxSpeed * 0.62 &&
        cautionState !== "active"
      ) {
        car.ersActive = true;
      } else {
        car.ersActive = false;
      }
      if (car.ersActive) {
        car.ersCharge = Math.max(0, car.ersCharge - ERS_DRAIN_PER_SECOND * 0.75 * dt);
        if (car.ersCharge <= 0) car.ersActive = false;
      } else {
        car.ersCharge = Math.min(100, car.ersCharge + ERS_RECHARGE_PER_SECOND * dt);
      }
    }
  }
}

function startPitStop() {
  if (
    raceState !== "racing" ||
    state.pitState !== "none" ||
    !isInPitZone(state) ||
    Math.abs(state.speed) > PIT_SPEED_LIMIT
  ) {
    state.pitRequested = false;
    return;
  }
  state.pitRequested = false;
  state.pitState = "servicing";
  state.pitServiceEndTime = performance.now() + PIT_SERVICE_MS;
  state.speed = 0;
  state.lateralSpeed = 0;
  state.yawRate = 0;
  state.ersActive = false;
}

function updatePitStop(now) {
  if (state.pitState !== "servicing") return false;
  state.speed = 0;
  state.lateralSpeed = 0;
  state.yawRate = 0;
  if (now < state.pitServiceEndTime) return true;

  state.pitState = "none";
  state.tyreProgress = 0;
  state.damage *= 0.25;
  state.ersCharge = 100;
  return false;
}

function updateAiPitStop(car, now) {
  if (car.pitState === "servicing") {
    car.speed = 0;
    car.lateralSpeed = 0;
    car.yawRate = 0;
    if (now >= car.pitServiceEndTime) {
      car.pitState = "none";
      car.tyreProgress = 0;
      car.damage *= 0.25;
      car.ersCharge = 100;
      car.hasPitted = true;
    }
    return true;
  }

  // One optional stop after lap 1 gives the AI a simple strategy layer while
  // keeping the three-lap browser race understandable.
  if (
    !car.hasPitted &&
    car.lap >= 1 &&
    isInPitZone(car) &&
    Math.abs(car.speed) < PIT_SPEED_LIMIT * 1.25
  ) {
    car.pitState = "servicing";
    car.pitServiceEndTime = now + PIT_SERVICE_MS;
    car.speed = 0;
    car.lateralSpeed = 0;
    car.yawRate = 0;
    car.ersActive = false;
    return true;
  }

  // Start lifting for the pit entry when the car reaches the final part of
  // the lap, so the service condition above can actually be reached.
  const fraction = car.totalProgress - Math.floor(car.totalProgress);
  if (!car.hasPitted && car.lap >= 1 && fraction > 0.9) {
    car.speed = Math.min(car.speed, PIT_SPEED_LIMIT * 0.75);
  }
  return false;
}

function update(dt) {
  if (sessionPhase === "qualifying") {
    updateQualifying(dt);
    return;
  }

  if (raceState === "finished") return;

  if (raceState === "countdown") {
    // Cars sit frozen on the grid until the lights go out.
    applyToMesh(playerCar, state.x, state.z, state.heading, 0, dt);
    for (const car of aiCars) applyToMesh(car, car.x, car.z, car.heading, 0, dt);
    updateCamera(dt);
    updateHud();
    return;
  }

  const now = performance.now();
  if (state.pitRequested) startPitStop();
  if (updatePitStop(now)) {
    applyToMesh(playerCar, state.x, state.z, state.heading, 0, dt);
    updateCamera(dt);
    updateSpeedFov(dt);
    updateHud();
    return;
  }

  updateDrsEligibility([state, ...aiCars]);
  updateEnergyRecovery([state, ...aiCars], dt);

  const info = integratePlayerMotion(dt);
  const allCars = [state, ...aiCars];
  for (const car of aiCars) updateAiCar(car, dt, allCars);
  resolveCarCollisions(allCars);

  applyToMesh(playerCar, state.x, state.z, state.heading, state.speed, dt);
  for (const car of aiCars) applyToMesh(car, car.x, car.z, car.heading, car.speed, dt);

  // Lap timing (current/best lap) uses the same fair progress accumulator
  // that drives race position, so it lines up with the lap count shown.
  const justCompletedLap = advanceProgress(state, info.idx / centerline.length);
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

  if (cautionState === "active" && now >= cautionEndTime) {
    cautionState = "none";
    lastCautionEndTime = now;
    cautionBannerEl.hidden = true;
  }

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

  if (raceState === "racing" && state.completedLaps >= LAPS_PER_RACE) {
    finishRace();
  }

  updateCamera(dt);
  updateSpeedFov(dt);
  updateHud();
}

// Real standing start: the car(s) sit still while this counts down, then
// everyone is free to move at once. Shared by the qualifying launch and
// the race start — same 3-2-1-VIA, different thing happens once the
// lights go out (see the two wrappers below).
function runStartCountdown(onGo) {
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
        onGo();
      }, 600);
    }
  }
  tick();
}

function startQualifyingCountdown() {
  runStartCountdown(() => {
    state.lapStartTime = performance.now();
    qualiState = "running";
  });
}

function startRaceCountdown() {
  runStartCountdown(() => {
    // state.lapStartTime is reset to the moment the lights go out, not
    // construction time, so the on-screen lap clock doesn't start ticking
    // during the countdown itself.
    state.lapStartTime = performance.now();
    raceState = "racing";
  });
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  update(dt);
  updateImpactSparks(dt);
  updateRain(dt);
  cloudGroup.rotation.y += dt * 0.004; // slow drift, always running regardless of session phase
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

startQualifyingCountdown();
animate();
