import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const CHASE_CAM_BASE_DISTANCE = 6.4;
const CHASE_CAM_BASE_FOV = 58;
const CHASE_CAM_BASE_ASPECT = 1.7;
const CHASE_CAM_LANDSCAPE_MAX_DISTANCE = 4.35;

function isCompactLandscapeViewport() {
  return window.innerWidth > window.innerHeight && window.innerHeight <= 520;
}

export function setupRaceCamera({ camera, state, playerCar, carMaxSpeed }) {
  let cameraMode = "chase";

  window.addEventListener("keydown", (event) => {
    if (event.code !== "KeyC") return;
    cameraMode = cameraMode === "chase" ? "cockpit" : "chase";
    playerCar.group.visible = cameraMode !== "cockpit";
  });

  function updateChaseCamera(dt) {
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
