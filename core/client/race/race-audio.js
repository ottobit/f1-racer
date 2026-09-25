// --- Gears -------------------------------------------------------------
//
// Eight forward gears (typical of a modern F1 car), mapped onto the 0..1
// fraction of top speed at which each one tops out — not evenly spaced,
// since a real gearbox's lower gears cover much less ground than its
// higher ones. There's no manual shifting; the gear is purely a function
// of current speed.
const GEAR_THRESHOLDS = [0.09, 0.19, 0.31, 0.45, 0.6, 0.75, 0.89, 1.0];

// Which gear a fraction of top speed falls in, plus how far through that
// gear's own speed band the car sits (0..1, resets to 0 on every shift).
// That second number is what makes the engine note and shift lights climb
// through a gear and drop back down at the next shift, instead of just
// tracking raw speed in a straight line.
export function gearInfo(speedRatio) {
  const ratio = Math.min(Math.max(speedRatio, 0), 1);
  let gear = GEAR_THRESHOLDS.length;
  for (let g = 0; g < GEAR_THRESHOLDS.length; g++) {
    if (ratio <= GEAR_THRESHOLDS[g]) {
      gear = g + 1;
      break;
    }
  }
  const lower = gear === 1 ? 0 : GEAR_THRESHOLDS[gear - 2];
  const upper = GEAR_THRESHOLDS[gear - 1];
  const rpmRatio = upper > lower ? (ratio - lower) / (upper - lower) : 1;
  return { gear, rpmRatio: Math.min(Math.max(rpmRatio, 0), 1) };
}

// --- Engine sound ----------------------------------------------------------
//
// Synthesised, not a sample — the site has no audio assets and no build
// step. Modelled on a 1.6 V6 turbo-hybrid: the engine keeps a real RPM
// value (idle ~4600, launch ~10800, ~9800-12400 through each gear) and the
// firing frequency is RPM/20 (six cylinders, four-stroke: three firings per
// crank revolution), so the fundamental sits around 230 Hz at idle and
// 490-620 Hz on the move — the high-pitched howl of a modern F1 car, not
// the old ~70-330 Hz truck-like drone this replaced.
//
// Layers: a harmonic-rich firing tone (PeriodicWave), a crank-order sub for
// body, a 1.5-order half tone for growl, band-passed noise for intake/
// exhaust roar, and a faint turbo whistle — mixed, soft-clipped, then
// low-passed by engine load, so on-throttle is open and raspy and a lift is
// muffled. RPM has inertia (rises faster than it falls), so blips and
// upshift drops sound like a real engine rather than a pitch slider.
//
// Phases come from `getPhase()`: "grid" (car held on the line — idle, and
// the throttle free-revs the engine like a real driver on the grid),
// "driving" and "idle" (finished). Browsers only allow audio after a user
// gesture, so nothing exists until `arm()` is called from one.
const IDLE_RPM = 4600;
const LAUNCH_RPM = 10800;
const GEAR_LOW_RPM = 9800;
const REDLINE_RPM = 12400;
const rpmToHz = (rpm) => rpm / 20;

