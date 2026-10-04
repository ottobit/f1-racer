import { DriveController } from "./drive-controller.js?v=1";

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
// timed segments. Native WebMCP is an optional adapter; in multiplayer the
// same tools can also be reached through the room server's authenticated
// WebSocket relay, so a normal browser remains controllable by an external
// MCP client.
//
//   await window._ENVIRONMENT_.act({ steer: -0.3, throttle: 1, leaseMs: 1500 });
//   await window._ENVIRONMENT_.enqueue([{ steer: 0.2, throttle: 1, durationMs: 400 }]);
//
// Radio (#288): `radio(text)` (tool `f1_radio`) shows a banner and relays it
// to the room, max 80 characters, like the strategy drivers' radio.
//   window._ENVIRONMENT_.radio("Box box, tyres gone");
//
// Known limitation: pedals are digital in this game (input.forward/back are
// booleans, not an analog throttle/brake channel) — `throttle`/`brake` are
// accepted as 0..1 per the MVP contract but thresholded to on/off under the
// hood, converging on the exact same input the human player uses rather
// than adding a second, parallel physics path. DRS is fully automatic here
// (gap-based, see updateDrsEligibility in main.js), not a manual control
// for player or AI, so there is no `drs` action — only the read-only
// `drsActive` status in getState().
// Sign contract of getState() (#289) — one convention, steer +1 = right:
//   steer                +1 turns right (heading decreases), -1 turns left.
//   lateralOffsetMeters  > 0 = car is LEFT of the centerline, < 0 = right.
//   headingErrorRad      car heading minus the centerline direction at the
//                        nearest sample, wrapped to (-pi, pi]; > 0 = nose
//                        points left of the track direction. It is continuous
//                        (only wraps at +-pi) but its reference rotates with
//                        the track, so through a left-to-right corner it
//                        legitimately goes from negative to positive.
//   returnHeadingErrorRad same sign, relative to the way back to the track.
// Positive error on either axis is corrected by a positive (right) steer.
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
  registerRemoteBridge = null,
  sendRadio = () => {},
  driveProvider = null,
}) {
  const KMH_PER_UNIT = 3.6; // matches race-hud.js's own speed readout
  const DEFAULT_STEP_MS = 500;
  const RADIO_MAX_CHARS = 80;
  const MAX_STEP_MS = 3000; // safe upper bound: no step can pin an input forever
  const DEFAULT_LEASE_MS = 1000;
  const MAX_LEASE_MS = 5000; // no act() can pin an input for longer
  const MAX_QUEUE_SEGMENTS = 10;
  const MAX_QUEUE_MS = 5000;
  const CORNER_LOOKAHEAD_SAMPLES = 40;
  const NEARBY_CARS_LIMIT = 5;
  const driveController = driveProvider ? new DriveController({ provider: driveProvider }) : null;

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
    const onTrack = info.dist <= grassLimit;
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
      onTrack,
      // Off track only: heading minus the bearing to the nearest centerline
      // point (same sign as headingErrorRad), so steering it to 0 drives back
      // to the asphalt. null while on track (#292).
      returnHeadingErrorRad: onTrack ? null : round3(wrapAngle(state.heading - Math.atan2(info.x - state.x, info.z - state.z))),
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
  let driveFrame = null;
  let driveLastAt = 0;

  function stopDriveLoop() {
    if (driveFrame !== null) cancelAnimationFrame(driveFrame);
    driveFrame = null;
    driveLastAt = 0;
    driveController?.release();
  }

  function clearTimers() {
    clearTimeout(leaseTimer);
    leaseTimer = null;
    leaseEndsAt = 0;
    queue = null;
    stopDriveLoop();
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
      intent: driveController?.snapshot() || null,
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

  async function drive(intent = {}) {
    if (!driveController) throw new Error("f1-agent-api: high-level drive controller is unavailable");
    generation++;
    clearTimers();
    const mine = generation;
    const startedAt = performance.now();
    driveController.setIntent(intent, startedAt);
    driveLastAt = startedAt;
    const first = driveController.update(state, 0, startedAt);
    if (first) apply(first);

    const tick = (now) => {
      if (mine !== generation) return;
      const dt = Math.min(Math.max((now - driveLastAt) / 1000, 0), 0.1);
      driveLastAt = now;
      const command = driveController.update(state, dt, now);
      if (!command) {
        neutral("released");
        return;
      }
      apply(command);
      driveFrame = requestAnimationFrame(tick);
    };
    driveFrame = requestAnimationFrame(tick);
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

  // Radio call (#288): short text shown as the room banner and relayed to the
  // other participants, same limit as strategy.json's `radio`.
  function radio(text) {
    const message = String(text ?? "").trim().slice(0, RADIO_MAX_CHARS);
    if (!message) throw new Error("f1-agent-api: radio needs a non-empty text");
    sendRadio(message);
    return { ok: true, text: message };
  }

  async function invokeAgentTool(name, args = {}) {
    switch (name) {
      case "f1_observe": return getState();
      case "f1_act": return act(args || {});
      case "f1_drive": return drive(args || {});
      case "f1_enqueue": return enqueue(args?.segments || []);
      case "f1_release": return release();
      case "f1_radio": return radio(args?.text);
      default: throw new Error(`f1-agent-api: unknown tool ${name}`);
    }
  }

  window._ENVIRONMENT_ = { getState, step, act, drive, enqueue, release, radio, bridge: null };
  registerWebMcpTools({ invokeAgentTool });

  // Browser-independent realtime bridge (#201). A long, caller-provided
  // ?agentToken= can be used by automation; otherwise the server generates
  // a random bearer token and exposes it only on this page's environment.
  if (registerRemoteBridge) {
    const requestedToken = new URLSearchParams(location.search).get("agentToken");
    Promise.resolve(registerRemoteBridge(invokeAgentTool, requestedToken))
      .then((info) => {
        window._ENVIRONMENT_.bridge = { status: "ready", ...info };
        window.dispatchEvent(new CustomEvent("f1-agent-bridge-ready", { detail: info }));
        console.info("f1-agent-api: realtime bridge ready");
      })
      .catch((error) => {
        window._ENVIRONMENT_.bridge = { status: "error", message: error?.message || String(error) };
        console.warn("f1-agent-api: realtime bridge registration failed", error);
      });
  }

  window.dispatchEvent(new CustomEvent("f1-environment-ready"));

  return { onHumanInput: handBackToHuman };
}

// WebMCP adapter (#201): native support is optional. Prefer the current
// document.modelContext surface, retain navigator.modelContext for older
// experimental builds, and always dispatch into the same controller used by
// the realtime WebSocket bridge.
function registerWebMcpTools({ invokeAgentTool }) {
  const modelContext = document.modelContext || navigator.modelContext;
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
      description: "Read the race state of the car this page drives. Signs: steer +1 = right; lateralOffsetMeters > 0 = left of the centerline; headingErrorRad > 0 = nose left of the track direction (positive error is fixed by positive steer).",
      inputSchema: { type: "object", properties: {} },
      execute: async () => reply(await invokeAgentTool("f1_observe", {})),
    },
    {
      name: "f1_act",
      description: "Hold steer/throttle/brake until the next f1_act, the lease running out (ms, max 5000), f1_release or a human input.",
      inputSchema: { type: "object", properties: { ...command, leaseMs: { type: "number", minimum: 50, maximum: 5000 } } },
      execute: async (args) => reply(await invokeAgentTool("f1_act", args || {})),
    },
    {
      name: "f1_drive",
      description: "Set a bounded high-level driving intent. A browser-local controller converts pace/line targets into frame-rate steer/throttle/brake using the existing geometry autopilot.",
      inputSchema: {
        type: "object",
        properties: {
          pace: { type: "number", minimum: 0.5, maximum: 1 },
          line: { type: "number", minimum: -1, maximum: 1, description: "Normalized lateral racing-line target." },
          horizonMs: { type: "number", minimum: 100, maximum: 5000 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      execute: async (args) => reply(await invokeAgentTool("f1_drive", args || {})),
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
      execute: async (args) => reply(await invokeAgentTool("f1_enqueue", args || {})),
    },
    {
      name: "f1_radio",
      description: "Send a short radio message (max 80 characters) shown to everyone in the room.",
      inputSchema: { type: "object", properties: { text: { type: "string", maxLength: 80 } }, required: ["text"] },
      execute: async (args) => reply(await invokeAgentTool("f1_radio", args || {})),
    },
    {
      name: "f1_release",
      description: "Drop every agent command at once and hand the car back.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => reply(await invokeAgentTool("f1_release", {})),
    },
  ];
  try {
    if (typeof modelContext.registerTool === "function") tools.forEach((tool) => modelContext.registerTool(tool));
    else if (typeof modelContext.provideContext === "function") modelContext.provideContext({ tools });
  } catch (error) {
    console.warn("f1-agent-api: WebMCP registration failed", error);
  }
}
