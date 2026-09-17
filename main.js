import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/*
 * F1 Racer — v1 (time trial; two AI cars for company, not scored/raced).
 * Placeholder car/track geometry: primitives, not real models.
 * Track is a closed Catmull-Rom spline through hand-placed control points
 * (irregular loop, not a symmetric oval) — validated offline for minimum
 * curvature radius and self-intersection before shipping.
 *
 * Heading convention used throughout: heading 0 means "facing world +Z",
 * and moving forward means dx = sin(heading), dz = cos(heading).
 */

const TRACK_WIDTH = 14;
const CONTROL_POINTS = [
  [-100, 65], [30, 80], [100, 40], [90, -30], [40, -80], [-50, -95],
  [-120, -50], [-135, 10],
].map(([x, z]) => new THREE.Vector3(x, 0, z));

const trackCurve = new THREE.CatmullRomCurve3(CONTROL_POINTS, true, "catmullrom", 0.5);

const CAR = {
  maxSpeed: 45,
  reverseMaxSpeed: -15,
  accel: 25,
  brakeDecel: 40,
  coastDecel: 15,
  maxTurnRate: 2.4, // rad/s at full speed
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

// Two AI cars driving the track for company (not raced/scored against).
const AI_COLORS = [0x1c5fd6, 0xe6c229];
const AI_START_OFFSETS = [70, 200]; // centerline sample offsets, staggered
const aiCars = AI_COLORS.map((color, i) => {
  const model = buildCar(color);
  scene.add(model.group);
  const startIdx = AI_START_OFFSETS[i];
  const p = centerline[startIdx];
  return {
    ...model,
    x: p.x,
    z: p.z,
    heading: headingOf(p),
    speed: AI.maxSpeed * 0.6,
  };
});

// --- State -------------------------------------------------------------

const start = centerline[0];
const state = {
  x: start.x,
  z: start.z,
  heading: headingOf(start),
  speed: 0,
  lap: 0,
  lapStartTime: performance.now(),
  currentLapTime: 0,
  bestLapTime: null,
  prevProgress: 0,
};

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
bindHoldButton("btn-left", "left");
bindHoldButton("btn-right", "right");
bindHoldButton("btn-gas", "forward");
bindHoldButton("btn-brake", "back");

// --- HUD -----------------------------------------------------------------

const lapEl = document.getElementById("lap");
const timeEl = document.getElementById("time");
const bestEl = document.getElementById("best");

function formatTime(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}

function updateHud() {
  lapEl.textContent = `Giro ${state.lap}`;
  timeEl.textContent = `Tempo ${formatTime(state.currentLapTime)}`;
  bestEl.textContent = state.bestLapTime
    ? `Migliore ${formatTime(state.bestLapTime)}`
    : "Migliore --:--.--";
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
    car.x = info.x + nx * WALL_LIMIT;
    car.z = info.z + nz * WALL_LIMIT;
    car.speed *= WALL_BOUNCE_SPEED_FACTOR;
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
  applyTrackBoundary(car, dt);
}

function update(dt) {
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

  // Steering (disabled when nearly stationary; direction flips in reverse)
  const speedFactor = Math.min(Math.abs(state.speed) / CAR.maxSpeed, 1);
  const turnRate = CAR.maxTurnRate * (0.35 + 0.65 * speedFactor);
  const steerSign = state.speed >= 0 ? 1 : -1;
  if (Math.abs(state.speed) > 0.05) {
    if (input.left) state.heading += turnRate * dt * steerSign;
    if (input.right) state.heading -= turnRate * dt * steerSign;
  }

  // Integrate position (matches the heading convention used by the track)
  state.x += Math.sin(state.heading) * state.speed * dt;
  state.z += Math.cos(state.heading) * state.speed * dt;

  // Lap detection: watch progress wrap around the start/finish line
  const info = nearestTrackInfo(state.x, state.z);
  const progress = info.idx / centerline.length;
  if (state.prevProgress > 0.85 && progress < 0.15) {
    const now = performance.now();
    const lapTime = now - state.lapStartTime;
    if (state.lap > 0) {
      if (state.bestLapTime === null || lapTime < state.bestLapTime) {
        state.bestLapTime = lapTime;
      }
    }
    state.lap += 1;
    state.lapStartTime = now;
  }
  state.prevProgress = progress;
  state.currentLapTime = performance.now() - state.lapStartTime;

  applyTrackBoundary(state, dt, info);
  for (const car of aiCars) updateAiCar(car, dt);
  resolveCarCollisions([state, ...aiCars]);

  applyToMesh(playerCar, state.x, state.z, state.heading, state.speed, dt);
  for (const car of aiCars) applyToMesh(car, car.x, car.z, car.heading, car.speed, dt);

  // Chase camera: behind and above the car, looking slightly ahead of it
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

  updateHud();
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
