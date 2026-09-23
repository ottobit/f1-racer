import { shapeSteering, smoothSteering } from "./steering.js";

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

export function setupRaceInput({
  wheelId = "wheel-control",
  gasId = "btn-gas",
  brakeId = "btn-brake",
  onHumanInput = () => {},
} = {}) {
  const input = { forward: false, back: false, left: false, right: false };
  const steering = { value: 0 };
  const pedalPointers = new Map();
  // Set by the Agent API (see agent-api.js) to drive steering.value directly
  // for the duration of a step, bypassing the human wheel/keyboard/motion
  // smoothing below. null means "no agent override", the default and only
  // state a human-played session ever sees.
  let externalSteer = null;
  function setExternalSteer(value) {
    externalSteer = value;
  }
  let touchSteer = 0;
  let wheelPointer = null;
  let wheelOrigin = 0;
  const wheelEl = document.getElementById(wheelId);
  const motionButton = document.getElementById("motion-toggle");
  const calibrateButton = document.getElementById("motion-calibrate");
  const sensitivityEl = document.getElementById("motion-sensitivity");
  const motionStatus = document.getElementById("motion-status");
  const motionIndicator = document.getElementById("motion-indicator");
  const motionMarker = document.getElementById("motion-marker");
  const wrapDegrees = (value) => ((value + 180) % 360 + 360) % 360 - 180;
  let calibrationStart = null, calibrationAnchor = 0, calibrationSum = 0, calibrationCount = 0;
  function resetCalibration() {
    motionNeutral = null;
    calibrationStart = null;
    motionValue = steering.value = 0;
  }
  let motionActive = false, motionPending = false, motionRequest = 0;
  let motionNeutral = null, motionValue = 0, lastMotionAt = 0;
  let motionTimeout;
  const screenAngle = () => window.screen.orientation?.angle ?? window.orientation ?? 0;
  let motionScreenAngle = screenAngle();

  function stopMotion(message = "Sterzo touch") {
    motionRequest++;
    motionActive = motionPending = false;
    lastMotionAt = 0;
    resetCalibration();
    clearTimeout(motionTimeout);
    window.removeEventListener("deviceorientation", onOrientation);
    motionButton.textContent = "Attiva movimento";
    motionButton.setAttribute("aria-pressed", "false");
    calibrateButton.hidden = sensitivityEl.hidden = true;
    motionIndicator.hidden = true;
    motionStatus.textContent = message;
    // Switching steering mode must not release an independently held pedal.
    touchSteer = 0;
  }

  function onOrientation(event) {
    if (document.hidden || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    const angle = screenAngle();
    if (angle !== motionScreenAngle) {
      stopMotion("Telefono ruotato: riattiva e calibra");
      return;
    }
    // Use the angle of gravity in the screen plane, not asin(horizontal):
    // the latter attenuates steering when the phone is held at a shallow pitch.
    const radians = Math.PI / 180;
    const b = event.beta * radians, g = event.gamma * radians, a = angle * radians;
    const horizontal = Math.sin(g) * Math.cos(b) * Math.cos(a) + Math.sin(b) * Math.sin(a);
    const vertical = Math.sin(b) * Math.cos(a) - Math.sin(g) * Math.cos(b) * Math.sin(a);
    lastMotionAt = performance.now();
    clearTimeout(motionTimeout);
    motionIndicator.hidden = false;
    if (Math.hypot(horizontal, vertical) < 0.3) {
      // Roll is undefined when the screen lies flat: never amplify noise.
      resetCalibration();
      motionStatus.textContent = "Solleva un po’ lo schermo verso di te";
      return;
    }
    const tilt = Math.atan2(horizontal, vertical) / radians;
    if (motionNeutral === null) {
      motionValue = 0;
      const now = performance.now();
      if (calibrationStart === null || Math.abs(wrapDegrees(tilt - calibrationAnchor)) > 3) {
        calibrationStart = now;
        calibrationAnchor = tilt;
        calibrationSum = 0;
        calibrationCount = 0;
      }
      calibrationSum += wrapDegrees(tilt - calibrationAnchor);
      calibrationCount++;
      motionStatus.textContent = "Tieni fermo per mezzo secondo…";
      if (now - calibrationStart < 500 || calibrationCount < 5) return;
      motionNeutral = wrapDegrees(calibrationAnchor + calibrationSum / calibrationCount);
      motionActive = true;
      motionPending = false;
      clearTimeout(motionTimeout);
      motionButton.textContent = "Torna al touch";
      motionButton.setAttribute("aria-pressed", "true");
      calibrateButton.hidden = sensitivityEl.hidden = false;
      motionStatus.textContent = "Ruota come un volante · Centra per ricalibrare";
    }
    const delta = wrapDegrees(tilt - motionNeutral);
    const magnitude = Math.max(0, Math.abs(delta) - 1.5);
    motionValue = Math.sign(delta) * Math.min(1, magnitude / (Number(sensitivityEl.value) - 1.5));
  }

  motionButton.addEventListener("click", async () => {
    onHumanInput();
    if (motionActive || motionPending) { stopMotion(); return; }
    if (!window.isSecureContext || !window.DeviceOrientationEvent) {
      stopMotion("Sensori non disponibili: usa il touch"); return;
    }
    const request = ++motionRequest;
    motionPending = true;
    motionButton.textContent = "Annulla movimento";
    motionStatus.textContent = "Tieni il telefono nella posizione di guida";
    try {
      // iOS requires this call directly inside a user gesture.
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (request !== motionRequest) return;
        if (permission !== "granted") { stopMotion("Permesso negato: sterzo touch"); return; }
      }
      if (request !== motionRequest) return;
      resetCalibration();
      wheelPointer = null;
      touchSteer = 0;
      motionScreenAngle = screenAngle();
      window.addEventListener("deviceorientation", onOrientation);
      motionTimeout = setTimeout(() => stopMotion("Nessun dato dai sensori: sterzo touch"), 5000);
    } catch {
      if (request === motionRequest) stopMotion("Sensori non disponibili: sterzo touch");
    }
  });
  calibrateButton.addEventListener("click", () => {
    resetCalibration();
    motionStatus.textContent = "Mantieni la posizione: calibrazione…";
  });
  window.screen.orientation?.addEventListener("change", () => {
    if (motionActive || motionPending) stopMotion("Telefono ruotato: riattiva e calibra");
  });

  window.addEventListener("keydown", (event) => {
    if (event.target.closest?.("select,input,textarea,button")) return;
    const action = KEY_MAP[event.code];
    if (action) {
      input[action] = true;
      onHumanInput();
    }
  });
  window.addEventListener("keyup", (event) => {
    const action = KEY_MAP[event.code];
    if (action) input[action] = false;
  });

  function bindHoldButton(id, action) {
    const el = document.getElementById(id);
    el.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (pedalPointers.has(action)) return;
      pedalPointers.set(action, event.pointerId);
      el.setPointerCapture(event.pointerId);
      input[action] = true;
      el.classList.add("is-held");
      onHumanInput();
    });
    const release = (event) => {
      if (pedalPointers.get(action) !== event.pointerId) return;
      pedalPointers.delete(action);
      input[action] = false;
      el.classList.remove("is-held");
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      el.addEventListener(type, release);
    }
  }

  bindHoldButton(gasId, "forward");
  bindHoldButton(brakeId, "back");

  wheelEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (motionActive || motionPending) stopMotion();
    if (wheelPointer !== null) return;
    wheelPointer = event.pointerId;
    wheelOrigin = event.clientX;
    touchSteer = 0;
    wheelEl.setPointerCapture(event.pointerId);
    onHumanInput();
  });
  wheelEl.addEventListener("pointermove", (event) => {
    if (event.pointerId !== wheelPointer) return;
    const travel = Math.max(45, wheelEl.clientWidth * 0.48);
    touchSteer = shapeSteering((event.clientX - wheelOrigin) / travel);
  });
  const releaseWheel = (event) => {
    if (event.pointerId === wheelPointer) {
      wheelPointer = null;
      touchSteer = 0;
    }
  };
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    wheelEl.addEventListener(type, releaseWheel);
  }

  function clearDrivingInput() {
    Object.keys(input).forEach((key) => {
      input[key] = false;
    });
    pedalPointers.clear();
    wheelPointer = null;
    touchSteer = 0;
    externalSteer = null;
    steering.value = 0;
    document.querySelectorAll(".touch-btn").forEach((button) => {
      button.classList.remove("is-held");
    });
  }

  function suspendInput() {
    if (motionActive || motionPending) stopMotion("Movimento sospeso: riattiva quando sei pronto");
    clearDrivingInput();
  }
  addEventListener("blur", () => {
    // A native permission dialog may blur the page while awaiting consent.
    if (motionPending) clearDrivingInput();
    else suspendInput();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspendInput();
  });

  function updateSteeringInput(dt) {
    if (externalSteer !== null) {
      // Agent-driven step in progress: skip human smoothing/sourcing
      // entirely so the agent's value isn't fought back toward 0.
      steering.value = externalSteer;
    } else {
      if ((motionActive || motionPending) && lastMotionAt && performance.now() - lastMotionAt > 2000) stopMotion("Sensori interrotti: sterzo touch");
      const keyboard = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      steering.value = smoothSteering(
        steering.value,
        wheelPointer !== null ? touchSteer : keyboard || (motionActive ? motionValue : 0),
        dt
      );
    }
    wheelEl.style.setProperty("--steer-angle", `${steering.value * 65}deg`);
    wheelEl.setAttribute("aria-valuenow", String(Math.round(steering.value * 100)));
    if (!motionIndicator.hidden) {
      motionMarker.style.left = `${50 + steering.value * 45}%`;
      motionIndicator.setAttribute("aria-valuenow", String(Math.round(steering.value * 100)));
    }
  }

  return { input, steering, clearDrivingInput, updateSteeringInput, setExternalSteer };
}
