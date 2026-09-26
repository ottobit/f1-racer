// Agent API MVP (#176): lets an external agent — including Codex — drive
// the player car from an already-open race page, through
// `window._ENVIRONMENT_`, without simulating touch/keyboard events.
//
// Only wired up when the page is loaded with `?agent=1` (see main.js); a
// normal human session never imports or runs any of this.
//
// Console usage, once `f1-environment-ready` has fired on `window`:
//
//   const s = window._ENVIRONMENT_.getState();
//   // Accelerate in a straight line for 800ms:
//   await window._ENVIRONMENT_.step({ throttle: 1, durationMs: 800 });
//   // Turn left into the next corner:
//   await window._ENVIRONMENT_.step({ steer: -0.4, throttle: 0.6, durationMs: 600 });
//   // Hand control back to the human:
//   window._ENVIRONMENT_.release();
//
// Known limitation: pedals are digital in this game (input.forward/back are
// booleans, not an analog throttle/brake channel) — `throttle`/`brake` are
// accepted as 0..1 per the MVP contract but thresholded to on/off under the
// hood, converging on the exact same input the human player uses rather
// than adding a second, parallel physics path. DRS is fully automatic here
// (gap-based, see updateDrsEligibility in main.js), not a manual control
// for player or AI, so there is no `drs` action — only the read-only
// `drsActive` status in getState().
export function setupAgentApi({
  state,
  aiCars,
  input,
  setExternalSteer,
  centerline,
  headingOf,
  sideNormal,
  nearestTrackInfo,
  currentRaceOrder,
  trackLength,
  grassLimit,
  lapsPerRace,
  tyreLifeLaps,
  getSessionPhase,
  getRaceState,
  getQualiState,
  isCautionActive = () => false,
  isRaining = false,
  circuitName = "",
  nameOf = (id) => id,
}) {
  const KMH_PER_UNIT = 3.6; // matches race-hud.js's own speed readout
  const DEFAULT_STEP_MS = 500;
  const MAX_STEP_MS = 3000; // safe upper bound: no step can pin an input forever
  const CORNER_LOOKAHEAD_SAMPLES = 40;
  const NEARBY_CARS_LIMIT = 5;

  const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
  const clampRange = (v, min, max) => Math.min(Math.max(v, min), max);
  const round1 = (v) => Math.round(v * 10) / 10;
  const round3 = (v) => Math.round(v * 1000) / 1000;
  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  // Signed distance from the centerline at `info`, positive = right of the
  // direction of travel (see sideNormal's own convention in main.js).
  function lateralOffset(x, z, info) {
    const p = centerline[info.idx];
    const n = sideNormal(p);
    return (x - p.x) * n.x + (z - p.z) * n.z;
  }

  // Heuristic, not a geometric radius: the largest heading change found
  // within a fixed lookahead window, and how far ahead it peaks. Cheap,
  // and enough for an agent to know "ease off, a corner is coming" without
  // shipping the whole spline.
  function nextCornerInfo(idx) {
    const base = headingOf(centerline[idx]);
    let maxTurn = 0;
    let maxAt = 1;
    for (let i = 1; i <= CORNER_LOOKAHEAD_SAMPLES; i++) {
      const p = centerline[(idx + i) % centerline.length];
      const dh = wrapAngle(headingOf(p) - base);
      if (Math.abs(dh) > Math.abs(maxTurn)) {
        maxTurn = dh;
        maxAt = i;
      }
    }
    return {
      direction: maxTurn > 0.05 ? "right" : maxTurn < -0.05 ? "left" : "straight",
      distanceMeters: round1((maxAt / centerline.length) * trackLength),
      curvature: round3(Math.abs(maxTurn)),
    };
  }

  function nearbyCars() {
    const selfInfo = nearestTrackInfo(state.x, state.z);
    const selfLateral = lateralOffset(state.x, state.z, selfInfo);
    return aiCars
      .map((car) => {
        const gapMeters = (car.totalProgress - state.totalProgress) * trackLength;
        const carInfo = nearestTrackInfo(car.x, car.z);
        const carLateral = lateralOffset(car.x, car.z, carInfo);
        return {
          id: car.driverId,
          relative: gapMeters >= 0 ? "ahead" : "behind",
          distanceMeters: round1(Math.abs(gapMeters)),
          lateralOffsetMeters: round1(carLateral - selfLateral),
        };
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, NEARBY_CARS_LIMIT);
  }

  // Seconds to cover a gap at the follower's pace; null when either side is
  // too slow for the estimate to mean anything (#186).
  function gapSeconds(meters, speed) {
    return speed > 5 ? round1(meters / speed) : null;
  }

  function getState() {
    const info = nearestTrackInfo(state.x, state.z);
    const order = currentRaceOrder();
    const position = order.findIndex((entry) => entry.driverId === "player") + 1;
    const idealHeading = headingOf(centerline[info.idx]);
    const sessionPhase = getSessionPhase();
    const raceState = getRaceState();
    const finished = raceState === "finished";
    return {
      timestamp: Date.now(),
      session: {
        phase: sessionPhase,
        state: sessionPhase === "qualifying" ? getQualiState() : raceState,
      },
      speedKmh: round1(state.speed * KMH_PER_UNIT),
      lap: state.completedLaps,
      lapsTotal: lapsPerRace,
      position: position || null,
      totalProgress: round3(state.totalProgress),
      lateralOffsetMeters: round1(lateralOffset(state.x, state.z, info)),
      headingErrorRad: round3(wrapAngle(state.heading - idealHeading)),
      onTrack: info.dist <= grassLimit,
      damagePct: Math.round((state.damage || 0) * 100),
      tyreCompound: state.tyreCompound,
      tyreWearPct: Math.round(clamp01((state.tyreProgress || 0) / tyreLifeLaps) * 100),
      drsActive: !!state.drsActive,
      nextCorner: nextCornerInfo(info.idx),
      nearbyCars: nearbyCars(),
      // Richer race picture for strategy agents (#186).
      circuit: circuitName,
      weather: isRaining ? "rain" : "dry",
      safetyCar: isCautionActive(),
      lapTimes: {
        currentMs: Math.round(state.currentLapTime || 0),
        lastMs: state.lastLapTime ? Math.round(state.lastLapTime) : null,
        bestMs: state.bestLapTime ? Math.round(state.bestLapTime) : null,
      },
      ers: { chargePct: Math.round(state.ersCharge ?? 0), active: !!state.ersActive },
      pit: { state: state.pitState, requested: !!state.pitRequested },
      gapAheadS: position > 1 ? gapSeconds((order[position - 2].totalProgress - state.totalProgress) * trackLength, state.speed) : null,
      gapBehindS: position && position < order.length
        ? gapSeconds((state.totalProgress - order[position].totalProgress) * trackLength, aiCars.find((c) => c.driverId === order[position].driverId)?.speed || 0)
        : null,
      standings: order.map((entry, index) => ({
        position: index + 1,
        id: entry.driverId,
        name: entry.driverId === "player" ? "TU" : nameOf(entry.driverId),
        lap: Math.floor(entry.totalProgress) + 1,
        gapToLeaderMeters: round1((order[0].totalProgress - entry.totalProgress) * trackLength),
      })),
      finished,
      raceResult: finished
        ? order.map((entry) => ({ id: entry.driverId, position: entry.finishPosition }))
        : null,
    };
  }

  // Tracked separately from `input.forward`/`input.back` themselves so a
  // human grabbing a *different* pedal than the one the agent is holding
  // doesn't get silently overridden when control hands back (see
  // handBackToHuman below) — only what the agent itself is still holding
  // gets released.
  let agentHoldsForward = false;
  let agentHoldsBack = false;
  function setThrottleBrake(throttle, brake) {
    agentHoldsForward = throttle > 0;
    agentHoldsBack = !agentHoldsForward && brake > 0;
    input.forward = agentHoldsForward;
    input.back = agentHoldsBack;
  }

  let stepping = false;
  let stepAbort = null;
  function abortActiveStep() {
    if (stepAbort) stepAbort();
  }

  // Registered as the input module's onHumanInput callback (see main.js):
  // called synchronously from the real DOM key/pointer handlers, never by
  // this module itself, so it's a reliable "a human just touched a real
  // control" signal distinct from the agent's own programmatic input.
  function handBackToHuman() {
    abortActiveStep();
    setExternalSteer(null);
    if (agentHoldsForward) { input.forward = false; agentHoldsForward = false; }
    if (agentHoldsBack) { input.back = false; agentHoldsBack = false; }
  }

  async function step(action = {}) {
    if (stepping) throw new Error("f1-agent-api: a step is already in progress");
    stepping = true;
    let aborted = false;
    stepAbort = () => { aborted = true; };
    try {
      const steer = clampRange(Number(action.steer) || 0, -1, 1);
      const throttle = clamp01(Number(action.throttle) || 0);
      const brake = clamp01(Number(action.brake) || 0);
      const durationMs = clampRange(Number(action.durationMs) || DEFAULT_STEP_MS, 50, MAX_STEP_MS);

      setExternalSteer(steer);
      setThrottleBrake(throttle, brake);

      await new Promise((resolve) => setTimeout(resolve, durationMs));

      if (!aborted) {
        setThrottleBrake(0, 0);
        setExternalSteer(0);
      }
      return getState();
    } finally {
      stepping = false;
      stepAbort = null;
    }
  }

  function release() {
    abortActiveStep();
    setExternalSteer(null);
    setThrottleBrake(0, 0);
    return getState();
  }

  window._ENVIRONMENT_ = { getState, step, release };
  window.dispatchEvent(new CustomEvent("f1-environment-ready"));

  return { onHumanInput: handBackToHuman };
}
