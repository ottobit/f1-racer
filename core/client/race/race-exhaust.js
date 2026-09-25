import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// Exhaust pops (#89): a flame flicker at the tailpipe plus a crackle from
// race-audio when the player lifts off at speed or the gearbox downshifts.
// Visual only; nothing here touches physics.
const FLAME_POSITION = [0, 0.51, -1.98]; // just behind the model's tailpipe
const FLASH_TIME = 0.07;

function flameTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255, 255, 235, 1)");
  g.addColorStop(0.25, "rgba(255, 200, 80, 0.95)");
  g.addColorStop(0.55, "rgba(255, 90, 20, 0.55)");
  g.addColorStop(1, "rgba(255, 40, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function setupExhaustPops({ carGroup, state, input, maxSpeed, gearInfo, playPop }) {
  const material = new THREE.SpriteMaterial({
    map: flameTexture(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const flame = new THREE.Sprite(material);
  flame.position.set(...FLAME_POSITION);
  flame.visible = false;
  carGroup.add(flame);

  let wasThrottle = false;
  let lastGear = 1;
  let flash = 0;
  let size = 0.4;
  const queue = []; // seconds until each pending pop

  function schedule(count, spread) {
    let t = 0.02;
    for (let i = 0; i < count; i++) {
      queue.push(t);
      t += 0.05 + Math.random() * spread;
    }
  }

  function pop() {
    flash = FLASH_TIME;
    size = 0.3 + Math.random() * 0.3;
    material.rotation = Math.random() * Math.PI * 2;
    playPop?.(0.6 + Math.random() * 0.4);
  }

  return function update(dt) {
    const ratio = Math.max(0, state.speed) / maxSpeed;
    const throttle = input.forward && !input.back;
    const { gear } = gearInfo(ratio);
    if (wasThrottle && !throttle && ratio > 0.35) schedule(3 + Math.floor(Math.random() * 4), 0.16);
    else if (gear < lastGear && !throttle && ratio > 0.15) schedule(1 + Math.floor(Math.random() * 2), 0.08);
    // Back on the gas cuts the overrun crackle.
    if (throttle && !wasThrottle) queue.length = 0;
    wasThrottle = throttle;
    lastGear = gear;

    for (let i = queue.length - 1; i >= 0; i--) {
      queue[i] -= dt;
      if (queue[i] <= 0) {
        queue.splice(i, 1);
        pop();
      }
    }

    if (flash > 0) {
      flash = Math.max(0, flash - dt);
      const k = flash / FLASH_TIME;
      material.opacity = k;
      flame.scale.setScalar(size * (1.3 - 0.3 * k));
      flame.visible = true;
    } else {
      flame.visible = false;
    }
  };
}
