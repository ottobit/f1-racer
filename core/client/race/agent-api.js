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
// Continuous control (#201): `act()` holds a command until the next act(),
// the lease running out, release() or a human touching a control — no
// neutral gap between two commands. `enqueue()` plays a short list of
// timed segments. With WebMCP (`navigator.modelContext`) the same calls are
// also exposed as the tools f1_observe / f1_act / f1_enqueue / f1_release.
//
//   await window._ENVIRONMENT_.act({ steer: -0.3, throttle: 1, leaseMs: 1500 });
//   await window._ENVIRONMENT_.enqueue([{ steer: 0.2, throttle: 1, durationMs: 400 }]);
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
  const DEFAULT_LEASE_MS = 1000;
  const MAX_LEASE_MS = 5000; // no act() can pin an input for longer
  const MAX_QUEUE_SEGMENTS = 10;
  const MAX_QUEUE_MS = 5000;
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
          // Another room participant (human or bot), not a local AI (#201).
          remote: !!car.isRemote,
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
      control: controlSnapshot(),
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

  // One controller for step(), act() and enqueue() (#201). Each command
  // bumps `generation`, so a timer left over from an older command can
  // never neutralise a newer one.
  let controlMode = "human"; // human | agent | released
  let applied = { steer: 0, throttle: 0, brake: 0 };
  let leaseTimer = null;
  let leaseEndsAt = 0;
  let queue = null; // { segments, index }
  let generation = 0;

  function clearTimers() {
    clearTimeout(leaseTimer);
    leaseTimer = null;
    leaseEndsAt = 0;
    queue = null;
  }

  function apply(command) {
    applied = {
      steer: clampRange(Number(command.steer) || 0, -1, 1),
      throttle: clamp01(Number(command.throttle) || 0),
      brake: clamp01(Number(command.brake) || 0),
    };
    setExternalSteer(applied.steer);
    setThrottleBrake(applied.throttle, applied.brake);
    controlMode = "agent";
  }

  function neutral(mode) {
    clearTimers();
    applied = { steer: 0, throttle: 0, brake: 0 };
    setExternalSteer(mode === "agent" ? 0 : null);
    setThrottleBrake(0, 0);
    controlMode = mode;
  }

  function controlSnapshot() {
    return {
      mode: controlMode,
      ...applied,
      leaseRemainingMs: leaseEndsAt ? Math.max(0, Math.round(leaseEndsAt - performance.now())) : 0,
      queue: queue ? { index: queue.index, length: queue.segments.length } : null,
    };
  }

  // Holds `command` for `ms`, then calls `onEnd` unless something newer
  // took over in the meantime.
  function hold(command, ms, onEnd) {
    clearTimeout(leaseTimer);
    apply(command);
    const mine = generation;
    leaseEndsAt = performance.now() + ms;
    leaseTimer = setTimeout(() => {
      if (mine === generation) onEnd();
    }, ms);
  }

  async function act(command = {}) {
    generation++;
    clearTimers();
    const leaseMs = clampRange(Number(command.leaseMs) || DEFAULT_LEASE_MS, 50, MAX_LEASE_MS);
    hold(command, leaseMs, () => neutral("released"));
    return getState();
  }

  async function enqueue(segments = []) {
    if (!Array.isArray(segments) || !segments.length) throw new Error("f1-agent-api: enqueue needs at least one segment");
    if (segments.length > MAX_QUEUE_SEGMENTS) throw new Error(`f1-agent-api: at most ${MAX_QUEUE_SEGMENTS} segments`);
    const timed = segments.map((segment) => ({ ...segment, durationMs: clampRange(Number(segment.durationMs) || DEFAULT_STEP_MS, 50, MAX_QUEUE_MS) }));
    if (timed.reduce((sum, segment) => sum + segment.durationMs, 0) > MAX_QUEUE_MS) {
      throw new Error(`f1-agent-api: a queue lasts at most ${MAX_QUEUE_MS}ms`);
    }
    generation++;
    clearTimers();
    queue = { segments: timed, index: 0 };
    const playFrom = (index) => {
      queue.index = index;
      hold(timed[index], timed[index].durationMs, () => {
        if (index + 1 < timed.length) playFrom(index + 1);
        else neutral("released");
      });
    };
    playFrom(0);
    return getState();
  }

  // Kept for compatibility: a held command for durationMs, then neutral
  // steering and pedals before it resolves (the old contract).
  let stepping = false;
  async function step(action = {}) {
    if (stepping) throw new Error("f1-agent-api: a step is already in progress");
    stepping = true;
    try {
      const durationMs = clampRange(Number(action.durationMs) || DEFAULT_STEP_MS, 50, MAX_STEP_MS);
      generation++;
      clearTimers();
      const mine = generation;
      hold(action, durationMs, () => {});
      // Its own timer: the step resolves even when a human or a newer
      // command took over in the meantime.
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      if (mine === generation) neutral("agent");
      return getState();
    } finally {
      stepping = false;
    }
  }

  // Registered as the input module's onHumanInput callback (see main.js):
  // called synchronously from the real DOM key/pointer handlers, never by
  // this module itself, so it's a reliable "a human just touched a real
  // control" signal distinct from the agent's own programmatic input.
  function handBackToHuman() {
    if (controlMode === "human") return;
    generation++;
    clearTimers();
    applied = { steer: 0, throttle: 0, brake: 0 };
    controlMode = "human";
    setExternalSteer(null);
    if (agentHoldsForward) { input.forward = false; agentHoldsForward = false; }
    if (agentHoldsBack) { input.back = false; agentHoldsBack = false; }
  }

  function release() {
    generation++;
    neutral("released");
    return getState();
  }

  // Leaving the page or the tab going away drops any agent command.
  window.addEventListener("pagehide", () => { if (controlMode === "agent") release(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && controlMode === "agent") release();
  });

  window._ENVIRONMENT_ = { getState, step, act, enqueue, release };
  registerWebMcpTools({ getState, act, enqueue, release });
  window.dispatchEvent(new CustomEvent("f1-environment-ready"));

  return { onHumanInput: handBackToHuman };
}

