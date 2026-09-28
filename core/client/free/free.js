// Free drive (#274): one car on a wide banked oval, nothing else — no rivals,
// no qualifying, no race, no lap limit, no results. Separate page from the
// race (race.html) and from multiplayer, on purpose: it shares the physics,
// input, camera and car model, not the session flow.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { loadSelectedDriverId } from "../shared/driver-selection.js?v=2";
import { loadGarageSetup, playerLivery, setupEffects } from "../shared/garage-setup.js?v=30";
import { createStudioEnvironment } from "../shared/car-model.js?v=36";
import { applyCarToMesh, buildRaceCar } from "../race/race-car-view.js?v=38";
import { offsetEdge } from "../shared/track-geometry.js?v=39";
import { setupRaceInput } from "../race/race-input.js?v=58";
import { setupRaceCamera } from "../race/race-camera.js?v=39";
import { gearInfo, setupRaceAudio } from "../race/race-audio.js?v=3";
import { surfaceTexture } from "../race/track-art.js?v=43";
import { loadGraphicsProfile, createFrameLimiter } from "../shared/graphics-profiles.js?v=4";
import { FREE_OVAL } from "./oval.js?v=1";
import { createFreeSim } from "./free-sim.js?v=1";

const CAR_SCALE = 0.55;
const PLAYER_VISUAL_SCALE = 1.25;
const KMH_PER_UNIT = 3.6;
const WALL_HEIGHT = 1.3;

const circuit = FREE_OVAL;
const graphicsProfile = loadGraphicsProfile();
const effects = setupEffects(loadGarageSetup());
const livery = playerLivery(loadSelectedDriverId());

