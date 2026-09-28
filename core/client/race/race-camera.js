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

// Driver's-eye cockpit (#139): the real car model (unbatched, so the
// driver's helmet can be hidden) seen from inside the helmet. The halo,
// its centre pillar, the steering wheel with gloves, the nose and the front
// tyres all sit where they are on the car the other drivers see.
// Eye raised above the helmet line (#141). The halo stays but is see-through
// (#143): solid, its bars covered most of the road on a phone.
// #169: eye pulled back and the view pitched ~12° down so the top of the
// wheel and the gloves sit in the lower frame (it was ~50° below the old
// near-level gaze), with the road still filling the upper two thirds.
const COCKPIT_EYE = new THREE.Vector3(0, 1.0, -0.02);
const COCKPIT_PITCH_DROP = Math.tan(THREE.MathUtils.degToRad(12));
const COCKPIT_HIDDEN_PARTS = ["driverHelmet", "driverVisor", "driverHelmetSpoiler", "driverHans"];
const COCKPIT_GLASS_PARTS = ["halo", "haloPillar"];

function prepareCockpitCar(model) {
  for (const name of COCKPIT_HIDDEN_PARTS) {
    const part = model.group.getObjectByName(name);
    if (part) part.visible = false;
  }
  for (const name of COCKPIT_GLASS_PARTS) {
    const part = model.group.getObjectByName(name);
    if (!part) continue;
    part.material = part.material.clone();
    part.material.transparent = true;
    part.material.opacity = 0.28;
    part.material.depthWrite = false;
  }
  model.group.traverse((object) => {
    if (object.isMesh) object.castShadow = false;
  });
  // Forearms (#173): remember each elbow so the arm can be re-aimed at the
  // glove every frame; built as static rods, they stayed put while the
  // wheel turned.
  model.forearms = [];
  model.group.traverse((object) => {
    if (object.name !== "driverForearm") return;
    const length = object.geometry.parameters.height;
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(object.quaternion);
    const elbow = object.position.clone().addScaledVector(axis, -length / 2);
    model.forearms.push({ mesh: object, elbow, length, side: object.userData.side });
  });
  return model;
}

// Real F1 wheels turn roughly ±90° at full lock; the shared car model only
// tilts ~30° (readable from the chase view), so the cockpit copy doubles it.
const COCKPIT_WHEEL_GAIN = 2;
// Wrist point on the grip, in steering-wheel space (car-model.js f1Wheel).
const WRIST_ON_GRIP = [0.135, -0.01, -0.04];
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const wrist = new THREE.Vector3();
const forearmDir = new THREE.Vector3();

function aimForearms(model) {
  const wheel = model.driverSteeringWheel;
  if (!wheel) return;
  for (const arm of model.forearms) {
    wheel.localToWorld(wrist.set(WRIST_ON_GRIP[0] * arm.side, WRIST_ON_GRIP[1], WRIST_ON_GRIP[2]));
    model.group.worldToLocal(wrist);
    forearmDir.subVectors(wrist, arm.elbow);
    const length = forearmDir.length();
    arm.mesh.position.copy(arm.elbow).addScaledVector(forearmDir, 0.5);
    arm.mesh.quaternion.setFromUnitVectors(Y_AXIS, forearmDir.normalize());
    arm.mesh.scale.y = length / arm.length;
  }
}

// Copy the visible car's pose, wheel roll and steering onto the cockpit copy
// so both follow the same conventions (race-car-view.js applyCarToMesh).
function mirrorCar(source, target) {
  target.group.position.copy(source.group.position);
  target.group.rotation.copy(source.group.rotation);
  source.wheels.forEach((wheel, index) => target.wheels[index]?.rotation.copy(wheel.rotation));
  source.steeringPivots?.forEach((pivot, index) => target.steeringPivots[index]?.rotation.copy(pivot.rotation));
  if (source.driverSteeringWheel && target.driverSteeringWheel) {
    target.driverSteeringWheel.rotation.z = source.driverSteeringWheel.rotation.z * COCKPIT_WHEEL_GAIN;
  }
}