// WebMCP bridge (#201): the same controller as window._ENVIRONMENT_, as
// tools for browsers that expose navigator.modelContext. Only reached with
// ?agent=1 (this module is not loaded otherwise); without WebMCP nothing
// changes.
function registerWebMcpTools({ getState, act, enqueue, release }) {
  const modelContext = navigator.modelContext;
  if (!modelContext) return;
  const reply = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
  const command = {
    steer: { type: "number", minimum: -1, maximum: 1, description: "-1 left, +1 right" },
    throttle: { type: "number", minimum: 0, maximum: 1 },
    brake: { type: "number", minimum: 0, maximum: 1 },
  };
  const tools = [
    {
      name: "f1_observe",
      description: "Read the race state of the car this page drives.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => reply(getState()),
    },
    {
      name: "f1_act",
      description: "Hold steer/throttle/brake until the next f1_act, the lease running out (ms, max 5000), f1_release or a human input.",
      inputSchema: { type: "object", properties: { ...command, leaseMs: { type: "number", minimum: 50, maximum: 5000 } } },
      execute: async (args) => reply(await act(args || {})),
    },
    {
      name: "f1_enqueue",
      description: "Play up to 10 timed segments (total at most 5000 ms), then go neutral. Replaced by f1_act, f1_release or a human input.",
      inputSchema: {
        type: "object",
        properties: {
          segments: {
            type: "array",
            maxItems: 10,
            items: { type: "object", properties: { ...command, durationMs: { type: "number", minimum: 50, maximum: 5000 } } },
          },
        },
        required: ["segments"],
      },
      execute: async (args) => reply(await enqueue(args?.segments || [])),
    },
    {
      name: "f1_release",
      description: "Drop every agent command at once and hand the car back.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => reply(release()),
    },
  ];
  try {
    if (typeof modelContext.registerTool === "function") tools.forEach((tool) => modelContext.registerTool(tool));
    else if (typeof modelContext.provideContext === "function") modelContext.provideContext({ tools });
  } catch (error) {
    console.warn("f1-agent-api: WebMCP registration failed", error);
  }
}
