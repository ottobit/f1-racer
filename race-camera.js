import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const CHASE_CAM_BASE_DISTANCE = 6.4;
const CHASE_CAM_BASE_FOV = 58;
const CHASE_CAM_BASE_ASPECT = 1.7;
const CHASE_CAM_LANDSCAPE_MAX_DISTANCE = 4.35;

function isCompactLandscapeViewport() {
  return window.innerWidth > window.innerHeight && window.innerHeight <= 520;
}

function buildCockpitView(theme) {
  const group = new THREE.Group();
  group.visible = false;
  const primary = new THREE.MeshStandardMaterial({ color: theme.primary, metalness: 0.45, roughness: 0.28 });
  const secondary = new THREE.MeshStandardMaterial({ color: theme.secondary, metalness: 0.3, roughness: 0.32 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x070b10, metalness: 0.35, roughness: 0.62 });
  const glow = new THREE.MeshBasicMaterial({ color: theme.glow, transparent: true, opacity: 0.75 });
  const mesh = (geometry, material, position) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(...position);
    group.add(object);
    return object;
  };
  mesh(new THREE.BoxGeometry(0.82, 0.11, 0.2), carbon, [0, 0.72, 0.78]);
  mesh(new THREE.BoxGeometry(0.48, 0.035, 0.045), glow, [0, 0.8, 0.68]);
  mesh(new THREE.BoxGeometry(0.09, 0.09, 1.18), primary, [-0.46, 0.64, 0.96]).rotation.z = -0.18;
  mesh(new THREE.BoxGeometry(0.09, 0.09, 1.18), primary, [0.46, 0.64, 0.96]).rotation.z = 0.18;
  mesh(new THREE.BoxGeometry(0.62, 0.035, 0.12), secondary, [0, 0.58, 1.12]);

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#060a10";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = `#${theme.primary.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, canvas.width, 14);
  ctx.fillStyle = `#${theme.secondary.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 146, canvas.width, 14);
  ctx.textAlign = "center";
  ctx.fillStyle = "#f5f8fb";
  ctx.font = "700 44px sans-serif";
  ctx.fillText(theme.label.toUpperCase(), 256, 70);
  ctx.fillStyle = "#9fb4c5";
  ctx.font = "700 34px monospace";
  ctx.fillText(theme.motto, 256, 118);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const badge = mesh(
    new THREE.PlaneGeometry(0.62, 0.2),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    [0, 0.88, 0.9]
  );
  badge.rotation.x = -0.1;
  return group;
}

export function setupRaceCamera({ scene, camera, state, playerCar, carMaxSpeed, cockpitTheme }) {
  let cameraMode = "chase";
  const cockpitView = cockpitTheme ? buildCockpitView(cockpitTheme) : null;
  if (cockpitView) scene.add(cockpitView);

  window.addEventListener("keydown", (event) => {
    if (event.code !== "KeyC") return;
    cameraMode = cameraMode === "chase" ? "cockpit" : "chase";
    playerCar.group.visible = cameraMode !== "cockpit";
    if (cockpitView) cockpitView.visible = cameraMode === "cockpit";
  });

  function updateChaseCamera(dt) {
    if (cockpitView) cockpitView.visible = false;
    const fovScale =
      Math.tan(THREE.MathUtils.degToRad(CHASE_CAM_BASE_FOV / 2)) /
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const aspectScale = Math.min(1, CHASE_CAM_BASE_ASPECT / camera.aspect);
    let camDistance = CHASE_CAM_BASE_DISTANCE * fovScale * aspectScale;
    let camHeight = 3.55;

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

  function updateCockpitCamera() {
    if (cockpitView) {
      cockpitView.visible = true;
      cockpitView.position.set(state.x, 0, state.z);
      cockpitView.rotation.y = state.heading;
    }
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

  function updateSpeedFov(dt) {
    const speedFov = Math.min(Math.abs(state.speed) / carMaxSpeed, 1);
    const targetFov = CHASE_CAM_BASE_FOV + speedFov * 12;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }

  return { updateCamera, updateSpeedFov };
}