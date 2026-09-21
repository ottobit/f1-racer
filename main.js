import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CIRCUITS, getCircuit, LAPS_PER_RACE } from "./circuits.js";
import { POINTS_BY_POSITION, recordRaceResult } from "./championship.js";
import { displayDriverName, loadSelectedDriverId } from "./driver-selection.js";
import { cockpitThemeForDriver, liveryById, liveryIdForDriver } from "./driver-themes.js";
import { loadGarageSetup, selectedGarageLivery, setupEffects } from "./garage-setup.js";

import { createStudioEnvironment } from "./car-model.js";
import { applyCarToMesh, buildRaceCar } from "./race-car-view.js";
import { setupRaceInput } from "./race-input.js";
import { setupRaceHud } from "./race-hud.js";
import { setupRaceCamera } from "./race-camera.js";
import { setupPlayerPhysics } from "./player-physics.js";
import { setupRaceAi } from "./race-ai.js";
import { setupRaceSystems } from "./race-systems.js";
import { setupRaceProgress } from "./race-progress.js";
import { setupRaceCommands } from "./race-commands.js";
import { setupCarCollisions } from "./race-collisions.js";

import { steeringYaw } from "./steering.js";
import { dressCircuit, surfaceTexture } from "./track-art.js";

const GARAGE_SETUP = loadGarageSetup();
const GARAGE_EFFECTS = setupEffects(GARAGE_SETUP);
const PLAYER_LIVERY = selectedGarageLivery(GARAGE_SETUP);
const PLAYER_COCKPIT_THEME = cockpitThemeForDriver(loadSelectedDriverId());

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

// Collision damage follows relative impact speed and applies equally to the
// player and every AI car. A gentle rub leaves no mark; a hard contact costs
// both cars pace without making either one undriveable.
const DAMAGE_MIN_IMPACT_SPEED = 7;
const DAMAGE_PER_IMPACT_SPEED = 0.003;
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
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = isRaining ? 1.05 : 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
scene.add(new THREE.HemisphereLight(0xd3e1ee, 0x596044, isRaining ? 1.35 : 1.8));
const sun = new THREE.DirectionalLight(0xffffff, isRaining ? 0.7 : 1.2);
sun.position.set(80, 120, 40);
sun.intensity = isRaining ? 1.4 : 2.6;
sun.color.set(isRaining ? 0xdbe5f5 : 0xffedcf);
sun.castShadow = true; sun.shadow.mapSize.set(1024,1024);
Object.assign(sun.shadow.camera, {left:-32,right:32,top:32,bottom:-32,near:1,far:120});
sun.shadow.bias = -.0003; sun.shadow.normalBias = .04;
scene.add(sun, sun.target);

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1400, 1400),
  new THREE.MeshStandardMaterial({ color: 0xb7c494, map: surfaceTexture("grass", renderer), roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true; scene.add(ground);

// Road surface: triangle strip built from left/right edges of the centerline
function buildRoadMesh() {
  const positions = [];
  const uvs = [];
  const indices = [];
  const halfWidth = TRACK_WIDTH / 2;

  for (let i = 0; i <= centerline.length; i++) {
    const p = centerline[i % centerline.length];
    const n = sideNormal(p);
    positions.push(p.x + n.x * halfWidth, 0.01, p.z + n.z * halfWidth);
    positions.push(p.x - n.x * halfWidth, 0.01, p.z - n.z * halfWidth);
    uvs.push(0,i / centerline.length * trackCurve.getLength() / 12,1,i / centerline.length * trackCurve.getLength() / 12);
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
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x999b9e, map: surfaceTexture("asphalt", renderer),
    roughness: isRaining ? .32 : .91, metalness: isRaining ? .25 : .03,
    envMap: carEnvironment.texture, envMapIntensity: isRaining ? .22 : .04,
  });
  const road = new THREE.Mesh(geometry, material); road.receiveShadow = true; return road;
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
dressCircuit(scene, centerline, TRACK_WIDTH, renderer, isRaining);

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
  return buildRaceCar(color, {
    scale: CAR_SCALE,
    environmentTexture: carEnvironment.texture,
    envMapIntensity: 0.65,
  });
}

// Player car
const playerCar = buildCar(PLAYER_LIVERY);
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
  { id: "rival-red", livery: liveryById(liveryIdForDriver("rival-red")) }, // player's teammate
  { id: "rival-blue", livery: liveryById(liveryIdForDriver("rival-blue")) },
  { id: "rival-blue-2", livery: liveryById(liveryIdForDriver("rival-blue-2")) },
  { id: "rival-yellow", livery: liveryById(liveryIdForDriver("rival-yellow")) },
  { id: "rival-yellow-2", livery: liveryById(liveryIdForDriver("rival-yellow-2")) },
  { id: "rival-green-1", livery: liveryById(liveryIdForDriver("rival-green-1")) },
  { id: "rival-green-2", livery: liveryById(liveryIdForDriver("rival-green-2")) },
  { id: "rival-white-1", livery: liveryById(liveryIdForDriver("rival-white-1")) },
  { id: "rival-white-2", livery: liveryById(liveryIdForDriver("rival-white-2")) },
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
  const model = buildCar(driver.livery);
  scene.add(model.group);
  const slot = AI_GRID_SLOTS[i];
  const pos = gridSlot(slot.row, slot.lane);
  const info = nearestTrackInfo(pos.x, pos.z);
  return {
    ...model,
    driverId: driver.id,
    color: driver.livery.primary,
    x: pos.x,
    z: pos.z,
    heading: pos.heading,
    speed: 0,
    prevRawProgress: info.idx / centerline.length,
    totalProgress: 0,
    lap: 0,
    damage: 0,
    lateralSpeed: 0,
    yawRate: 0,
    drsActive: false,
    tyreCompound: "medium",
    tyreProgress: 0,
    ersCharge: 100,
    ersActive: false,
    pitState: "none",
    pitServiceEndTime: 0,
    hasPitted: false,
    lastImpactEffectTime: 0,
    lastCollisionTime: 0,
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
  lastCollisionTime: 0,
  cameraShake: 0,
  // Physics extension: lateral velocity and yaw-rate make the car carry
  // momentum through corners instead of moving only along its heading.
  lateralSpeed: 0,
  yawRate: 0,
  wasOffTrack: false,
  trackLimitViolationsThisLap: 0,
  lastLapPenaltyMs: 0,
};
const { advanceProgress, applyGridPositions, currentRaceOrder } = setupRaceProgress({
  state,
  aiCars,
  allGridSlots: ALL_GRID_SLOTS,
  gridSlot,
  nearestTrackInfo,
  centerlineLength: centerline.length,
});

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
    hud.setCautionVisible(true);
  }
}