export function setupRaceCamera({ scene, camera, state, playerCar, carMaxSpeed, cockpitCar, nearestTrackInfo, trackWidth, pitCamera = null }) {
  let cameraMode = "chase";
  let chaseCameraReady = false;
  let cameraHeading = 0;
  let lookingBack = false;
  let lookYaw = 0, lookPitch = 0;
  const lookKeys = new Set();
  let lookPointer = null, lookOriginX = 0, lookOriginY = 0;
  let touchLookX = 0, touchLookY = 0;
  const lookPad = document.getElementById("look-around");
  const desiredPosition = new THREE.Vector3();
  const cockpitView = cockpitCar ? prepareCockpitCar(cockpitCar).group : null;
  const eye = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  window.addEventListener("keydown", (event) => {
    if (["KeyJ", "KeyL", "KeyI", "KeyK"].includes(event.code)) {
      if (!event.target.closest?.("input,textarea,select,[contenteditable='true']")) lookKeys.add(event.code);
      return;
    }
    if (event.code === "KeyR") {
      if (!event.target.closest?.("input,textarea,select,[contenteditable='true']")) lookingBack = true;
      return;
    }
    if (event.code !== "KeyC") return;
    cameraMode = cameraMode === "chase" ? "cockpit" : "chase";
    playerCar.group.visible = cameraMode !== "cockpit";
    if (cockpitView) cockpitView.visible = cameraMode === "cockpit";
    // The wheel sits a hand-span from the eye: pull the near plane in.
    camera.near = cameraMode === "cockpit" ? 0.03 : 0.1;
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "KeyR") lookingBack = false;
    lookKeys.delete(event.code);
  });
  function resetLook() {
    lookingBack = false;
    lookYaw = lookPitch = 0;
    lookKeys.clear();
    touchLookX = touchLookY = 0;
    lookPointer = null;
    lookPad.style.setProperty("--look-x", "0px");
    lookPad.style.setProperty("--look-y", "0px");
  }
  window.addEventListener("blur", resetLook);
  window.addEventListener("pagehide", resetLook);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetLook();
  });

  lookPad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (lookPointer !== null) return;
    lookPointer = event.pointerId;
    lookOriginX = event.clientX;
    lookOriginY = event.clientY;
    lookPad.setPointerCapture(lookPointer);
  });
  lookPad.addEventListener("pointermove", (event) => {
    if (event.pointerId !== lookPointer) return;
    touchLookX = THREE.MathUtils.clamp((event.clientX - lookOriginX) / 45, -1, 1);
    touchLookY = THREE.MathUtils.clamp((event.clientY - lookOriginY) / 45, -1, 1);
    lookPad.style.setProperty("--look-x", `${touchLookX * 19}px`);
    lookPad.style.setProperty("--look-y", `${touchLookY * 19}px`);
  });
  const releaseLook = (event) => {
    if (event.pointerId !== lookPointer) return;
    lookPointer = null;
    touchLookX = touchLookY = 0;
    lookPad.style.setProperty("--look-x", "0px");
    lookPad.style.setProperty("--look-y", "0px");
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    lookPad.addEventListener(type, releaseLook);
  }

  function updateFreeLook(dt) {
    if (document.hidden || !document.hasFocus()) return;
    const pad = Array.from(navigator.getGamepads?.() ?? []).find((p) => p && p.connected && p.mapping === "standard");
    const deadzone = (value) => Math.abs(value) < 0.18 ? 0 : Math.sign(value) * (Math.abs(value) - 0.18) / 0.82;
    const padX = deadzone(pad?.axes?.[2] ?? 0);
    const padY = deadzone(pad?.axes?.[3] ?? 0);
    const keyX = Number(lookKeys.has("KeyL")) - Number(lookKeys.has("KeyJ"));
    const keyY = Number(lookKeys.has("KeyK")) - Number(lookKeys.has("KeyI"));
    const x = THREE.MathUtils.clamp(keyX || touchLookX || padX, -1, 1);
    const y = THREE.MathUtils.clamp(keyY || touchLookY || padY, -1, 1);
    const response = 1 - Math.exp(-(x || y ? 8 : 5) * dt);
    lookYaw += (x * 1.5 - lookYaw) * response;
    lookPitch += (-y * 0.4 - lookPitch) * response;
  }

  function aimWithFreeLook(target) {
    if (Math.abs(lookYaw) < 0.001 && Math.abs(lookPitch) < 0.001) {
      camera.lookAt(target);
      return;
    }
    const dx = target.x - camera.position.x, dz = target.z - camera.position.z;
    const cos = Math.cos(lookYaw), sin = Math.sin(lookYaw);
    const distance = Math.hypot(dx, dz);
    lookTarget.set(
      camera.position.x + dx * cos + dz * sin,
      target.y + Math.tan(lookPitch) * distance,
      camera.position.z + dz * cos - dx * sin
    );
    camera.lookAt(lookTarget);
  }

  function updateRearCamera() {
    chaseCameraReady = false;
    playerCar.group.visible = true;
    if (cockpitView) cockpitView.visible = false;
    camera.near = 0.1;
    // Looking back from ahead of the car keeps nearby pursuers and the
    // player's car visible in both chase and cockpit modes.
    camera.position.set(
      state.x + Math.sin(state.heading) * 3.8,
      3.1,
      state.z + Math.cos(state.heading) * 3.8
    );
    lookTarget.set(
      state.x - Math.sin(state.heading) * 12,
      1.0,
      state.z - Math.cos(state.heading) * 12
    );
    camera.lookAt(lookTarget);
  }

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
    // In the pit lane (#147) the car is legitimately off the track.
    if (nearestTrackInfo && trackWidth && state.pitState === "none") {
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
    aimWithFreeLook(lookTarget);

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
    if (!cockpitView) return;
    cockpitView.visible = true;
    mirrorCar(playerCar, cockpitCar);
    cockpitView.updateMatrixWorld(true);
    aimForearms(cockpitCar);
    cockpitView.localToWorld(eye.copy(COCKPIT_EYE));
    camera.position.copy(eye);
    // Look down the road, pitched so the wheel and gloves stay in frame.
    lookTarget.set(
      eye.x + Math.sin(state.heading) * 20,
      eye.y - 20 * COCKPIT_PITCH_DROP,
      eye.z + Math.cos(state.heading) * 20
    );
    aimWithFreeLook(lookTarget);
  }

  // TV shot of the box while the crew works (#147), then back to the
  // chosen view.
  function updatePitCamera() {
    chaseCameraReady = false;
    playerCar.group.visible = true;
    if (cockpitView) cockpitView.visible = false;
    camera.near = 0.1;
    camera.position.copy(pitCamera.position);
    camera.lookAt(pitCamera.target);
  }

  function updateCamera(dt) {
    updateFreeLook(dt);
    if (pitCamera && state.pitState === "servicing") {
      updatePitCamera();
      return;
    }
    if (lookingBack) {
      updateRearCamera();
      return;
    }
    playerCar.group.visible = cameraMode !== "cockpit";
    camera.near = cameraMode === "cockpit" ? 0.03 : 0.1;
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
