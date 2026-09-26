import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CIRCUITS, getCircuit, LAPS_PER_RACE, TYRE_LIFE_LAPS } from "../shared/circuits.js?v=39";
import { POINTS_BY_POSITION, recordRaceResult } from "../shared/championship.js?v=1";
import { displayDriverName, loadSelectedDriverId } from "../shared/driver-selection.js?v=1";
import { DRIVER_ROSTER } from "../shared/driver-roster.js?v=1";
import { liveryById } from "../shared/driver-themes.js?v=27";
import { loadGarageSetup, playerLivery, setupEffects } from "../shared/garage-setup.js?v=29";

import { createStudioEnvironment } from "../shared/car-model.js?v=30";
import { applyCarToMesh, buildRaceCar } from "./race-car-view.js?v=32";
import { setupRaceInput } from "./race-input.js?v=48";
import { setupRaceHud } from "./race-hud.js?v=38";
import { setupBrakeMap } from "./race-brake-map.js?v=3";
import { setupRaceCamera } from "./race-camera.js?v=32";
import { setupPlayerPhysics } from "./player-physics.js?v=7";
import { setupRaceAi } from "./race-ai.js?v=29";
import { setupRaceSystems } from "./race-systems.js?v=30";
import { setupRaceProgress } from "./race-progress.js?v=27";
import { setupRaceCommands } from "./race-commands.js?v=2";
import { setupCarCollisions } from "./race-collisions.js?v=1";
import { setupRaceNameplates } from "./race-nameplates.js?v=1";
import { setupAgentApi } from "./agent-api.js?v=2";
import { setupMultiplayer } from "../multiplayer/race-multiplayer.js?v=7";

import { steeringYaw } from "./steering.js?v=3";
import { dressCircuit, dressPitLane, surfaceTexture } from "./track-art.js?v=41";
import { buildPitLane } from "../shared/pit-lane.js?v=1";
import { setupPitCrew } from "./pit-crew.js?v=2";
import { gearInfo, setupRaceAudio } from "./race-audio.js?v=3";
import { setupExhaustPops } from "./race-exhaust.js?v=1";
import { setupRaceWeather } from "./race-weather.js?v=1";
import { loadGraphicsProfile, createFrameLimiter } from "../shared/graphics-profiles.js?v=3";
import { setupDiagnosticsOverlay } from "./race-diagnostics.js?v=1";
import {
  sampleCenterline,
  headingOf,
  sideNormal,
  offsetEdge,
  nearestTrackInfo as nearestPointOnCenterline,
} from "../shared/track-geometry.js?v=39";

const GARAGE_SETUP = loadGarageSetup();
const GARAGE_EFFECTS = setupEffects(GARAGE_SETUP);
// Multiplayer Stage 2 (#44): null for a normal solo session (no ?room= in
// the URL, or a room session that couldn't be resumed — see
// race-bootstrap.js/race-multiplayer.js). Every integration point below is
// an explicit branch on this, so solo play's existing behavior is
// unchanged when it's null — never a silent shared code path.
const multiplayer = setupMultiplayer();

// In a room the local car is the driver reserved there (#91), which is what
// every other participant sees; the solo selection only applies offline.
const ROOM_PARTICIPANTS_WITH_DRIVER = multiplayer
  ? multiplayer.room.participants.filter((p) => p.driverId)
  : [];
const MY_ROOM_DRIVER_ID = multiplayer
  ? ROOM_PARTICIPANTS_WITH_DRIVER.find((p) => p.participantId === multiplayer.myParticipantId)?.driverId ?? null
  : null;
const SELECTED_DRIVER_ID = MY_ROOM_DRIVER_ID || loadSelectedDriverId();
const PLAYER_LIVERY = playerLivery(SELECTED_DRIVER_ID);

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
const START_FINISH_OFFSET = 5;
const CONTROL_POINTS = circuit.points.map(([x, z]) => new THREE.Vector3(x, 0, z));

// Light dynamic weather: a fixed per-circuit trait (see circuits.js), not
// randomized per race. Rain only touches cornering grip and top speed —
// braking/acceleration feel is left alone — plus a darker, closer sky and
// fog so it also reads as wet at a glance, not just plays different.
const isRaining = circuit.weather === "pioggia";
const RAIN_TURN_RATE_MULTIPLIER = 0.82;
const RAIN_MAX_SPEED_MULTIPLIER = 0.93;

// Scales rendering cost (DPR, shadows, rain/cloud counts) by device, never
// gameplay/physics — see graphics-profiles.js (#2).
const graphicsProfile = loadGraphicsProfile();

const trackCurve = new THREE.CatmullRomCurve3(CONTROL_POINTS, true, "catmullrom", circuit.curveTension ?? 0.5);

// Top speed is tuned to a realistic F1 figure (maxSpeed is treated as m/s
// for the km/h readout below, so 88 -> ~317 km/h on a straight, ~340 with
// ERS or DRS on a low-drag setup — #151) rather than
// the earlier, much slower placeholder value — accel/brakeDecel/coastDecel
// scale up with it so 0-100%, braking distance, and grass drag all still
// feel like the same car, just faster.
const CAR = {
  maxSpeed: 88 * (1 + GARAGE_EFFECTS.speed * 0.006) * (isRaining ? RAIN_MAX_SPEED_MULTIPLIER : 1),
  reverseMaxSpeed: -28,
  // Launch acceleration (m/s²); fades with speed in player-physics.js.
  // Was a flat 47 (0-100 km/h in 0.6s); now ~1.8s 0-100, ~4s 0-200.
  accel: 16 * (1 + GARAGE_EFFECTS.traction * 0.006),
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
  maxSpeed: 74.4 * diffPreset.speedMul * (isRaining ? RAIN_MAX_SPEED_MULTIPLIER : 1),
  accel: 14 * diffPreset.accelMul, // same player/AI ratio as the old 47/41
  turnRate: 2.1 * (isRaining ? RAIN_TURN_RATE_MULTIPLIER : 1),
  lookahead: 10, // base centerline samples ahead to steer toward
  cornerLookahead: 22, // samples used to preview upcoming bends
  brakeDecel: 68,
};

