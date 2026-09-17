import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/*
 * F1 Racer — v1 (time trial, no opponents yet).
 * Placeholder car/track geometry: primitives, not real models.
 * Track is a procedural "stadium" oval (two straights + two semicircles).
 *
 * Heading convention used throughout: heading 0 means "facing world +Z",
 * and moving forward means dx = sin(heading), dz = cos(heading). Every
 * track-heading and normal computed below is derived to stay consistent
 * with that convention.
 */

const TRACK = {
  straight: 100, // length of each straight
  radius: 35, // corner radius (centerline)
  width: 14, // road width
};
TRACK.perimeter = 2 * TRACK.straight + 2 * Math.PI * TRACK.radius;

const CAR = {
  maxSpeed: 45,
  reverseMaxSpeed: -15,
  accel: 25,
  brakeDecel: 40,
  coastDecel: 15,
  maxTurnRate: 2.4, // rad/s at full speed
};

// --- Track centerline sampling -------------------------------------------

// Returns {x, z, heading} for a distance `d` (0..perimeter) along the track,
// built from two straights (at z = +radius / -radius) joined by semicircles.
// `heading` is the direction of travel for increasing `d`, in the (sin, cos)
// convention above.
function trackPointAt(d) {
  const { straight, radius } = TRACK;
  const halfStraight = straight / 2;
  const halfCircle = Math.PI * radius;

  let s = ((d % TRACK.perimeter) + TRACK.perimeter) % TRACK.perimeter;

  if (s < straight) {
    // top straight, x: -half..+half, z = +radius, travelling toward +x
    return { x: -halfStraight + s, z: radius, heading: Math.PI / 2 };
  }
  s -= straight;

  if (s < halfCircle) {
    // right semicircle, center (+halfStraight, 0), a: +90deg -> -90deg
    const a = Math.PI / 2 - s / radius;
    return {
      x: halfStraight + radius * Math.cos(a),
      z: radius * Math.sin(a),
      heading: Math.PI - a,
    };
  }
  s -= halfCircle;

  if (s < straight) {
    // bottom straight, x: +half..-half, z = -radius, travelling toward -x
    return { x: halfStraight - s, z: -radius, heading: -Math.PI / 2 };
  }
  s -= straight;

  // left semicircle, center (-halfStraight, 0), b: -90deg -> -270deg
  const b = -Math.PI / 2 - s / radius;
  return {
    x: -halfStraight + radius * Math.cos(b),
    z: radius * Math.sin(b),
    heading: Math.PI - b,
  };
}

const CENTERLINE_SAMPLES = 240;
const centerline = [];
for (let i = 0; i < CENTERLINE_SAMPLES; i++) {
  centerline.push(trackPointAt((i / CENTERLINE_SAMPLES) * TRACK.perimeter));
}

function closestProgress(x, z) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < centerline.length; i++) {
    const p = centerline[i];
    const dx = p.x - x;
    const dz = p.z - z;
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx / centerline.length;
}

// Unit vector perpendicular to the direction of travel at a track point.
function sideNormal(p) {
  return { x: Math.cos(p.heading), z: -Math.sin(p.heading) };
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
  new THREE.PlaneGeometry(1000, 1000),
  new THREE.MeshStandardMaterial({ color: 0x0c3d1a, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Road surface: triangle strip built from left/right edges of the centerline
function buildRoadMesh() {
  const positions = [];
  const indices = [];
  const halfWidth = TRACK.width / 2;

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
  const halfWidth = TRACK.width / 2 + 0.6;
  const barrierMaterial = new THREE.MeshStandardMaterial({ color: 0xdd2222 });
  const step = 6;

  for (let i = 0; i < centerline.length; i += step) {
    const p = centerline[i];
    const n = sideNormal(p);

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
      box.rotation.y = p.heading;
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
  lineGroup.rotation.y = p.heading;

  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK.width, 2),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  line.rotation.x = -Math.PI / 2;
  lineGroup.add(line);
  scene.add(lineGroup);
}

// Car (placeholder box car; local +Z is "front")
const car = new THREE.Group();
const body = new THREE.Mesh(
  new THREE.BoxGeometry(1.8, 0.6, 3.6),
  new THREE.MeshStandardMaterial({ color: 0xe10600 })
);
body.position.y = 0.5;
car.add(body);
const cockpit = new THREE.Mesh(
  new THREE.BoxGeometry(0.9, 0.4, 1.2),
  new THREE.MeshStandardMaterial({ color: 0x111318 })
);
cockpit.position.set(0, 0.85, 0.3);
car.add(cockpit);
scene.add(car);

// --- State -------------------------------------------------------------

const start = centerline[0];
const state = {
  x: start.x,
  z: start.z,
  heading: start.heading,
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
  const progress = closestProgress(state.x, state.z);
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

  // Apply to car mesh
  car.position.set(state.x, 0, state.z);
  car.rotation.y = state.heading;

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
