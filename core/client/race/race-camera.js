import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const CHASE_CAM_BASE_DISTANCE = 6.4;
const CHASE_CAM_BASE_FOV = 58;
const CHASE_CAM_BASE_ASPECT = 1.7;
const CHASE_CAM_LANDSCAPE_MAX_DISTANCE = 5.2;
const CHASE_CAM_TRACK_MARGIN = 2.5;
// Camera yaw trails the car heading so the car visibly rotates into corners.
const CHASE_CAM_YAW_RESPONSE = 3.2;
const CHASE_CAM_MAX_YAW_LAG = 0.45;

function isCompactLandscapeViewport() {
  return window.innerWidth > window.innerHeight && window.innerHeight <= 520;
}

// Driver's-eye cockpit (#135): the eye sits at y 1.0, 0.3 ahead of the car
// origin; everything here stays below that line so the road stays in view.
// No team badge in front of the eyes any more — it covered the track.
function buildCockpitView(theme) {
  const group = new THREE.Group();
  group.visible = false;
  const primary = new THREE.MeshStandardMaterial({ color: theme.primary, metalness: 0.45, roughness: 0.28 });
  const secondary = new THREE.MeshStandardMaterial({ color: theme.secondary, metalness: 0.3, roughness: 0.32 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x070b10, metalness: 0.35, roughness: 0.62 });
  const glove = new THREE.MeshStandardMaterial({ color: theme.secondary, metalness: 0.05, roughness: 0.8 });
  const glow = new THREE.MeshBasicMaterial({ color: theme.glow, transparent: true, opacity: 0.85 });
  const mesh = (geometry, material, position, parent = group) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(...position);
    parent.add(object);
    return object;
  };

  // Nose and front wing, far enough ahead to read as "the car" low in view.
  mesh(new THREE.BoxGeometry(0.34, 0.14, 1.6), primary, [0, 0.5, 2.1]);
  mesh(new THREE.BoxGeometry(0.22, 0.1, 0.9), primary, [0, 0.4, 3.3]);
  mesh(new THREE.BoxGeometry(1.7, 0.04, 0.32), carbon, [0, 0.18, 3.75]);
  mesh(new THREE.BoxGeometry(0.05, 0.16, 0.34), secondary, [-0.85, 0.24, 3.75]);
  mesh(new THREE.BoxGeometry(0.05, 0.16, 0.34), secondary, [0.85, 0.24, 3.75]);
  // Cockpit rim: two side walls and the cowl beyond the wheel.
  mesh(new THREE.BoxGeometry(0.1, 0.12, 1.2), primary, [-0.42, 0.66, 0.9]).rotation.z = -0.15;
  mesh(new THREE.BoxGeometry(0.1, 0.12, 1.2), primary, [0.42, 0.66, 0.9]).rotation.z = 0.15;
  mesh(new THREE.BoxGeometry(0.72, 0.08, 0.3), carbon, [0, 0.64, 1.35]);
  mesh(new THREE.BoxGeometry(0.4, 0.02, 0.04), secondary, [0, 0.69, 1.22]);

  // Steering wheel with gloves and forearms; the whole wheel turns with steer.
  const wheel = new THREE.Group();
  wheel.position.set(0, 0.74, 0.92);
  wheel.rotation.x = -0.35;
  group.add(wheel);
  const spin = new THREE.Group();
  wheel.add(spin);
  mesh(new THREE.BoxGeometry(0.28, 0.13, 0.04), carbon, [0, 0, 0], spin);
  mesh(new THREE.BoxGeometry(0.06, 0.17, 0.05), carbon, [-0.16, -0.01, 0], spin);
  mesh(new THREE.BoxGeometry(0.06, 0.17, 0.05), carbon, [0.16, -0.01, 0], spin);
  mesh(new THREE.BoxGeometry(0.11, 0.05, 0.01), glow, [0, 0.02, -0.022], spin);
  mesh(new THREE.BoxGeometry(0.2, 0.012, 0.01), secondary, [0, 0.062, -0.022], spin);
  for (const side of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.045, 12, 10), glove, [side * 0.16, 0.01, -0.035], spin).scale.set(1, 1.35, 1);
    const arm = mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.42, 10), primary, [side * 0.21, -0.07, -0.22], spin);
    arm.rotation.x = Math.PI / 2 - 0.35;
    arm.rotation.z = side * 0.25;
  }
  group.userData.wheelSpin = spin;
  return group;
}

export function setupRaceCamera({ scene, camera, state, playerCar, carMaxSpeed, cockpitTheme, nearestTrackInfo, trackWidth, getSteer = () => 0 }) {
  let cameraMode = "chase";
  let chaseCameraReady = false;
  let cameraHeading = 0;
  const desiredPosition = new THREE.Vector3();
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
      camHeight = 3.15;
    }

    if (!chaseCameraReady) cameraHeading = state.heading;
    let yawLag = Math.atan2(Math.sin(state.heading - cameraHeading), Math.cos(state.heading - cameraHeading));
    yawLag -= yawLag * (1 - Math.exp(-CHASE_CAM_YAW_RESPONSE * dt));
    yawLag = THREE.MathUtils.clamp(yawLag, -CHASE_CAM_MAX_YAW_LAG, CHASE_CAM_MAX_YAW_LAG);
    cameraHeading = state.heading - yawLag;

    let desiredX = state.x - Math.sin(cameraHeading) * camDistance;
    let desiredZ = state.z - Math.cos(cameraHeading) * camDistance;
    if (nearestTrackInfo && trackWidth) {
      const track = nearestTrackInfo(desiredX, desiredZ);
      const safeOffset = trackWidth / 2 + CHASE_CAM_TRACK_MARGIN;
      if (track.dist > safeOffset) {
        const scale = safeOffset / track.dist;
        desiredX = track.x + (desiredX - track.x) * scale;
        desiredZ = track.z + (desiredZ - track.z) * scale;
      }
    }
    desiredPosition.set(desiredX, camHeight, desiredZ);
    if (!chaseCameraReady) {
      camera.position.copy(desiredPosition);
      chaseCameraReady = true;
    } else {
      camera.position.lerp(desiredPosition, 1 - Math.pow(0.001, dt));
    }
    const lookTarget = new THREE.Vector3(
      state.x + Math.sin(cameraHeading) * 4,
      1,
      state.z + Math.cos(cameraHeading) * 4
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
    chaseCameraReady = false;
    if (cockpitView) {
      cockpitView.visible = true;
      cockpitView.position.set(state.x, 0, state.z);
      cockpitView.rotation.y = state.heading;
      // Positive steer turns right: clockwise from the driver's seat.
      cockpitView.userData.wheelSpin.rotation.z = getSteer() * 1.1;
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