// Tire wear degrades grip gradually over the race distance for both player
// and AI, cutting into cornering rate rather than straight-line pace. The
// player can box in the real pit lane (#147); AI cars stay out.
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
const PIT_SPEED_LIMIT = 18;
const PIT_SERVICE_MS = 2200;

// Worn tyres also cost top speed (#149), for the player and the AI alike:
// about 1 s a lap at full wear on a medium set.
const TIRE_WEAR_MAX_SPEED_PENALTY = 0.05;

function tyreWear(totalProgress, car) {
  const distance = car?.tyreProgress ?? totalProgress;
  return Math.min(Math.max(distance / TYRE_LIFE_LAPS, 0), 1);
}

function tireGripFactor(totalProgress, car = null) {
  const tyre = TYRE_COMPOUNDS[car?.tyreCompound] || TYRE_COMPOUNDS.medium;
  const wear = tyreWear(totalProgress, car);
  const wetGrip = isRaining ? 0.82 : 1;
  return tyre.grip * (1 - TIRE_WEAR_MAX_TURN_PENALTY * wear * tyre.wearRate) * wetGrip;
}

function tyreSpeedFactor(car) {
  const tyre = TYRE_COMPOUNDS[car.tyreCompound] || TYRE_COMPOUNDS.medium;
  return 1 - TIRE_WEAR_MAX_SPEED_PENALTY * tyreWear(car.totalProgress, car) * tyre.wearRate;
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
// Sampling itself, plus headingOf/sideNormal/nearestTrackInfo below, live in
// track-geometry.js so the same rules that build this centerline can also
// run outside the browser (see tools/validate-circuits.mjs, #6).

const CENTERLINE_SAMPLES = 360;
const centerline = sampleCenterline(trackCurve, CENTERLINE_SAMPLES);
// Render-only: the road and its kerbs/runoff/rails are meshed from a denser
// sampling of the same curve so tight hairpins don't show as polygons.
// Gameplay (progress, AI, collisions) keeps the 360-sample centerline.
const visualCenterline = sampleCenterline(trackCurve, CENTERLINE_SAMPLES * 4);

// --- Braking hint (#71, #75, #77) --------------------------------------------
// Precomputed once: the fastest speed the player's car can take each
// centerline sample at, from the local curvature and the yaw rate the
// steering model can actually deliver at that speed (steering.js, with a
// margin for worn tyres and imperfect lines), plus the distance between
// samples. The braking map (race-brake-map.js) turns these into a
// green-to-red section of the next 300 m every frame. #75 reused the AI's
// corner-severity estimate, which never dropped below ~160-210 km/h on
// these short circuits, so the hint stayed green.
const BRAKE_HINT_CURVE_HALF_WINDOW_M = 6;
const BRAKE_HINT_YAW_MARGIN = 0.8;
const cornerTargetSpeed = centerline.map((_, i) => {
  const n = centerline.length;
  let back = i;
  let ahead = i;
  let length = 0;
  while (length < BRAKE_HINT_CURVE_HALF_WINDOW_M * 2 && ahead - back < n / 4) {
    const nextAhead = (ahead + 1) % n;
    const pa = centerline[ahead % n];
    const pb = centerline[nextAhead];
    length += Math.hypot(pb.x - pa.x, pb.z - pa.z);
    ahead += 1;
    const pBack = centerline[(back - 1 + n) % n];
    const pCur = centerline[(back + n) % n];
    length += Math.hypot(pCur.x - pBack.x, pCur.z - pBack.z);
    back -= 1;
  }
  let turn = headingOf(centerline[ahead % n]) - headingOf(centerline[(back + n) % n]);
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  const curvature = Math.abs(turn) / Math.max(length, 1e-3);
  const canHold = (v) =>
    Math.abs(steeringYaw(1, v, CAR.maxTurnRate, 1, 1)) * BRAKE_HINT_YAW_MARGIN >= v * curvature;
  if (canHold(CAR.maxSpeed)) return CAR.maxSpeed;
  let lo = 5;
  let hi = CAR.maxSpeed;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (canHold(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
});
const centerlineStep = centerline.map((p, i) => {
  const next = centerline[(i + 1) % centerline.length];
  return Math.hypot(next.x - p.x, next.z - p.z);
});

// Thin closure over this file's own `centerline` around the imported pure
// query, so every existing 2-arg call site (main.js and every setupXxx()
// this gets passed into) is unaffected by the move.
function nearestTrackInfo(x, z) {
  return nearestPointOnCenterline(centerline, x, z);
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

// Sky clouds, rain particles and impact sparks live in race-weather.js.
// `getPlayerState` is a getter (not `state` itself) because `state` isn't
// declared yet at this point in the file — same TDZ-safe pattern as
// `getRaceState` elsewhere — and updateRain() only needs it once actually
// called each frame, long after `state` exists.
const { spawnImpactSparks, updateWeather } = setupRaceWeather({
  scene,
  isRaining,
  getPlayerState: () => state,
  cloudCountMultiplier: graphicsProfile.cloudCountMultiplier,
  rainParticleMultiplier: graphicsProfile.rainParticleMultiplier,
});

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const renderer = new THREE.WebGLRenderer({ antialias: graphicsProfile.antialias });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = isRaining ? 1.05 : 1.15;
renderer.shadowMap.enabled = graphicsProfile.shadowsEnabled;
renderer.shadowMap.type = graphicsProfile.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
const carEnvironment = createStudioEnvironment(renderer);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphicsProfile.dprCap));
document.getElementById("app").appendChild(renderer.domElement);

// Dev-only overlay (see race-diagnostics.js, #2): a no-op unless explicitly
// enabled, so normal play never creates or sees the DOM node.
const diagnostics = setupDiagnosticsOverlay({ renderer, graphicsProfileId: graphicsProfile.id });

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
sun.castShadow = graphicsProfile.shadowsEnabled;
sun.shadow.mapSize.set(graphicsProfile.shadowMapSize, graphicsProfile.shadowMapSize);
Object.assign(sun.shadow.camera, {left:-32,right:32,top:32,bottom:-32,near:1,far:120});
sun.shadow.bias = -.0003; sun.shadow.normalBias = .04;
scene.add(sun, sun.target);

// Ground
const isMarzamemi = circuit.theme === "marzamemi";
// Subdivided and depth-offset so the road/runoff strips lying millimetres
// above it always win: as two giant triangles its interpolated depth near
// the camera was coarse enough to swallow the asphalt at low view angles.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1400, 1400, 56, 56),
  new THREE.MeshStandardMaterial({ color: isMarzamemi ? 0xbfb48b : 0xb7c494, map: surfaceTexture(isMarzamemi ? "sand" : "grass", renderer), roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true; scene.add(ground);

// Road surface: triangle strip built from left/right edges of the centerline
function buildRoadMesh() {
  const positions = [];
  const uvs = [];
  const indices = [];
  const halfWidth = TRACK_WIDTH / 2;

  const samples = visualCenterline.length;
  const left = offsetEdge(visualCenterline, halfWidth);
  const right = offsetEdge(visualCenterline, -halfWidth);
  for (let i = 0; i <= samples; i++) {
    const a = left[i % samples], b = right[i % samples];
    positions.push(a.x, 0.01, a.z, b.x, 0.01, b.z);
    uvs.push(0,i / samples * trackCurve.getLength() / 12,1,i / samples * trackCurve.getLength() / 12);
  }

  for (let i = 0; i < samples; i++) {
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
// Pit lane (#147): beside the start/finish line, on the side of the pit
// building (track-art.js structure(0, 1)).
const pitLane = buildPitLane(visualCenterline, TRACK_WIDTH, 1);
dressCircuit(scene, centerline, TRACK_WIDTH, renderer, isRaining, circuit.theme, visualCenterline, pitLane);
dressPitLane(scene, pitLane, renderer, isRaining);

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
  const lineGroup = new THREE.Group();
  lineGroup.position.set(
    p.x + Math.sin(heading) * START_FINISH_OFFSET,
    0.02,
    p.z + Math.cos(heading) * START_FINISH_OFFSET
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
function buildCar(color, { detail = false } = {}) {
  return buildRaceCar(color, {
    scale: CAR_SCALE,
    environmentTexture: carEnvironment.texture,
    envMapIntensity: 0.65,
    detail,
  });
}

// Player car
const playerCar = buildCar(PLAYER_LIVERY);
// Make the player's car easier to read in chase view without changing the
// shared car geometry, wheel metadata, physics or collision dimensions.
playerCar.group.scale.multiplyScalar(PLAYER_VISUAL_SCALE);
scene.add(playerCar.group);
// Cockpit view (#139): an unbatched copy of the player's car, seen from
// inside the helmet; race-camera.js mirrors the player car onto it.
const cockpitCar = buildCar(PLAYER_LIVERY, { detail: true });
cockpitCar.group.scale.multiplyScalar(PLAYER_VISUAL_SCALE);
cockpitCar.group.visible = false;
scene.add(cockpitCar.group);

// Nine AI rivals in five colour pairs (teammates share a livery, like real
// F1 teams) plus the player makes a full ten-car grid. Colors matched to
// their championship driver ids in championship.js. All ten cars line up on
// a real starting grid behind the start/finish line instead of being
// scattered partway around the track already at speed — see
// startRaceCountdown() for the 3-2-1. Grid order itself comes from
// qualifying (see finishQualifying()), not this fixed identity order.
// Multiplayer (#44): the other real participants' reserved drivers, no AI
// padding for empty slots — a room with 3 people races with 3 cars total,
// a deliberate decision (see decisions.md). aiCars below carries these
// exactly like AI entries (same shape/fields), just driven by network
// samples in the main loop instead of updateAiCar().
const AI_DRIVERS = multiplayer
  ? multiplayer.getRemoteDrivers().map(({ participantId, driverId }) => ({
      id: driverId,
      participantId,
      livery: liveryById(DRIVER_ROSTER.find((d) => d.id === driverId).team),
    }))
  : DRIVER_ROSTER
      .filter((driver) => driver.id !== SELECTED_DRIVER_ID)
      .map((driver) => ({ id: driver.id, livery: liveryById(driver.team) }));

// --- DRS ---------------------------------------------------------------
//
// A short zone near the start/finish straight: a car within roughly one
// second of the car directly ahead gets a temporary top-speed boost while
// in the zone — the rubber-banding real DRS gives on a pit straight,
// simplified to no separate detection point and no manual button (this
// game has no extra input to spare for one).
const DRS_ZONE_FRACTION = 0.1; // first 10% of the lap, right after the line
const DRS_GAP_SECONDS = 1.0;
// +8% (~25 km/h): closer to real DRS than the old +15% (#151).
const DRS_SPEED_MULTIPLIER = 1.08;

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
    gridPosition: i + 2,
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
    lastImpactEffectTime: 0,
    lastCollisionTime: 0,
    // Multiplayer (#44): driven by network samples in update(), never by
    // updateAiCar() — see updateRemoteCar() further down. Always false/null
    // for solo play's real AI entries.
    isRemote: !!multiplayer,
    participantId: driver.participantId ?? null,
  };
});

// All 10 physical grid slots, pole first — used to place whoever ends up
// in each position once qualifying (below) decides the order. The visual
// grid-box markings further down are painted at these same fixed slots
// regardless of who ends up there, so they don't need this list themselves.
const ALL_GRID_SLOTS = [{ row: 0, lane: -1 }, ...AI_GRID_SLOTS];

// The AI only appears once the grid order is set (see finishQualifying) —
// during qualifying it's a solo flying lap, no traffic. Multiplayer (#44)
// is never a solo flying lap — every participant is really out there at
// once — so remote cars stay visible from the start.
if (!multiplayer) aiCars.forEach((car) => (car.group.visible = false));

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
// Solo qualifying starts from pole. In a room every participant is on track
// at once, so each one takes its own grid slot (#91) by its index in the
// server's participant list (same order on every client).
const QUALI_START_INDEX = Math.max(
  0,
  ROOM_PARTICIPANTS_WITH_DRIVER.findIndex((p) => p.participantId === multiplayer?.myParticipantId)
);
const QUALI_START_SLOT = ALL_GRID_SLOTS[Math.min(QUALI_START_INDEX, ALL_GRID_SLOTS.length - 1)];
const start = gridSlot(QUALI_START_SLOT.row, QUALI_START_SLOT.lane);
const state = {
  x: start.x,
  z: start.z,
  heading: start.heading,
  gridPosition: 1,
  speed: 0,
  lap: 0,
  completedLaps: 0,
  lapCheckpointPassed: false,
  lapStartTime: performance.now(),
  currentLapTime: 0,
  bestLapTime: null,
  prevRawProgress: nearestTrackInfo(start.x, start.z).idx / centerline.length,
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
  finishProgress: START_FINISH_OFFSET / TRACK_LENGTH,
  lapsPerRace: LAPS_PER_RACE,
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

// Populated below, only when the Agent API (#176) is active, so a real
// human session never pays for the indirection.
const humanInputListeners = [];
const { input, steering, updateSteeringInput, setExternalSteer } = setupRaceInput({
  onHumanInput: () => humanInputListeners.forEach((fn) => fn()),
});
setupRaceCommands({
  state,
  tyreCompounds: TYRE_COMPOUNDS,
  getRaceState: () => raceState,
});

// Gear mapping and synthesized engine/shift/grid-chorus audio live in
// race-audio.js. "grid" covers every moment the car is held on the line
// (qualifying's pit-exit light, the race's five red lights): the engine
// idles and the throttle free-revs it. "driving" is an actual flying lap
// or the race itself (#10: qualifying counts too).
const raceAudio = setupRaceAudio({
  getPhase: () => {
    if (sessionPhase === "qualifying") return qualiState === "running" ? "driving" : "grid";
    // The cool-down run past the flag (#157) keeps the in-gear, off-throttle
    // sound until the results fade in and coolDown() takes over.
    if (raceState === "racing" || raceState === "finished") return "driving";
    if (raceState === "countdown") return "grid";
    return "idle";
  },
  getThrottle: () => (input.forward ? 1 : 0),
});
const { updateEngineSound, playShiftClick, updateAmbientChorus } = raceAudio;
const updateExhaust = setupExhaustPops({
  carGroup: playerCar.group,
  state,
  input,
  maxSpeed: CAR.maxSpeed,
  gearInfo,
  playPop: raceAudio.playExhaustPop,
});

// --- HUD -----------------------------------------------------------------

// Weather badge stays on the circuit name in every phase; the "Qualifica"
// suffix only applies until the race itself starts (see finishQualifying).
function circuitLabel() {
  return isRaining ? `${circuit.name} · 🌧️ Pioggia` : circuit.name;
}

// Generated once: the tower and the real grid consume the same result set.
// Multiplayer (#44) has no synthesized set — multiplayerQualifyingRivals()
// below reads live participant times instead, since those change over the
// session; solo keeps this static list, built once.
const AI_QUALIFYING_RESULTS = multiplayer
  ? []
  : AI_DRIVERS.map((driver) => ({
      id: driver.id,
      name: displayDriverName(driver.id),
      time: synthesizeAiQualiTime(),
    })).sort((a, b) => a.time - b.time);

function multiplayerQualifyingRivals() {
  return multiplayer.getRemoteDrivers().map(({ participantId, driverId }) => {
    const participant = multiplayer.room.participants.find((p) => p.participantId === participantId);
    return { id: driverId, name: displayDriverName(driverId), time: participant?.qualiBestTime ?? Infinity };
  });
}

function isDriverDisconnected(driverId) {
  return multiplayer ? multiplayer.isDriverDisconnected(driverId) : false;
}

const brakeMap = setupBrakeMap({
  canvas: document.getElementById("brake-map"),
  centerline,
  centerlineStep,
  cornerTargetSpeed,
  usableBrake: CAR.brakeDecel * 0.8,
  state,
  aiCars,
  nearestTrackInfo,
});

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
  nameOf: displayDriverName,
  updateEngineSound,
  playShiftClick,
  updateAmbientChorus,
  qualifyingRivals: AI_QUALIFYING_RESULTS,
  getQualifyingRivals: multiplayer ? multiplayerQualifyingRivals : undefined,
  isDisconnected: isDriverDisconnected,
  getRaceState: () => raceState,
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
  pitLane,
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
  tireGripFactor,
  tyreSpeedFactor,
  drsSpeedMultiplier: DRS_SPEED_MULTIPLIER,
  ersSpeedMultiplier: ERS_SPEED_MULTIPLIER,
  cautionSpeedMultiplier,
});

function driverName(driverId) {
  return displayDriverName(driverId);
}

// Multiplayer results (#113): the server's finish order, the same for
// everyone, then whoever is still racing in their current running order.
// Re-rendered on every room update until the host calls a rematch, which
// sends everyone back to the lobby.
function renderMultiplayerResults(room) {
  if (room.sessionPhase === "lobby") return; // leaving for the lobby, below
  const localKey = (driverId) => (driverId === MY_ROOM_DRIVER_ID ? "player" : driverId);
  const racers = room.participants.filter((p) => p.driverId);
  const finished = racers.filter((p) => p.finishedAt).sort((a, b) => a.finishedAt - b.finishedAt);
  const finishedKeys = new Set(finished.map((p) => localKey(p.driverId)));
  const racerKeys = new Set(racers.map((p) => localKey(p.driverId)));
  const stillRacing = currentRaceOrder()
    .map((o) => o.driverId)
    .filter((key) => racerKeys.has(key) && !finishedKeys.has(key));
  const rows = [
    ...finished.map((p) => ({ key: localKey(p.driverId), done: true })),
    ...stillRacing.map((key) => ({ key, done: false })),
  ];
  const position = finished.findIndex((p) => localKey(p.driverId) === "player") + 1;
  document.getElementById("results-title").textContent =
    position === 1 ? "Vittoria!" : position > 0 ? `Arrivato ${position}°` : "Gara finita";
  document.getElementById("results-order").innerHTML = rows
    .map(({ key, done }, i) => `<li class="${key === "player" ? "is-player" : ""}"><span>${done ? `${i + 1}.` : "…"} ${driverName(key)}${done ? "" : " (in gara)"}</span></li>`)
    .join("");
  document.getElementById("results-points").textContent = `${finished.length}/${racers.length} arrivati`;
  const nextLink = document.getElementById("results-next");
  nextLink.textContent = multiplayer.isHost ? "Rivincita" : "In attesa della rivincita…";
}

// A rematch (#113) puts the room back in the lobby: everyone still on the
// race page, finished or not, follows it there.
if (multiplayer) {
  multiplayer.onRoomUpdate((room) => {
    if (room.sessionPhase !== "lobby") return;
    const params = new URLSearchParams();
    const roomServer = new URLSearchParams(location.search).get("roomServer");
    if (roomServer) params.set("roomServer", roomServer);
    location.href = `room.html${params.toString() ? `?${params}` : ""}`;
  });
}

// Past the chequered flag (#157) the car keeps rolling: the autopilot
// below lifts, brakes to a cruise and follows the track while the results
// wait, then fade in.
const FINISH_RESULTS_DELAY_MS = 2600;
const FINISH_COAST_SPEED = 25; // m/s (~90 km/h) before it only coasts
const FINISH_COAST_LOOKAHEAD = 12; // centerline samples ahead

function showResultsOverlay() {
  setTimeout(() => {
    raceAudio.coolDown();
    const overlay = document.getElementById("results-overlay");
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add("is-visible"));
  }, FINISH_RESULTS_DELAY_MS);
}

function driveFinishCoast() {
  const { idx } = nearestTrackInfo(state.x, state.z);
  const aim = centerline[(idx + FINISH_COAST_LOOKAHEAD) % centerline.length];
  let err = Math.atan2(aim.x - state.x, aim.z - state.z) - state.heading;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  const steer = Math.max(-1, Math.min(1, -err * 3));
  setExternalSteer(steer);
  steering.value = steer;
  input.forward = false;
  input.back = state.speed > FINISH_COAST_SPEED;
}

function finishRace() {
  raceState = "finished";
  if (multiplayer) {
    multiplayer.reportFinish();
    const nextLink = document.getElementById("results-next");
    nextLink.href = "#";
    nextLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (!multiplayer.isHost) return;
      nextLink.textContent = "Rivincita…";
      multiplayer.rematch().catch((err) => { nextLink.textContent = err.message; });
    });
    multiplayer.onRoomUpdate(renderMultiplayerResults);
    renderMultiplayerResults(multiplayer.room);
    showResultsOverlay();
    return;
  }
  const order = currentRaceOrder().map((o) => o.driverId);
  const position = order.indexOf("player") + 1;

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

  const nextLink = document.getElementById("results-next");
  // Solo only: multiplayer returned above with the room's shared results,
  // which never touch the solo championship.
  const state2 = recordRaceResult(circuit.id, order);
  const points = POINTS_BY_POSITION[position - 1] || 0;
  document.getElementById("results-points").textContent = `+${points} punti`;
  const nextCircuitId = getNextUnracedCircuitId(state2);
  if (nextCircuitId) {
    nextLink.href = `race.html?circuit=${nextCircuitId}`;
    nextLink.textContent = "Prossimo circuito";
  } else {
    nextLink.href = "index.html";
    nextLink.textContent = "Vedi classifica finale";
  }

  showResultsOverlay();
}