export function setupRaceAudio({ getPhase, getThrottle }) {
  let ctx = null;
  let master = null;
  let engineOut = null;
  let mainOsc, subOsc, halfOsc, turboOsc;
  let mainGain, noiseFilter, noiseGain, turboGain, bodyFilter, lumpLfo, lumpDepth;
  let rpm = 0;
  let load = 0;
  let startupAt = -1;
  let lastTick = 0;
  let gridIntensity = 0.3;
  let coolingDown = false;
  let lastPhase = null;

  function firingWave() {
    const n = 28;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      let a = 1 / Math.pow(k, 0.8);
      if (k === 2) a *= 1.35;
      if (k === 3) a *= 1.2;
      if (k % 6 === 0) a *= 1.5;
      imag[k] = k % 2 ? a : -a * 0.85;
    }
    return ctx.createPeriodicWave(real, imag);
  }

  function noiseBuffer() {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function softClip(amount) {
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    return curve;
  }

  function arm() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return; // no Web Audio: fail silent, not fatal
    ctx = new Ctx();
    const wave = firingWave();

    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    const mix = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(2.2);
    shaper.oversample = "2x";
    bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = "lowpass";
    bodyFilter.Q.value = 0.9;
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 45;
    engineOut = ctx.createGain();
    engineOut.gain.value = 0;
    mix.connect(shaper).connect(bodyFilter).connect(highpass).connect(engineOut).connect(master);

    mainOsc = ctx.createOscillator();
    mainOsc.setPeriodicWave(wave);
    mainGain = ctx.createGain();
    mainGain.gain.value = 0.55;
    mainOsc.connect(mainGain).connect(mix);

    // Idle lumpiness: a slow amplitude wobble on the firing tone, deep at
    // idle and nearly gone at high revs.
    lumpLfo = ctx.createOscillator();
    lumpLfo.frequency.value = 9;
    lumpDepth = ctx.createGain();
    lumpDepth.gain.value = 0;
    lumpLfo.connect(lumpDepth).connect(mainGain.gain);

    subOsc = ctx.createOscillator();
    subOsc.type = "sawtooth";
    const subGain = ctx.createGain();
    subGain.gain.value = 0.3;
    subOsc.connect(subGain).connect(mix);

    halfOsc = ctx.createOscillator();
    halfOsc.type = "triangle";
    const halfGain = ctx.createGain();
    halfGain.gain.value = 0.22;
    halfOsc.connect(halfGain).connect(mix);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer();
    noise.loop = true;
    noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.Q.value = 0.8;
    noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(noiseGain).connect(mix);

    turboOsc = ctx.createOscillator();
    turboOsc.type = "sine";
    turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turboOsc.connect(turboGain).connect(engineOut);

    for (const node of [mainOsc, lumpLfo, subOsc, halfOsc, noise, turboOsc]) node.start();

    rpm = 0;
    startupAt = ctx.currentTime;
    document.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend();
      else ctx.resume();
    });
  }

  function targetRpmFor(phase, throttle, speedRatio, rpmRatio, now) {
    if (startupAt >= 0) {
      // Fire-up: a short starter crank, the engine catches with a rev
      // flare, then settles to idle.
      const t = now - startupAt;
      if (t < 0.5) return 700 + t * 900;
      if (t < 0.85) return 8200;
      startupAt = -1;
    }
    if (phase === "driving") {
      if (speedRatio < 0.015) return throttle ? LAUNCH_RPM : IDLE_RPM;
      const inGear = GEAR_LOW_RPM + rpmRatio * (REDLINE_RPM - GEAR_LOW_RPM);
      return throttle ? inGear : inGear - 700;
    }
    if (phase === "grid") {
      if (throttle) return LAUNCH_RPM + Math.sin(now * 7) * 250;
      return IDLE_RPM + gridIntensity * 900;
    }
    return IDLE_RPM;
  }

  // speedRatio (0..1 of top speed) and rpmRatio (0..1 through the current
  // gear, see gearInfo) come from the HUD every frame, in every phase.
  function updateEngineSound(speedRatio, rpmRatio) {
    if (!ctx) return;
    const now = ctx.currentTime;
    const dt = lastTick ? Math.min(Math.max(now - lastTick, 0), 0.1) : 0.016;
    lastTick = now;
    const phase = coolingDown ? "idle" : getPhase();
    const throttle = coolingDown ? 0 : getThrottle();
    lastPhase = phase;

    const target = targetRpmFor(phase, throttle, speedRatio, rpmRatio, now);
    const rising = target > rpm;
    const rate = rising ? (phase === "driving" ? 45000 : 30000) : (phase === "driving" ? 32000 : 11000);
    const step = rate * dt;
    rpm = rising ? Math.min(target, rpm + step) : Math.max(target, rpm - step);

    const loadTarget =
      phase === "driving" ? (throttle ? 1 : 0.25) :
      phase === "grid" ? (throttle ? 0.85 : 0.2) : 0.15;
    load += (loadTarget - load) * Math.min(dt * 10, 1);

    const f = rpmToHz(Math.max(rpm, 300));
    const revs = Math.min(rpm / REDLINE_RPM, 1);
    mainOsc.frequency.setTargetAtTime(f, now, 0.01);
    subOsc.frequency.setTargetAtTime(f / 3, now, 0.01);
    halfOsc.frequency.setTargetAtTime(f * 0.5, now, 0.01);
    lumpLfo.frequency.setTargetAtTime(Math.max(f / 24, 4), now, 0.05);
    lumpDepth.gain.setTargetAtTime(0.28 * (1 - revs) * (1 - load * 0.7), now, 0.05);

    noiseFilter.frequency.setTargetAtTime(f * 3.5, now, 0.02);
    noiseGain.gain.setTargetAtTime(0.03 + 0.12 * load * revs, now, 0.04);
    turboOsc.frequency.setTargetAtTime(1600 + revs * 4200 * (0.55 + 0.45 * load), now, 0.08);
    turboGain.gain.setTargetAtTime(0.002 + 0.012 * load * revs * revs, now, 0.1);
    bodyFilter.frequency.setTargetAtTime(650 + load * 3600 + revs * 2600, now, 0.03);

    const fadeIn = startupAt >= 0 ? Math.min((now - startupAt) / 0.3, 1) : 1;
    const level = (0.05 + 0.075 * load + 0.035 * speedRatio) * fadeIn;
    engineOut.gain.setTargetAtTime(level, now, 0.05);
  }

  // A short percussive clack on each gear change: the RPM drop already
  // implies a shift, a discrete transient sells it.
  function playShiftClick() {
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(g).connect(master);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  // Overrun crackle (#89): a short band-passed noise crack over a low
  // thump, one per flame flicker from race-exhaust.js.
  let popBuffer = null;
  function playExhaustPop(intensity = 1) {
    if (!ctx) return;
    if (!popBuffer) popBuffer = noiseBuffer();
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = popBuffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 700 + Math.random() * 900;
    band.Q.value = 1.4;
    const crack = ctx.createGain();
    crack.gain.setValueAtTime(0.32 * intensity, now);
    crack.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    src.connect(band).connect(crack).connect(master);
    src.start(now, Math.random() * 1.5, 0.08);

    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(120, now);
    thump.frequency.exponentialRampToValueAtTime(45, now + 0.06);
    const body = ctx.createGain();
    body.gain.setValueAtTime(0.22 * intensity, now);
    body.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    thump.connect(body).connect(master);
    thump.start(now);
    thump.stop(now + 0.09);
  }

  // Grid chorus: the other cars' engines, as two detuned voices (cheap on
  // mobile). On the grid it follows `gridIntensity`, which the start
  // sequence raises light by light — the whole field builds revs together
  // as the lights come on. Once racing it follows how many visible cars are
  // nearby and how fast they go, thinning out as the pack spreads.
  const CHORUS_RADIUS = 40;
  const CHORUS_MAX_VOICES = 6;
  let chorusGain = null;
  let chorusFilter = null;
  let chorusA = null;
  let chorusB = null;

  function ensureChorus() {
    if (!ctx || chorusGain) return;
    const wave = firingWave();
    chorusGain = ctx.createGain();
    chorusGain.gain.value = 0;
    chorusFilter = ctx.createBiquadFilter();
    chorusFilter.type = "lowpass";
    chorusFilter.frequency.value = 900;
    chorusA = ctx.createOscillator();
    chorusA.setPeriodicWave(wave);
    chorusB = ctx.createOscillator();
    chorusB.setPeriodicWave(wave);
    chorusA.connect(chorusFilter);
    chorusB.connect(chorusFilter);
    chorusFilter.connect(chorusGain).connect(master);
    chorusA.start();
    chorusB.start();
  }

  function updateAmbientChorus(cars, playerState) {
    if (!ctx) return;
    ensureChorus();
    const now = ctx.currentTime;
    const phase = lastPhase;
    let count = 0;
    let speedSum = 0;
    const radiusSq = CHORUS_RADIUS * CHORUS_RADIUS;
    for (const car of cars) {
      if (car.group && !car.group.visible) continue;
      const dx = car.x - playerState.x;
      const dz = car.z - playerState.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      count++;
      speedSum += Math.abs(car.speed || 0);
      if (count >= CHORUS_MAX_VOICES) break;
    }
    const presence = count / CHORUS_MAX_VOICES;
    let chorusRpm;
    let level;
    if (phase === "grid") {
      chorusRpm = IDLE_RPM + gridIntensity * (LAUNCH_RPM - IDLE_RPM);
      level = presence * (0.02 + gridIntensity * 0.05);
    } else if (phase === "driving") {
      const avg = count ? speedSum / count / 84 : 0;
      chorusRpm = avg < 0.02 ? IDLE_RPM : GEAR_LOW_RPM + Math.min(avg, 1) * 2000;
      level = presence * 0.035;
    } else {
      chorusRpm = IDLE_RPM;
      level = presence * 0.012;
    }
    const f = rpmToHz(chorusRpm);
    chorusA.frequency.setTargetAtTime(f * 0.985, now, 0.25);
    chorusB.frequency.setTargetAtTime(f * 1.012, now, 0.25);
    chorusFilter.frequency.setTargetAtTime(500 + (chorusRpm / REDLINE_RPM) * 1400, now, 0.3);
    chorusGain.gain.setTargetAtTime(level, now, 0.25);
  }

  // 0..1: how hard the rest of the grid is revving during the start
  // sequence (see main.js's race-start lights).
  function setGridIntensity(value) {
    gridIntensity = Math.min(Math.max(value, 0), 1);
  }

  // After the chequered flag the HUD stops updating; settle the engine to
  // a quiet idle instead of freezing at whatever it was doing.
  function coolDown() {
    coolingDown = true;
    if (!ctx) return;
    const now = ctx.currentTime;
    engineOut.gain.setTargetAtTime(0.035, now, 0.6);
    mainOsc.frequency.setTargetAtTime(rpmToHz(IDLE_RPM), now, 0.4);
    subOsc.frequency.setTargetAtTime(rpmToHz(IDLE_RPM) / 3, now, 0.4);
    halfOsc.frequency.setTargetAtTime(rpmToHz(IDLE_RPM) * 0.5, now, 0.4);
    noiseGain.gain.setTargetAtTime(0.02, now, 0.4);
    turboGain.gain.setTargetAtTime(0, now, 0.4);
    bodyFilter.frequency.setTargetAtTime(900, now, 0.4);
    if (chorusGain) chorusGain.gain.setTargetAtTime(0, now, 1);
  }

  return {
    arm,
    isArmed: () => !!ctx,
    updateEngineSound,
    playShiftClick,
    playExhaustPop,
    updateAmbientChorus,
    setGridIntensity,
    coolDown,
  };
}
