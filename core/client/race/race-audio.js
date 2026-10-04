// --- Engine profiles -------------------------------------------------------
//
// One synthesised engine per car (#319). The F1 profile holds the original
// values, so the F1 sounds exactly as before; the road cars (free drive and
// the Classiche series) get their own revs, firing order, timbre and gearbox.
//
// - idle/launch/gearLow/redline: RPM at idle, at a standing launch, just
//   after an upshift and at the top of each gear;
// - firings: combustions per crank revolution (cylinders / 2 for a
//   four-stroke); the firing tone sits at rpm / 60 * firings;
// - gears: fractions of top speed at which each gear tops out — not evenly
//   spaced, since lower gears cover much less ground than higher ones;
// - wave: harmonic count, roll-off and per-harmonic boosts of the firing
//   tone (low roll-off = sharp, pulse-like "putt-putt");
// - the rest are mix levels: crank sub, half-order growl, idle lump, intake/
//   mechanical noise, turbo whistle and the load/rev low-pass; the timing
//   values (rev rates, start-up crank, grid revs) set how lazily it revs.
const F1_GEARS = [0.09, 0.19, 0.31, 0.45, 0.6, 0.75, 0.89, 1.0];
const FOUR_GEARS = [0.22, 0.45, 0.72, 1.0];
const FIVE_GEARS = [0.17, 0.35, 0.55, 0.77, 1.0];

const F1_ENGINE = {
  // 1.6 V6 turbo-hybrid: idle ~4600, launch ~10800, ~9800-12400 through each
  // gear; three firings per revolution, so ~230 Hz at idle and 490-620 Hz on
  // the move — the high-pitched howl of a modern F1 car.
  idle: 4600, launch: 10800, gearLow: 9800, redline: 12400, firings: 3,
  gears: F1_GEARS,
  wave: { n: 28, decay: 0.8, even: 0.85, boost: { 2: 1.35, 3: 1.2 }, every: 6, everyBoost: 1.5 },
  sub: 0.3, half: 0.22, lump: 0.28, lumpDiv: 24,
  noise: [0.03, 0.12], noiseMul: 3.5, turbo: true,
  filter: [650, 3600, 2600], liftDrop: 700,
  rates: [45000, 30000, 32000, 11000], startup: [700, 900, 8200], chorusSpan: 2000,
  gridRev: 900, wobble: 250,
};

// Road engines: the shared timing values follow from the rev range.
function roadEngine({ idle, redline, ...rest }) {
  return {
    idle, redline,
    launch: Math.round(idle + (redline - idle) * 0.55),
    gearLow: Math.round(redline * 0.62),
    turbo: false, noiseMul: 4, lumpDiv: 6,
    liftDrop: Math.round(redline * 0.08),
    rates: [redline * 2.6, redline * 2, redline * 2.2, redline],
    startup: [idle * 0.2, idle * 0.3, Math.round(idle * 2.6)],
    chorusSpan: Math.round(redline * 0.3),
    gridRev: Math.round(redline * 0.12),
    wobble: Math.round(redline * 0.03),
    ...rest,
  };
}

export const ENGINE_PROFILES = {
  f1: F1_ENGINE,
  // Air-cooled 500 twin: one firing per revolution, thin and lumpy, lots
  // of mechanical clatter.
  cinquino: roadEngine({
    idle: 900, redline: 5000, firings: 1, gears: FOUR_GEARS,
    wave: { n: 56, decay: 0.45, even: 1, boost: { 2: 1.2 } },
    sub: 0.35, half: 0.3, lump: 0.45, noise: [0.06, 0.1], noiseMul: 6,
    filter: [520, 1800, 1500],
  }),
  // 1.0 inline four: a flat, buzzy little-car hum.
  pandina: roadEngine({
    idle: 850, redline: 6000, firings: 2, gears: FIVE_GEARS,
    wave: { n: 36, decay: 0.9, even: 1, boost: { 2: 1.3 } },
    sub: 0.25, half: 0.12, lump: 0.15, noise: [0.03, 0.06],
    filter: [450, 1500, 1200],
  }),
  // Twin-cam four: open and raspy at the top.
  spider: roadEngine({
    idle: 900, redline: 7200, firings: 2, gears: FIVE_GEARS,
    wave: { n: 44, decay: 0.65, even: 0.9, boost: { 2: 1.2, 4: 1.3 } },
    sub: 0.3, half: 0.18, lump: 0.18, noise: [0.04, 0.12],
    filter: [600, 2600, 2000],
  }),
  // Air-cooled flat four: a rough, closed-in chug.
  pulmino: roadEngine({
    idle: 800, redline: 4500, firings: 2, gears: FOUR_GEARS,
    wave: { n: 44, decay: 0.6, even: 1, boost: { 3: 1.3 } },
    sub: 0.3, half: 0.35, lump: 0.3, noise: [0.06, 0.08], noiseMul: 5,
    filter: [380, 1300, 900],
  }),
  // Cross-plane V8: four firings per revolution, uneven — a deep loping
  // burble at idle, a full roar at the top.
  muscle: roadEngine({
    idle: 700, redline: 6000, firings: 4, gears: FOUR_GEARS,
    wave: { n: 36, decay: 0.85, even: 1, boost: { 2: 1.4 } },
    sub: 0.45, half: 0.4, lump: 0.38, lumpDiv: 8, noise: [0.04, 0.1],
    filter: [420, 2200, 1500],
  }),
  // Gentle inline four: soft and muffled.
  familiare: roadEngine({
    idle: 850, redline: 5500, firings: 2, gears: FOUR_GEARS,
    wave: { n: 28, decay: 1, even: 1, boost: {} },
    sub: 0.25, half: 0.1, lump: 0.12, noise: [0.02, 0.05],
    filter: [400, 1300, 1000],
  }),
};

