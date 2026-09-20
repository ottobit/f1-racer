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

  window.addEventListener("keydown", (event) => {
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

  addEventListener("blur", clearDrivingInput);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearDrivingInput();
  });

  function updateSteeringInput(dt) {
    const keyboard = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    steering.value = smoothSteering(
      steering.value,
      wheelPointer !== null ? touchSteer : keyboard,
      dt
    );
    wheelEl.style.setProperty("--steer-angle", `${steering.value * 65}deg`);
    wheelEl.setAttribute("aria-valuenow", String(Math.round(steering.value * 100)));
  }

  return { input, steering, clearDrivingInput, updateSteeringInput };
}
