import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// Atmosphere: sky cloud billboards, a lightweight rain particle field and
// impact spark FX. Nothing outside main.js references any of this — self
// contained down to its own scene objects, so it moves as one block.

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

function buildClouds(scene, isRaining) {
  const cloudGroup = new THREE.Group();
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
  return cloudGroup;
}

// Rain is a lightweight world-space particle field, kept deliberately small
// so the game remains comfortable on mobile GPUs. Particles are recycled
// around the player instead of allocating new objects every frame.
function buildRain(scene, isRaining) {
  const rainCount = isRaining ? 850 : 0;
  if (!isRaining) return { rainCount, rainPoints: null, rainPositions: null };

  const rainPositions = new Float32Array(rainCount * 3);
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
  const rainPoints = new THREE.Points(geometry, material);
  scene.add(rainPoints);
  return { rainCount, rainPoints, rainPositions };
}

// `getPlayerState` is a getter rather than the player state object itself:
// this runs at module init, before main.js's own `state` exists yet, and
// only needs it later, once updateWeather()'s updateRain() is actually
// called each frame — same TDZ-safe pattern main.js already uses for
// `getRaceState`.
export function setupRaceWeather({ scene, isRaining, getPlayerState }) {
  const cloudGroup = buildClouds(scene, isRaining);
  const { rainCount, rainPoints, rainPositions } = buildRain(scene, isRaining);
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
    const player = getPlayerState();
    const px = player.x;
    const pz = player.z;
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

  // Runs every animation frame regardless of session phase, same as before.
  function updateWeather(dt) {
    updateImpactSparks(dt);
    updateRain(dt);
    cloudGroup.rotation.y += dt * 0.004; // slow drift
  }

  return { spawnImpactSparks, updateWeather };
}