// --- Scene ------------------------------------------------------------------
const scene = new THREE.Scene();
const SKY_HORIZON = 0xbfe0f5;
const SKY_ZENITH = 0x1e5fc0;
scene.background = new THREE.Color(SKY_HORIZON);
scene.fog = new THREE.Fog(SKY_HORIZON, 150, 420);
{
  const geometry = new THREE.SphereGeometry(700, 24, 16);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const zenith = new THREE.Color(SKY_ZENITH);
  const horizon = new THREE.Color(SKY_HORIZON);
  const blended = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp(position.getY(i) / 700, 0, 1);
    blended.copy(horizon).lerp(zenith, Math.pow(t, 0.6));
    colors.set([blended.r, blended.g, blended.b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
}

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: graphicsProfile.antialias });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = graphicsProfile.shadowsEnabled;
renderer.shadowMap.type = graphicsProfile.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphicsProfile.dprCap));
document.getElementById("app").appendChild(renderer.domElement);
const carEnvironment = createStudioEnvironment(renderer);
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(new THREE.HemisphereLight(0xd3e1ee, 0x596044, 1.8));
const sun = new THREE.DirectionalLight(0xffedcf, 2.6);
sun.position.set(80, 120, 40);
sun.castShadow = graphicsProfile.shadowsEnabled;
sun.shadow.mapSize.set(graphicsProfile.shadowMapSize, graphicsProfile.shadowMapSize);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 160 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1600, 1600, 56, 56),
  new THREE.MeshStandardMaterial({ color: 0xb7c494, map: surfaceTexture("grass", renderer), roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- Controls and simulation -------------------------------------------------
const { input, steering, updateSteeringInput } = setupRaceInput();
const curve = new THREE.CatmullRomCurve3(circuit.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, "catmullrom", circuit.curveTension);
const sim = createFreeSim({ circuit, curve, effects, input, steering });
const { state, banking, visualCenterline } = sim;

// --- Banked road ---------------------------------------------------------------
const half = circuit.width / 2;
const samples = visualCenterline.length;
const lapLength = sim.trackLength;
const edgeCache = new Map();
function edgeAt(d) {
  if (!edgeCache.has(d)) edgeCache.set(d, offsetEdge(visualCenterline, d));
  return edgeCache.get(d);
}
// Road height at visual sample j and lateral offset d (banking.js).
const roadY = (j, d) => banking.heightAt(banking.slopeAtFraction(j / samples), d);

function toMesh(positions, uvs, indices, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

// Strips along the centerline between lateral offsets d1 > d2 (same winding
// as the race road), each `lift` above the banked surface; `from`/`to` are
// visual sample indices.
function stripMesh(pieces, material) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (const { from, to, d1, d2, lift } of pieces) {
    const a = edgeAt(d1);
    const b = edgeAt(d2);
    const first = positions.length / 3;
    for (let j = from; j <= to; j++) {
      const k = j % samples;
      const v = (j / samples) * lapLength / 12;
      positions.push(a[k].x, roadY(j, d1) + lift, a[k].z, b[k].x, roadY(j, d2) + lift, b[k].z);
      uvs.push(0, v, 1, v);
    }
    for (let j = 0; j < to - from; j++) {
      const i = first + j * 2;
      indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  return toMesh(positions, uvs, indices, material);
}

// Vertical wall along the edge at offset d, from the ground up to the road
// edge plus a barrier: on the high side of a banked turn it doubles as the
// embankment under the road.
function wallMesh(d, material) {
  const edge = edgeAt(d);
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let j = 0; j <= samples; j++) {
    const k = j % samples;
    const top = roadY(j, d) + WALL_HEIGHT;
    positions.push(edge[k].x, 0, edge[k].z, edge[k].x, top, edge[k].z);
    const v = (j / samples) * lapLength / 12;
    uvs.push(0, v, top / 6, v);
  }
  for (let j = 0; j < samples; j++) {
    const i = j * 2;
    indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }
  const mesh = toMesh(positions, uvs, indices, material);
  mesh.receiveShadow = false;
  return mesh;
}

const asphalt = new THREE.MeshStandardMaterial({
  color: 0x999b9e, map: surfaceTexture("asphalt", renderer), roughness: 0.91, metalness: 0.03,
  envMap: carEnvironment.texture, envMapIntensity: 0.04,
});
const paint = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
const concrete = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.95, side: THREE.DoubleSide });

scene.add(stripMesh([{ from: 0, to: samples, d1: half, d2: -half, lift: 0.01 }], asphalt));
scene.add(stripMesh([
  { from: 0, to: samples, d1: half - 0.7, d2: half - 1.2, lift: 0.03 },
  { from: 0, to: samples, d1: -(half - 1.2), d2: -(half - 0.7), lift: 0.03 },
], paint));
{
  const dashes = [];
  for (let j = 0; j < samples; j += 24) dashes.push({ from: j, to: Math.min(j + 12, samples), d1: 0.25, d2: -0.25, lift: 0.03 });
  scene.add(stripMesh(dashes, paint));
}
// Start/finish line across the road, on the first straight.
scene.add(stripMesh([{ from: 0, to: 3, d1: half, d2: -half, lift: 0.03 }], paint));
scene.add(wallMesh(half, concrete), wallMesh(-half, concrete));

// --- Car -------------------------------------------------------------------------
function buildCar(detail) {
  const model = buildRaceCar(livery, {
    scale: CAR_SCALE, environmentTexture: carEnvironment.texture, envMapIntensity: 0.65, detail,
  });
  model.group.scale.multiplyScalar(PLAYER_VISUAL_SCALE);
  model.group.rotation.order = "YXZ"; // heading, then pitch, then roll
  scene.add(model.group);
  return model;
}
const playerCar = buildCar(false);
const cockpitCar = buildCar(true);
cockpitCar.group.visible = false;

// Banked pose (free-sim.js): the physics stays 2D, the car rides the road.
function poseCar() {
  applyCarToMesh(playerCar, state.x, state.z, state.heading, state.speed, dt, steering.value);
  playerCar.group.position.y = state.y;
  playerCar.group.rotation.x = -state.pitch;
  playerCar.group.rotation.z = state.roll;
}

const raceCamera = setupRaceCamera({
  scene, camera, state, playerCar,
  carMaxSpeed: sim.car.maxSpeed,
  cockpitCar,
  nearestTrackInfo: sim.nearestTrackInfo,
  trackWidth: circuit.width,
  lookSurface: renderer.domElement,
});

// --- Engine sound: armed by the first key or tap (browsers block audio before) ---
const raceAudio = setupRaceAudio({ getPhase: () => "driving", getThrottle: () => (input.forward ? 1 : 0) });
let audioArmed = false;
function armAudio() {
  if (audioArmed) return;
  audioArmed = true;
  raceAudio.arm();
  window.addEventListener("keydown", () => raceAudio.arm(), { once: true });
  window.addEventListener("pointerdown", () => raceAudio.arm(), { once: true });
  window.removeEventListener("keydown", armAudio);
  window.removeEventListener("pointerdown", armAudio);
}
window.addEventListener("keydown", armAudio);
window.addEventListener("pointerdown", armAudio);

// Leave with Esc, like the on-screen link.
window.addEventListener("keydown", (event) => {
  if (event.code === "Escape") location.href = "index.html";
});

// --- HUD ---------------------------------------------------------------------------
const speedEl = document.getElementById("speed-value");
const speedFillEl = document.getElementById("speed-fill");
const gearEl = document.getElementById("gear-value");
const bankEl = document.getElementById("bank-value");
let lastGear = null;
function updateHud() {
  const ratio = Math.abs(state.speed) / sim.car.maxSpeed;
  speedEl.textContent = String(Math.round(Math.abs(state.speed) * KMH_PER_UNIT));
  speedFillEl.style.width = `${Math.min(ratio, 1) * 100}%`;
  const { gear, rpmRatio } = gearInfo(ratio);
  const label = Math.abs(state.speed) < 0.6 ? "N" : state.speed < 0 ? "R" : String(gear);
  if (label !== lastGear) {
    gearEl.textContent = label;
    if (lastGear !== null) raceAudio.playShiftClick();
    lastGear = label;
  }
  raceAudio.updateEngineSound(ratio, rpmRatio);
  const bankDeg = Math.round(Math.abs(state.bank) * 57.2958);
  bankEl.textContent = bankDeg >= 2 ? `Sopraelevata ${bankDeg}°` : "Rettilineo";
}

// --- Loop --------------------------------------------------------------------------
const clock = new THREE.Clock();
const frameGate = createFrameLimiter(graphicsProfile.frameCapFps);
let dt = 0;
function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  if (!frameGate(now)) return;
  dt = Math.min(clock.getDelta(), 0.1);
  updateSteeringInput(dt);
  sim.step(dt);
  poseCar();
  raceCamera.updateCamera(dt);
  raceCamera.updateSpeedFov(dt);
  updateHud();
  sun.position.set(state.x + 30, state.y + 55, state.z + 25);
  sun.target.position.set(state.x, state.y, state.z);
  renderer.render(scene, camera);
}
animate();