export function engineProfile(id) {
  return ENGINE_PROFILES[id] ?? F1_ENGINE;
}

// --- Gears -------------------------------------------------------------
//
// There's no manual shifting; the gear is purely a function of current
// speed. Which gear a fraction of top speed falls in, plus how far through
// that gear's own speed band the car sits (0..1, resets to 0 on every
// shift). That second number is what makes the engine note and shift
// lights climb through a gear and drop back down at the next shift,
// instead of just tracking raw speed in a straight line.
export function gearInfo(speedRatio, thresholds = F1_GEARS) {
  const ratio = Math.min(Math.max(speedRatio, 0), 1);
  let gear = thresholds.length;
  for (let g = 0; g < thresholds.length; g++) {
    if (ratio <= thresholds[g]) {
      gear = g + 1;
      break;
    }
  }
  const lower = gear === 1 ? 0 : thresholds[gear - 2];
  const upper = thresholds[gear - 1];
  const rpmRatio = upper > lower ? (ratio - lower) / (upper - lower) : 1;
  return { gear, rpmRatio: Math.min(Math.max(rpmRatio, 0), 1) };
}

// --- Engine sound ----------------------------------------------------------
//
// Synthesised, not a sample — the site has no audio assets and no build
// step. The engine keeps a real RPM value from its profile and the firing
// frequency follows it.
//
// Layers: a harmonic-rich firing tone (PeriodicWave), a crank-order sub for
// body, a half-order tone for growl, band-passed noise for intake/
// exhaust roar, and (F1 only) a faint turbo whistle — mixed, soft-clipped,
// then low-passed by engine load, so on-throttle is open and raspy and a
// lift is muffled. RPM has inertia (rises faster than it falls), so blips
// and upshift drops sound like a real engine rather than a pitch slider.
//
// Phases come from `getPhase()`: "grid" (car held on the line — idle, and
// the throttle free-revs the engine like a real driver on the grid),
// "driving" and "idle" (finished). Browsers only allow audio after a user
// gesture, so nothing exists until `arm()` is called from one.
//
// `engine` picks the player's profile, `field` the one the grid chorus
// (the other cars) is voiced with.
export function setupRaceAudio({ getPhase, getThrottle, engine = "f1", field = engine }) {
  const E = engineProfile(engine);
  const F = engineProfile(field);
  const rpmToHz = (rpm, p = E) => (rpm / 60) * p.firings;
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
  let volume = 1; // 0..1, the sound mix's engine level (#379)

  function firingWave({ n, decay, even, boost, every, everyBoost }) {
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      let a = 1 / Math.pow(k, decay);
      if (boost[k]) a *= boost[k];
      if (every && k % every === 0) a *= everyBoost;
      imag[k] = k % 2 ? a : -a * even;
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
      if (ctx.state === "suspended" && volume > 0) ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return; // no Web Audio: fail silent, not fatal
    ctx = new Ctx();
    const wave = firingWave(E.wave);

    master = ctx.createGain();
    master.gain.value = 0.9 * volume;
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
    subGain.gain.value = E.sub;
    subOsc.connect(subGain).connect(mix);

    halfOsc = ctx.createOscillator();
    halfOsc.type = "triangle";
    const halfGain = ctx.createGain();
    halfGain.gain.value = E.half;
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
    if (volume === 0) ctx.suspend();
    document.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend();
      else if (volume > 0) ctx.resume();
    });
  }

  function targetRpmFor(phase, throttle, speedRatio, rpmRatio, now) {
    if (startupAt >= 0) {
      // Fire-up: a short starter crank, the engine catches with a rev
      // flare, then settles to idle.
      const t = now - startupAt;
      if (t < 0.5) return E.startup[0] + t * E.startup[1];
      if (t < 0.85) return E.startup[2];
      startupAt = -1;
    }
    if (phase === "driving") {
      if (speedRatio < 0.015) return throttle ? E.launch : E.idle;
      const inGear = E.gearLow + rpmRatio * (E.redline - E.gearLow);
      return throttle ? inGear : inGear - E.liftDrop;
    }
    if (phase === "grid") {
      if (throttle) return E.launch + Math.sin(now * 7) * E.wobble;
      return E.idle + gridIntensity * E.gridRev;
    }
    return E.idle;
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
    const [riseDrive, riseFree, fallDrive, fallFree] = E.rates;
    const rate = rising ? (phase === "driving" ? riseDrive : riseFree) : (phase === "driving" ? fallDrive : fallFree);
    const step = rate * dt;
    rpm = rising ? Math.min(target, rpm + step) : Math.max(target, rpm - step);

    const loadTarget =
      phase === "driving" ? (throttle ? 1 : 0.25) :
      phase === "grid" ? (throttle ? 0.85 : 0.2) : 0.15;
    load += (loadTarget - load) * Math.min(dt * 10, 1);

    const f = rpmToHz(Math.max(rpm, 300));
    const revs = Math.min(rpm / E.redline, 1);
    mainOsc.frequency.setTargetAtTime(f, now, 0.01);
    subOsc.frequency.setTargetAtTime(f / E.firings, now, 0.01);
    halfOsc.frequency.setTargetAtTime(f * 0.5, now, 0.01);
    lumpLfo.frequency.setTargetAtTime(Math.max(f / E.lumpDiv, 4), now, 0.05);
    lumpDepth.gain.setTargetAtTime(E.lump * (1 - revs) * (1 - load * 0.7), now, 0.05);

    noiseFilter.frequency.setTargetAtTime(f * E.noiseMul, now, 0.02);
    noiseGain.gain.setTargetAtTime(E.noise[0] + E.noise[1] * load * revs, now, 0.04);
    if (E.turbo) {
      turboOsc.frequency.setTargetAtTime(1600 + revs * 4200 * (0.55 + 0.45 * load), now, 0.08);
      turboGain.gain.setTargetAtTime(0.002 + 0.012 * load * revs * revs, now, 0.1);
    }
    const [filterBase, filterLoad, filterRevs] = E.filter;
    bodyFilter.frequency.setTargetAtTime(filterBase + load * filterLoad + revs * filterRevs, now, 0.03);

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
    const wave = firingWave(F.wave);
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
      chorusRpm = F.idle + gridIntensity * (F.launch - F.idle);
      level = presence * (0.02 + gridIntensity * 0.05);
    } else if (phase === "driving") {
      const avg = count ? speedSum / count / 84 : 0;
      chorusRpm = avg < 0.02 ? F.idle : F.gearLow + Math.min(avg, 1) * F.chorusSpan;
      level = presence * 0.035;
    } else {
      chorusRpm = F.idle;
      level = presence * 0.012;
    }
    const f = rpmToHz(chorusRpm, F);
    chorusA.frequency.setTargetAtTime(f * 0.985, now, 0.25);
    chorusB.frequency.setTargetAtTime(f * 1.012, now, 0.25);
    chorusFilter.frequency.setTargetAtTime(500 + (chorusRpm / F.redline) * 1400, now, 0.3);
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
    mainOsc.frequency.setTargetAtTime(rpmToHz(E.idle), now, 0.4);
    subOsc.frequency.setTargetAtTime(rpmToHz(E.idle) / E.firings, now, 0.4);
    halfOsc.frequency.setTargetAtTime(rpmToHz(E.idle) * 0.5, now, 0.4);
    noiseGain.gain.setTargetAtTime(0.02, now, 0.4);
    turboGain.gain.setTargetAtTime(0, now, 0.4);
    bodyFilter.frequency.setTargetAtTime(900, now, 0.4);
    if (chorusGain) chorusGain.gain.setTargetAtTime(0, now, 1);
  }

  // Engine level from the sound mix (#379). At zero the context is
  // suspended outright, so a silenced engine costs no audio-thread work.
  function setVolume(value) {
    volume = Math.min(Math.max(value, 0), 1);
    if (!ctx) return;
    master.gain.setTargetAtTime(0.9 * volume, ctx.currentTime, 0.05);
    if (volume === 0) ctx.suspend();
    else if (ctx.state === "suspended" && !document.hidden) ctx.resume();
  }

  return {
    arm,
    setVolume,
    gearInfo: (speedRatio) => gearInfo(speedRatio, E.gears),
    isArmed: () => !!ctx,
    updateEngineSound,
    playShiftClick,
    playExhaustPop,
    updateAmbientChorus,
    setGridIntensity,
    coolDown,
  };
}