function cautionSpeedMultiplier() {
  return cautionState === "active" ? CAUTION_SPEED_FACTOR : 1;
}

const { input, steering, updateSteeringInput } = setupRaceInput();
setupRaceCommands({
  state,
  tyreCompounds: TYRE_COMPOUNDS,
  getRaceState: () => raceState,
});

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

// Weather badge stays on the circuit name in every phase; the "Qualifica"
// suffix only applies until the race itself starts (see finishQualifying).
function circuitLabel() {
  return isRaining ? `${circuit.name} · 🌧️ Pioggia` : circuit.name;
}

const hud = setupRaceHud({
  circuitLabel,
  lapsPerRace: LAPS_PER_RACE,
  tyreCompounds: TYRE_COMPOUNDS,
  carMaxSpeed: CAR.maxSpeed,
  state,
  aiCars,
  tireGripFactor,
  gearInfo,
  currentRaceOrder,
  updateEngineSound,
  playShiftClick,
  minimapCanvasSize: MINIMAP_CANVAS_SIZE,
  minimapTrackPoints,
  minimapPoint,
});

// --- Main loop -------------------------------------------------------------

const clock = new THREE.Clock();

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

const carCollisions = setupCarCollisions({
  radius: CAR_RADIUS,
  damageThreshold: DAMAGE_MIN_IMPACT_SPEED,
  damagePerSpeed: DAMAGE_PER_IMPACT_SPEED,
  maxDamage: DAMAGE_MAX_SPEED_PENALTY,
  onImpact({ a, b, x, z, closingSpeed }) {
    if (closingSpeed < 5) return;
    spawnImpactSparks(x, z);
    if (a === state || b === state) {
      state.cameraShake = Math.max(state.cameraShake, Math.min(closingSpeed / 38, 1));
    }
  },
});

const raceSystems = setupRaceSystems({
  state,
  input,
  aiMaxSpeed: AI.maxSpeed,
  getRaceState: () => raceState,
  isCautionActive: () => cautionState === "active",
  pitZoneStart: PIT_ZONE_START,
  pitZoneEnd: PIT_ZONE_END,
  pitSpeedLimit: PIT_SPEED_LIMIT,
  pitServiceMs: PIT_SERVICE_MS,
  ersDrainPerSecond: ERS_DRAIN_PER_SECOND,
  ersRechargePerSecond: ERS_RECHARGE_PER_SECOND,
});

const { updateAiCar } = setupRaceAi({
  ai: AI,
  centerline,
  headingOf,
  sideNormal,
  nearestTrackInfo,
  applyTrackBoundary,
  advanceProgress,
  updateAiPitStop: raceSystems.updateAiPitStop,
  tireGripFactor,
  drsSpeedMultiplier: DRS_SPEED_MULTIPLIER,
  ersSpeedMultiplier: ERS_SPEED_MULTIPLIER,
  cautionSpeedMultiplier,
});