function getNextUnracedCircuitId(champState) {
  const raced = new Set(Object.keys(champState.raceResults));
  const next = CIRCUITS.find((c) => !raced.has(c.id));
  return next ? next.id : null;
}

const pitCrew = setupPitCrew({
  scene,
  pitLane,
  playerCar,
  suitColor: PLAYER_LIVERY.primary,
  serviceMs: PIT_SERVICE_MS,
});
const raceCamera = setupRaceCamera({
  scene,
  camera,
  state,
  playerCar,
  carMaxSpeed: CAR.maxSpeed,
  cockpitCar,
  nearestTrackInfo,
  trackWidth: TRACK_WIDTH,
  pitCamera: { position: pitCrew.tvCamera, target: pitCrew.tvTarget },
});
const raceNameplates = setupRaceNameplates({
  camera,
  mount: document.getElementById("driver-nameplates"),
  cars: aiCars,
  nameOf: displayDriverName,
  isDisconnected: isDriverDisconnected,
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
  tyreSpeedFactor,
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

// Multiplayer (#44): pulls a remote car toward the latest network sample
// instead of computing physics for it — client-authoritative, see
// decisions.md. Smoothed rather than snapped so a ~80ms broadcast interval
// doesn't read as choppy. advanceProgress() is still called with THIS
// client's own nearestTrackInfo() on the now-updated x/z, so lap/position
// bookkeeping for a remote car is derived the same deterministic way as
// everyone else's, not trusted from the sender's own claimed values.
const REMOTE_SMOOTH_FACTOR = 0.35;
const REMOTE_MAX_EXTRAPOLATION_S = 0.25; // a stalled stream stops the car soon
function updateRemoteCar(car, dt) {
  const sample = multiplayer.getRemoteSample(car.participantId);
  if (!sample) return; // no broadcast received yet — stays at its grid slot
  const t = Math.min(REMOTE_SMOOTH_FACTOR * dt * 60, 1);
  // Chase where the car is now, not where it was when the sample left
  // (#111): project it forward along its heading by the sample's age, so
  // it keeps moving between the ~12/s broadcasts instead of stalling.
  const ageS = sample.receivedAt ? Math.min((performance.now() - sample.receivedAt) / 1000, REMOTE_MAX_EXTRAPOLATION_S) : 0;
  const lead = (sample.speed || 0) * ageS;
  const targetX = sample.x + Math.sin(sample.heading) * lead;
  const targetZ = sample.z + Math.cos(sample.heading) * lead;
  car.x += (targetX - car.x) * t;
  car.z += (targetZ - car.z) * t;
  let dh = sample.heading - car.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  car.heading += dh * t;
  car.speed = sample.speed || 0;
  const info = nearestTrackInfo(car.x, car.z);
  advanceProgress(car, info.idx / centerline.length);
}

// Applies a decided qualifying result (grid order, pole first) and hands
// off to the race's own countdown. Solo computes that order itself, right
// below; multiplayer (#44) receives it from the server instead — see the
// multiplayer.onGridReady wiring below this function. Either way this one
// function is what actually starts the race once the order is known.
function applyQualifyingResult(order) {
  applyGridPositions(order);
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
  startRaceCountdown(multiplayer ? multiplayer.room.raceStartedAt : null);
}

// Ends the qualifying session: combines the player's best flying lap (or
// no time at all, if they never completed one — same as a real DNF in
// qualifying, sent to the back) with synthesized AI times, sorts fastest
// first. Solo only — multiplayer's qualifying end is server-timed (see
// below), never triggered from this client's own local countdown, so two
// participants' browsers can't end qualifying at slightly different
// moments.
function finishQualifying() {
  const results = [
    { id: "player", time: qualiBestTime === null ? Infinity : qualiBestTime },
    ...AI_QUALIFYING_RESULTS.map(({ id, time }) => ({ id, time })),
  ];
  results.sort((a, b) => a.time - b.time);
  applyQualifyingResult(results.map((r) => r.id));
}

// Deferred to after this module finishes evaluating: on a reload mid-race
// the grid is already known, onGridReady fires synchronously, and the
// start procedure it triggers reads engine-gate state declared further down.
if (multiplayer) queueMicrotask(() => {
  multiplayer.onGridReady((driverIds) => {
    // The server's grid lists real participants by their reserved
    // driverId — "player" (this browser's own car) isn't one of those
    // entries, since applyGridPositions/currentRaceOrder key the local car
    // as "player" internally. Translate this participant's own driverId
    // back to "player"; every other entry is already what the
    // corresponding remote aiCars entry is keyed by.
    const myDriverId = multiplayer.room.participants.find(
      (p) => p.participantId === multiplayer.myParticipantId
    )?.driverId;
    applyQualifyingResult(driverIds.map((id) => (id === myDriverId ? "player" : id)));
  });
});

function updateQualifying(dt) {
  const now = performance.now();

  if (qualiState === "countdown") {
    // Car sits frozen at the line until the lights go out, same as the
    // race's own grid start.
    applyCarToMesh(playerCar, state.x, state.z, state.heading, 0, dt, steering.value);
    if (multiplayer) {
      for (const car of aiCars) {
        updateRemoteCar(car, dt);
        applyCarToMesh(car, car.x, car.z, car.heading, car.speed, dt);
      }
    }
    raceCamera.updateCamera(dt);
    hud.updateQualifyingHud(qualiTimeRemainingMs, qualiBestTime);
    return;
  }

  const info = integratePlayerMotion(dt);
  applyCarToMesh(playerCar, state.x, state.z, state.heading, state.speed, dt, steering.value);
  brakeMap();

  // Multiplayer (#44): other participants are really out on track during
  // qualifying too (no solo flying lap here), driven by network samples;
  // this client also broadcasts its own state every frame (throttled
  // internally — see race-multiplayer.js).
  if (multiplayer) {
    for (const car of aiCars) {
      updateRemoteCar(car, dt);
      applyCarToMesh(car, car.x, car.z, car.heading, car.speed, dt);
    }
    multiplayer.broadcastState({ x: state.x, z: state.z, heading: state.heading, speed: state.speed });
  }

  // Multiple flying laps are allowed within the session — only the best
  // one counts, same as a real qualifying hour.
  const justCompletedLap = advanceProgress(state, info.idx / centerline.length);
  if (justCompletedLap) {
    const lapTime = now - state.lapStartTime;
    if (qualiBestTime === null || lapTime < qualiBestTime) {
      qualiBestTime = lapTime;
      if (multiplayer) multiplayer.reportQualiTime(lapTime);
    }
    state.lapStartTime = now;
  }
  state.currentLapTime = now - state.lapStartTime;

  qualiTimeRemainingMs = Math.max(0, qualiTimeRemainingMs - dt * 1000);

  raceCamera.updateCamera(dt);
  raceCamera.updateSpeedFov(dt);
  hud.updateQualifyingHud(qualiTimeRemainingMs, qualiBestTime);

  // Multiplayer's qualifying end is server-timed (see the
  // multiplayer.onGridReady wiring above finishQualifying) so every client
  // transitions together off the same clock — this browser's own
  // countdown reaching zero must not also end qualifying itself.
  if (!multiplayer && qualiTimeRemainingMs <= 0) finishQualifying();
}

function update(dt) {
  if (sessionPhase === "qualifying") {
    updateQualifying(dt);
    return;
  }

  if (raceState === "countdown") {
    // Cars sit frozen on the grid until the lights go out.
    applyCarToMesh(playerCar, state.x, state.z, state.heading, 0, dt, steering.value);
    for (const car of aiCars) applyCarToMesh(car, car.x, car.z, car.heading, 0, dt);
    raceCamera.updateCamera(dt);
    hud.updateHud();
    return;
  }

  const now = performance.now();
  if (raceState === "finished") driveFinishCoast();
  else if (state.pitRequested) raceSystems.startPitStop();

  updateDrsEligibility([state, ...aiCars]);
  raceSystems.updateEnergyRecovery([state, ...aiCars], dt);

  // In the pit lane (#147) the autopilot drives the player and the rest of
  // the field keeps racing; no player physics, grass drag or contact.
  const inPit = raceSystems.updatePitStop(now, dt);
  const info = inPit ? nearestTrackInfo(state.x, state.z) : integratePlayerMotion(dt);
  // Pit limiter (#145): it used to sit in the qualifying loop only, where
  // the race-state guard made it a no-op.
  if (!inPit) raceSystems.applyPitLimiter(dt);
  const allCars = [state, ...aiCars];
  // Multiplayer (#44): remote cars are driven by the latest network sample
  // (updateRemoteCar), never by updateAiCar() — see race-multiplayer.js.
  for (const car of aiCars) {
    if (car.isRemote) updateRemoteCar(car, dt);
    else updateAiCar(car, dt, allCars);
  }
  if (multiplayer) {
    multiplayer.broadcastState({
      x: state.x, z: state.z, heading: state.heading, speed: state.speed,
      lap: state.lap, totalProgress: state.totalProgress,
    });
  }
  carCollisions.resolve(inPit ? aiCars : allCars, now);

  applyCarToMesh(playerCar, state.x, state.z, state.heading, state.speed, dt, inPit ? 0 : steering.value);
  pitCrew.update(state, now);
  brakeMap();
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

// --- Engine fire-up gate -------------------------------------------------
//
// Browsers block audio until a user gesture, and the engine has to be
// heard on the grid before the start — so no start procedure begins until
// the player fires the engine up (any key or tap). ?agent=1 skips the gate:
// an external agent has no gesture to give and doesn't need sound.
const isAgentSession = new URLSearchParams(location.search).get("agent") === "1";
const engineGateEl = document.getElementById("engine-gate");
const ENGINE_FIREUP_MS = 1200; // let the fire-up be heard before the lights
let engineArmed = false;
let engineReady = isAgentSession;
const engineReadyQueue = [];

function whenEngineReady(fn) {
  if (engineReady) fn();
  else engineReadyQueue.push(fn);
}

function armEngine() {
  if (engineArmed) return;
  engineArmed = true;
  raceAudio.arm();
  // Race voice chat (#1): same gesture, so the mic prompt is allowed.
  if (multiplayer) multiplayer.startVoice();
  // A pad button is not a user activation, so the audio context may start
  // suspended: resume it on the next real key or tap.
  window.addEventListener("keydown", () => raceAudio.arm(), { once: true });
  window.addEventListener("pointerdown", () => raceAudio.arm(), { once: true });
  engineGateEl.hidden = true;
  window.removeEventListener("keydown", armEngine);
  window.removeEventListener("pointerdown", armEngine);
  setTimeout(() => {
    engineReady = true;
    engineReadyQueue.splice(0).forEach((fn) => fn());
  }, ENGINE_FIREUP_MS);
}

if (!isAgentSession) {
  engineGateEl.hidden = false;
  window.addEventListener("keydown", armEngine);
  window.addEventListener("pointerdown", armEngine);
}

// --- Start procedures ----------------------------------------------------
//
// Race: the F1 standing start. Five red lights come on one per second;
// after the fifth, a random hold, then all five go out together — lights
// out IS the start, there is no green light. Qualifying has no standing
// start in real F1: the session opens when the pit-exit light turns from
// red to green, so that's what the qualifying launch shows.
//
// In multiplayer the random hold is seeded from the server's own
// raceStartedAt, so every participant's lights go out after the same
// delay instead of each browser rolling its own — otherwise one player
// could get a free head start of up to ~3s.
const startLightsEl = document.getElementById("start-lights");
const LIGHT_INTERVAL_MS = 1000;
const LIGHTS_OUT_MIN_MS = 200;
const LIGHTS_OUT_MAX_MS = 3000;
const PIT_EXIT_RED_MS = 1800;

function seededUnit(seed) {
  let t = (Math.floor(seed) >>> 0) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Each start sequence gets an id; a newer one (e.g. multiplayer's server
// grid arriving while qualifying's pit-exit light is still red) makes any
// older sequence's pending timers no-ops, so they can't hide or overwrite
// the gantry the new sequence is using.
let startSequenceId = 0;

function showGantry(podCount, caption) {
  startSequenceId++;
  startLightsEl.innerHTML = `
    <div class="start-lights-gantry">${'<span class="start-light-pod"><i></i><i></i></span>'.repeat(podCount)}</div>
    <p class="start-lights-caption">${caption}</p>`;
  startLightsEl.classList.remove("is-leaving");
  startLightsEl.hidden = false;
  return [...startLightsEl.querySelectorAll(".start-light-pod")];
}

function hideGantry(afterMs) {
  const id = startSequenceId;
  setTimeout(() => {
    if (id !== startSequenceId) return;
    startLightsEl.classList.add("is-leaving");
    setTimeout(() => {
      if (id === startSequenceId) startLightsEl.hidden = true;
    }, 400);
  }, afterMs);
}

// anchorMs (optional, Date.now() clock): when the sequence starts, so
// several browsers can share one timeline (#109). A late start (engine
// fired up after the anchor) joins the sequence where it already is, and
// goes at once if the lights are already out. Without it the sequence
// starts now.
function runRaceStartLights(seed, onGo, anchorMs = null) {
  const pods = showGantry(5, "");
  const id = startSequenceId;
  const unit = seed == null ? Math.random() : seededUnit(seed);
  const hold = LIGHTS_OUT_MIN_MS + unit * (LIGHTS_OUT_MAX_MS - LIGHTS_OUT_MIN_MS);
  const anchor = anchorMs ?? Date.now();
  const lightAt = (k) => anchor + k * LIGHT_INTERVAL_MS; // k = 1..5
  const outAt = lightAt(pods.length) + hold;
  const wait = (at) => Math.max(0, at - Date.now());
  raceAudio.setGridIntensity(0.25);
  pods.forEach((pod, i) => {
    setTimeout(() => {
      if (id !== startSequenceId) return;
      pod.classList.add("is-red");
      // The whole field builds revs as the lights come on.
      raceAudio.setGridIntensity(0.25 + (i + 1) * 0.15);
    }, wait(lightAt(i + 1)));
  });
  setTimeout(() => {
    if (id !== startSequenceId) return;
    pods.forEach((pod) => pod.classList.remove("is-red"));
    onGo();
    hideGantry(900);
  }, wait(outAt));
}

function runPitExitLight(onGo) {
  const pods = showGantry(1, "Uscita box");
  const id = startSequenceId;
  pods[0].classList.add("is-red");
  setTimeout(() => {
    if (id !== startSequenceId) return;
    pods[0].classList.remove("is-red");
    pods[0].classList.add("is-green");
    startLightsEl.querySelector(".start-lights-caption").textContent = "Pista aperta";
    onGo();
    hideGantry(1200);
  }, PIT_EXIT_RED_MS);
}

function startQualifyingCountdown() {
  whenEngineReady(() => runPitExitLight(() => {
    state.lapStartTime = performance.now();
    qualiState = "running";
  }));
}

// Multiplayer: the lights start this long after the server's
// raceStartedAt, on the server clock, the same for every participant —
// time to load the race page and fire the engine up (#109).
const MP_START_LEAD_MS = 8000;

function startRaceCountdown(seed = null) {
  const anchorMs = multiplayer && seed != null
    ? seed + MP_START_LEAD_MS - (multiplayer.serverNow() - Date.now())
    : null;
  whenEngineReady(() => runRaceStartLights(seed, () => {
    // state.lapStartTime is reset to the moment the lights go out, not
    // construction time, so the on-screen lap clock doesn't start ticking
    // during the start sequence itself.
    state.lapStartTime = performance.now();
    raceState = "racing";
  }, anchorMs));
}

const frameGate = createFrameLimiter(graphicsProfile.frameCapFps);

function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  if (!frameGate(now)) return;
  const dt = Math.min(clock.getDelta(), 0.1);
  updateSteeringInput(dt, Math.abs(state.speed) / CAR.maxSpeed);
  update(dt);
  updateExhaust(dt);
  raceNameplates.update();
  updateWeather(dt); // sparks, rain and cloud drift; always runs regardless of session phase
  sun.position.set(state.x + 30, 55, state.z + 25);
  sun.target.position.set(state.x, 0, state.z);
  renderer.render(scene, camera);
  diagnostics.update(dt);
}

// Agent API (#176): opt-in only, via ?agent=1, so normal play is untouched.
if (isAgentSession) {
  const agentApi = setupAgentApi({
    state,
    aiCars,
    input,
    setExternalSteer,
    centerline,
    headingOf,
    sideNormal,
    nearestTrackInfo,
    currentRaceOrder,
    trackLength: TRACK_LENGTH,
    grassLimit: GRASS_LIMIT,
    lapsPerRace: LAPS_PER_RACE,
    tyreLifeLaps: TYRE_LIFE_LAPS,
    getSessionPhase: () => sessionPhase,
    getRaceState: () => raceState,
    getQualiState: () => qualiState,
  });
  humanInputListeners.push(agentApi.onHumanInput);
}

startQualifyingCountdown();
animate();
