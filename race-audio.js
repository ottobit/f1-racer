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
// Synthesised, not a sample — this site has no audio assets and no build
// step to fetch/bundle one. Two detuned oscillators (a low sawtooth for
// body, a square an octave-and-a-half up for grit) through a lowpass filter
// whose cutoff opens up with revs, roughly like an engine's tone
// brightening as it climbs through a gear — see gearInfo() above for why
// that's gear-relative "revs" and not just raw speed. Browsers block audio
// before any user gesture, so the AudioContext is only created lazily on
// the first key/touch input.
//
// Currently drives only the player's own engine (see issue #10 for adding
// audible AI/grid-start engines on top of this).
export function setupRaceAudio({ getRaceState }) {
  let audioCtx = null;
  let engineGain = null;
  let engineFilter = null;
  let engineOsc1 = null;
  let engineOsc2 = null;
  let engineOsc3 = null;
  let engineHighpass = null;
  let engineCompressor = null;

  function initEngineSound() {
    if (audioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return; // no Web Audio support: fail silent, not fatal
    audioCtx = new Ctx();

    engineGain = audioCtx.createGain();
    engineGain.gain.value = 0;

    engineFilter = audioCtx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 300;

    engineOsc1 = audioCtx.createOscillator();
    engineOsc1.type = "sawtooth";
    engineOsc1.frequency.value = 45;

    engineOsc2 = audioCtx.createOscillator();
    engineOsc2.type = "triangle";
    engineOsc2.frequency.value = 45 * 2;
    const osc2Gain = audioCtx.createGain();
    osc2Gain.gain.value = 0.32;

    engineOsc3 = audioCtx.createOscillator();
    engineOsc3.type = "sawtooth";
    engineOsc3.frequency.value = 45 * 3;
    const osc3Gain = audioCtx.createGain();
    osc3Gain.gain.value = 0.1;

    engineHighpass = audioCtx.createBiquadFilter();
    engineHighpass.type = "highpass";
    engineHighpass.frequency.value = 70;
    engineCompressor = audioCtx.createDynamicsCompressor();
    engineCompressor.threshold.value = -18;
    engineCompressor.knee.value = 12;
    engineCompressor.ratio.value = 4;

    engineOsc1.connect(engineFilter);
    engineOsc2.connect(osc2Gain).connect(engineFilter);
    engineOsc3.connect(osc3Gain).connect(engineFilter);
    engineFilter.connect(engineHighpass).connect(engineGain).connect(engineCompressor).connect(audioCtx.destination);

    engineOsc1.start();
    engineOsc2.start();
    engineOsc3.start();
  }

  // speedRatio (0..1 of top speed) drives volume, which should keep rising
  // with real speed; rpmRatio (0..1, resets each gear — see gearInfo()) drives
  // pitch and filter brightness, which should climb through a gear and drop
  // at the next shift, the way an engine actually sounds. Silent during the
  // grid countdown (race state isn't "racing" yet) so the note only kicks in
  // once the lights go out.
  function updateEngineSound(speedRatio, rpmRatio) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const baseFreq = 70 + rpmRatio * 260;
    engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.025);
    engineOsc2.frequency.setTargetAtTime(baseFreq * 2.01, now, 0.025);
    engineOsc3.frequency.setTargetAtTime(baseFreq * 3.02, now, 0.025);
    engineFilter.frequency.setTargetAtTime(650 + rpmRatio * 4200 + speedRatio * 900, now, 0.035);
    engineHighpass.frequency.setTargetAtTime(65 + speedRatio * 70, now, 0.08);
    const targetGain = getRaceState() === "racing" ? 0.045 + speedRatio * 0.11 : 0;
    engineGain.gain.setTargetAtTime(targetGain, now, 0.08);
  }

  // A short percussive "thunk" layered over the continuous engine tone, fired
  // once per gear change (see updateHud). The pitch drop in the engine note
  // already implies a shift; a discrete click sells it as one.
  function playShiftClick() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.05);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  return { initEngineSound, updateEngineSound, playShiftClick };
}