function driverName(driverId) {
  return displayDriverName(driverId);
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

const raceCamera = setupRaceCamera({
  scene,
  camera,
  state,
  playerCar,
  carMaxSpeed: CAR.maxSpeed,
  cockpitTheme: PLAYER_COCKPIT_THEME,
});
const { integratePlayerMotion } = setupPlayerPhysics({
  car: CAR,
  state,
  input,
  steering,
  drsSpeedMultiplier: DRS_SPEED_MULTIPLIER,
  ersSpeedMultiplier: ERS_SPEED_MULTIPLIER,
  grassLimit: GRASS_LIMIT,
  tireGripFactor,
  cautionSpeedMultiplier,
  steeringYaw,
  nearestTrackInfo,
  applyTrackBoundary,
});

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
    applyCarToMesh(car, car.x, car.z, car.heading, 0, 0);
  });
  applyCarToMesh(playerCar, state.x, state.z, state.heading, 0, 0, steering.value);

  state.speed = 0;
  state.currentLapTime = 0;
  state.bestLapTime = null;
  hud.setRaceLabel();

  sessionPhase = "race";
  raceState = "countdown";
  startRaceCountdown();
}

function updateQualifying(dt) {
  const now = performance.now();

  if (qualiState === "countdown") {
    // Car sits frozen at the line until the lights go out, same as the
    // race's own grid start.
    applyCarToMesh(playerCar, state.x, state.z, state.heading, 0, dt, steering.value);
    raceCamera.updateCamera(dt);
    hud.updateQualifyingHud(qualiTimeRemainingMs, qualiBestTime);
    return;
  }

  const info = integratePlayerMotion(dt);
  applyCarToMesh(playerCar, state.x, state.z, state.heading, state.speed, dt, steering.value);

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

  raceCamera.updateCamera(dt);
  raceCamera.updateSpeedFov(dt);
  hud.updateQualifyingHud(qualiTimeRemainingMs, qualiBestTime);

  if (qualiTimeRemainingMs <= 0) finishQualifying();
}

function update(dt) {
  if (sessionPhase === "qualifying") {
    updateQualifying(dt);
    return;
  }

  if (raceState === "finished") return;

  if (raceState === "countdown") {
    // Cars sit frozen on the grid until the lights go out.
    applyCarToMesh(playerCar, state.x, state.z, state.heading, 0, dt, steering.value);
    for (const car of aiCars) applyCarToMesh(car, car.x, car.z, car.heading, 0, dt);
    raceCamera.updateCamera(dt);
    hud.updateHud();
    return;
  }

  const now = performance.now();
  if (state.pitRequested) raceSystems.startPitStop();
  if (raceSystems.updatePitStop(now)) {
    applyCarToMesh(playerCar, state.x, state.z, state.heading, 0, dt, steering.value);
    raceCamera.updateCamera(dt);
    raceCamera.updateSpeedFov(dt);
    hud.updateHud();
    return;
  }

  updateDrsEligibility([state, ...aiCars]);
  raceSystems.updateEnergyRecovery([state, ...aiCars], dt);

  const info = integratePlayerMotion(dt);
  const allCars = [state, ...aiCars];
  for (const car of aiCars) updateAiCar(car, dt, allCars);
  carCollisions.resolve(allCars, now);

  applyCarToMesh(playerCar, state.x, state.z, state.heading, state.speed, dt, steering.value);
  for (const car of aiCars) applyCarToMesh(car, car.x, car.z, car.heading, car.speed, dt);

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
    if (penaltyMs > 0) hud.showPenaltyNotice(penaltyMs);
    currentLapSamples = [];
    lastGhostSampleT = -Infinity;
  }
  state.currentLapTime = now - state.lapStartTime;

  if (cautionState === "active" && now >= cautionEndTime) {
    cautionState = "none";
    lastCautionEndTime = now;
    hud.setCautionVisible(false);
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
    applyCarToMesh(ghostCar, gx, gz, gheading, 0, dt);
    ghostCar.group.visible = true;
  } else {
    ghostCar.group.visible = false;
  }

  if (raceState === "racing" && state.completedLaps >= LAPS_PER_RACE) {
    finishRace();
  }

  raceCamera.updateCamera(dt);
  raceCamera.updateSpeedFov(dt);
  hud.updateHud();
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
  updateSteeringInput(dt);
  update(dt);
  updateImpactSparks(dt);
  updateRain(dt);
  cloudGroup.rotation.y += dt * 0.004; // slow drift, always running regardless of session phase
  sun.position.set(state.x + 30, 55, state.z + 25);
  sun.target.position.set(state.x, 0, state.z);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

startQualifyingCountdown();
animate();
