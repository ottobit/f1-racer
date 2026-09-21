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
} = {}) {
  const input = { forward: false, back: false, left: false, right: false };
  const steering = { value: 0 };
  const pedalPointers = new Map();
  let touchSteer = 0;
  let wheelPointer = null;
  let wheelOrigin = 0;
  const wheelEl = document.getElementById(wheelId);
  const motionButton = document.getElementById("motion-toggle");
  const calibrateButton = document.getElementById("motion-calibrate");
  const sensitivityEl = document.getElementById("motion-sensitivity");
  const motionStatus = document.getElementById("motion-status");
  let motionActive = false, motionPending = false, motionRequest = 0;
  let motionNeutral = null, motionValue = 0, lastMotionAt = 0;
  let motionTimeout;
  const screenAngle = () => window.screen.orientation?.angle ?? window.orientation ?? 0;
  let motionScreenAngle = screenAngle();

  function stopMotion(message = "Sterzo touch") {
    motionRequest++;
    motionActive = motionPending = false;
    motionNeutral = null;
    motionValue = 0;
    clearTimeout(motionTimeout);
    window.removeEventListener("deviceorientation", onOrientation);
    motionButton.textContent = "Attiva movimento";
    motionButton.setAttribute("aria-pressed", "false");
    calibrateButton.hidden = sensitivityEl.hidden = true;
    motionStatus.textContent = message;
    clearDrivingInput();
  }

  function onOrientation(event) {
    if (document.hidden || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    const angle = screenAngle();
    if (angle !== motionScreenAngle) {
      stopMotion("Telefono ruotato: riattiva e calibra");
      return;
    }
    // Project gravity onto the screen's horizontal axis. Unlike raw beta,
    // this stays continuous at Euler wrap boundaries and handles both
    // landscape orientations as well as portrait.
    const radians = Math.PI / 180;
    const b = event.beta * radians, g = event.gamma * radians, a = angle * radians;
    const horizontal = Math.sin(g) * Math.cos(b) * Math.cos(a) + Math.sin(b) * Math.sin(a);
    const tilt = Math.asin(Math.max(-1, Math.min(1, horizontal))) / radians;
    lastMotionAt = performance.now();
    if (motionNeutral === null) {
      motionNeutral = tilt;
      motionActive = true;
      motionPending = false;
      clearTimeout(motionTimeout);
      motionButton.textContent = "Torna al touch";
      motionButton.setAttribute("aria-pressed", "true");
      calibrateButton.hidden = sensitivityEl.hidden = false;
      motionStatus.textContent = "Movimento attivo";
    }
    motionValue = shapeSteering((tilt - motionNeutral) / Number(sensitivityEl.value));
  }

  motionButton.addEventListener("click", async () => {
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
      clearDrivingInput();
      motionScreenAngle = screenAngle();
      window.addEventListener("deviceorientation", onOrientation);
      motionTimeout = setTimeout(() => stopMotion("Nessun dato dai sensori: sterzo touch"), 5000);
    } catch {
      if (request === motionRequest) stopMotion("Sensori non disponibili: sterzo touch");
    }
  });
  calibrateButton.addEventListener("click", () => {
    motionNeutral = null;
    motionValue = steering.value = 0;
    motionStatus.textContent = "Mantieni la posizione: calibrazione…";
  });
  window.screen.orientation?.addEventListener("change", () => {
    if (motionActive || motionPending) stopMotion("Telefono ruotato: riattiva e calibra");
  });

  window.addEventListener("keydown", (event) => {
    if (event.target.closest?.("select,input,textarea,button")) return;
    const action = KEY_MAP[event.code];
    if (action) input[action] = true;
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
    steering.value = 0;
    document.querySelectorAll(".touch-btn").forEach((button) => {
      button.classList.remove("is-held");
    });
  }

  function suspendInput() {
    if (motionActive || motionPending) stopMotion("Movimento sospeso: riattiva quando sei pronto");
    else clearDrivingInput();
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
    if (motionActive && performance.now() - lastMotionAt > 2000) stopMotion("Sensori interrotti: sterzo touch");
    const keyboard = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    steering.value = smoothSteering(
      steering.value,
      wheelPointer !== null ? touchSteer : keyboard || (motionActive ? motionValue : 0),
      dt
    );
    wheelEl.style.setProperty("--steer-angle", `${steering.value * 65}deg`);
    wheelEl.setAttribute("aria-valuenow", String(Math.round(steering.value * 100)));
  }

  return { input, steering, clearDrivingInput, updateSteeringInput };
}
