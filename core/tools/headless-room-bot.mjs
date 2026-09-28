import { finishPullOver } from "../client/race/finish-pull-over.js";
// Node-only multiplayer driver. Unlike room-bot.mjs it never opens the game
// page, creates a WebGL renderer or needs Chromium: it joins the public room
// protocol directly and drives the SAME car as the browser (#214) — the
// player physics (player-physics.js), race rules (race-rules.js: tyres, ERS,
// DRS, runoff, grid), the real pit lane (race-systems.js), lap counting
// (race-progress.js), contact with the other cars (race-collisions.js) and
// the same autopilot + strategy layer as ?driver=layered
// (driver-providers.js). Only rendering, audio and the HUD are left out.
//
//   node core/tools/headless-room-bot.mjs <server> <ROOM> \
//     --name ChatGPT --dir /tmp/bot-ChatGPT [--driver rival-red-2]
//
// Strategy/state files work like room-bot.mjs: every change to
// <dir>/strategy.json goes to setStrategy (pace, line, ers, tyre, pit,
// station, radio); <dir>/state.json is rewritten every 2 s.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import tls from "node:tls";
import * as THREE from "three";
import { WebSocket } from "ws";
import { CIRCUITS, LAPS_PER_RACE, TYRE_LIFE_LAPS, getCircuit } from "../client/shared/circuits.js";
import { DRIVER_ROSTER, driverById } from "../client/shared/driver-roster.js";
import { DEFAULT_SETUP, setupEffects } from "../client/shared/garage-setup.js";
import { buildPitLane } from "../client/shared/pit-lane.js";
import {
  headingOf,
  nearestTrackInfo as nearestOnCenterline,
  sampleCenterline,
  sideNormal,
} from "../client/shared/track-geometry.js";
import { createAutopilotProvider, createLayeredProvider } from "../client/race/driver-providers.js";
import { setupPlayerPhysics } from "../client/race/player-physics.js";
import { setupCarCollisions } from "../client/race/race-collisions.js";
import { setupRaceProgress } from "../client/race/race-progress.js";
import {
  CAR_RADIUS,
  DAMAGE_MAX_SPEED_PENALTY,
  DAMAGE_MIN_IMPACT_SPEED,
  DAMAGE_PER_IMPACT_SPEED,
  DRS_SPEED_MULTIPLIER,
  ERS_DRAIN_PER_SECOND,
  ERS_RECHARGE_PER_SECOND,
  ERS_SPEED_MULTIPLIER,
  GRID_SLOTS,
  PIT_SERVICE_MS,
  PIT_SPEED_LIMIT,
  START_FINISH_OFFSET,
  TYRE_COMPOUNDS,
  createGridSlot,
  createTrackBoundary,
  createTyreModel,
  playerCarParams,
  updateDrsEligibility,
} from "../client/race/race-rules.js";
import { setupRaceSystems } from "../client/race/race-systems.js";
import { steeringYaw } from "../client/race/steering.js";

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const [rawServerUrl, rawRoomCode] = args;
if (!rawServerUrl || !rawRoomCode) {
  console.error("usage: headless-room-bot.mjs <server> <ROOM> [--name ChatGPT] [--dir DIR] [--driver ID|NAME]");
  process.exit(1);
}

const NAME = option("name", "ChatGPT").trim().slice(0, 24) || "ChatGPT";
const ROOM_CODE = rawRoomCode.trim().toUpperCase();
const DIR = path.resolve(option("dir", process.cwd()));
const STRATEGY_FILE = path.join(DIR, "strategy.json");
const STATE_FILE = path.join(DIR, "state.json");
const REQUEST_TIMEOUT_MS = 8000;
const RECONNECT_DELAY_MS = 1500;
const BROADCAST_INTERVAL_MS = 80; // same as race-multiplayer.js
const STATE_INTERVAL_MS = 2000;
const TICK_INTERVAL_MS = 16;
const MAX_STEP_S = 1 / 60; // the physics substeps further inside (1/120 s)
const QUALI_LAUNCH_DELAY_MS = 1800;
// Start lights, as main.js's runRaceStartLights: the lights begin this long
// after the server's raceStartedAt (server clock), one per second, then go
// out after a hold seeded by raceStartedAt — the same instant for everyone.
const MP_START_LEAD_MS = 8000;
const LIGHT_INTERVAL_MS = 1000;
const LIGHTS_OUT_MIN_MS = 200;
const LIGHTS_OUT_MAX_MS = 3000;
const TRACK_LIMIT_WARNING_THRESHOLD = 3; // as main.js
const TRACK_LIMIT_PENALTY_MS = 1000;
const REMOTE_STALE_MS = 3000;
const CENTERLINE_SAMPLES = 360;
const KMH_PER_UNIT = 3.6;
// A room bot has no garage of its own: a fresh browser profile races the
// default setup, so this does too.
const EFFECTS = setupEffects(DEFAULT_SETUP);

fs.mkdirSync(DIR, { recursive: true });
if (!fs.existsSync(STRATEGY_FILE)) {
  fs.writeFileSync(STRATEGY_FILE, '{"pace":0.95,"ers":"auto"}\n');
}

const log = (...values) => console.log(new Date().toISOString().slice(11, 19), ...values);
const round1 = (value) => Math.round(value * 10) / 10;

function websocketUrl(value) {
  if (/^https:/i.test(value)) return value.replace(/^https:/i, "wss:");
  if (/^http:/i.test(value)) return value.replace(/^http:/i, "ws:");
  if (/^wss?:/i.test(value)) return value;
  return `wss://${value}`;
}

function proxySocket(target) {
  const proxyValue = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxyValue || !target.startsWith("wss:")) return Promise.resolve(null);
  const proxy = new URL(proxyValue);
  const destination = new URL(target);
  const ca = process.env.NODE_EXTRA_CA_CERTS
    ? fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS)
    : undefined;
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: proxy.hostname,
      port: proxy.port,
      method: "CONNECT",
      path: `${destination.hostname}:${destination.port || 443}`,
    });
    request.on("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy CONNECT ${response.statusCode}`));
        return;
      }
      socket.setNoDelay(true);
      const secure = tls.connect({ socket, servername: destination.hostname, ca, ALPNProtocols: ["http/1.1"] });
      secure.once("secureConnect", () => resolve(secure));
      secure.once("error", reject);
    });
    request.once("error", reject);
    request.end();
  });
}

const WS_URL = websocketUrl(rawServerUrl);
let ws = null;
let stopping = false;
let reconnectTimer = null;
let requestCounter = 0;
const pending = new Map();
let credentials = null;
let room = null;
let driverId = null;
let readyRequestInFlight = false;
let serverOffsetMs = 0; // serverNow - Date.now(), from the latest message
let lastStrategyMtime = -1;
let lastBroadcastAt = 0;
let lastStateAt = 0;
let lastTickAt = performance.now();

// --- The car -----------------------------------------------------------------
// Everything a race needs for one circuit, rebuilt when the room changes
// circuit. Same wiring as main.js; comments there explain each piece.

let sim = null;
let phase = "lobby"; // lobby | qualifying | racing
let raceState = "waiting"; // waiting | countdown | racing | finished
let goAt = Infinity; // Date.now() at which the car may move
let finishedReported = false;
let qualiBestTime = null;
const remoteCars = new Map(); // participantId -> car-shaped object

function freshState() {
  return {
    x: 0, z: 0, heading: 0, speed: 0,
    gridPosition: 1,
    lap: 0, completedLaps: 0, lapCheckpointPassed: false,
    lapStartTime: 0, currentLapTime: 0, bestLapTime: null, lastLapTime: null,
    prevRawProgress: 0, totalProgress: 0,
    damage: 0, drsActive: false,
    tyreCompound: "medium", tyreProgress: 0,
    ersCharge: 100, ersActive: false,
    pitState: "none", pitServiceEndTime: 0, pitRequested: false,
    lastImpactEffectTime: 0, lastCollisionTime: 0,
    lateralSpeed: 0, yawRate: 0,
    wasOffTrack: false, trackLimitViolationsThisLap: 0, lastLapPenaltyMs: 0,
  };
}

function buildSim(circuitId) {
  const circuit = getCircuit(circuitId);
  const points = circuit.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", circuit.curveTension ?? 0.5);
  const centerline = sampleCenterline(curve, CENTERLINE_SAMPLES);
  const visualCenterline = sampleCenterline(curve, CENTERLINE_SAMPLES * 4);
  const trackLength = curve.getLength();
  const isRaining = circuit.weather === "pioggia";
  const nearestTrackInfo = (x, z) => nearestOnCenterline(centerline, x, z);
  const car = playerCarParams(EFFECTS, isRaining);
  const { tireGripFactor, tyreSpeedFactor, tyreWear } = createTyreModel({ isRaining, tyreLifeLaps: TYRE_LIFE_LAPS });
  const { grassLimit, applyTrackBoundary } = createTrackBoundary({
    trackWidth: circuit.width,
    runoffEffect: EFFECTS.runoff,
    nearestTrackInfo,
  });
  const gridSlot = createGridSlot({ centerline, trackWidth: circuit.width, trackLength, headingOf, sideNormal });
  const pitLane = buildPitLane(visualCenterline, circuit.width, 1, driverById(driverId).team);
  const state = freshState();
  const input = { forward: false, back: false, left: false, right: false };
  const steering = { value: 0 };
  const others = []; // live remote cars, refreshed every tick
  const { integratePlayerMotion } = setupPlayerPhysics({
    car,
    state,
    input,
    steering,
    drsSpeedMultiplier: DRS_SPEED_MULTIPLIER,
    ersSpeedMultiplier: ERS_SPEED_MULTIPLIER,
    grassLimit,
    tireGripFactor,
    tyreSpeedFactor,
    cautionSpeedMultiplier: () => 1, // caution is local to each browser; none here
    steeringYaw,
    nearestTrackInfo,
    applyTrackBoundary,
    slipstreamCars: others,
  });
  const systems = setupRaceSystems({
    state,
    input,
    aiMaxSpeed: car.maxSpeed,
    getRaceState: () => (phase === "racing" ? raceState : "qualifying"),
    isCautionActive: () => false,
    pitLane,
    pitSpeedLimit: PIT_SPEED_LIMIT,
    pitServiceMs: PIT_SERVICE_MS,
    ersDrainPerSecond: ERS_DRAIN_PER_SECOND,
    ersRechargePerSecond: ERS_RECHARGE_PER_SECOND,
  });
  const { advanceProgress } = setupRaceProgress({
    state,
    aiCars: others,
    allGridSlots: GRID_SLOTS,
    gridSlot,
    nearestTrackInfo,
    centerlineLength: centerline.length,
    finishProgress: START_FINISH_OFFSET / trackLength,
    lapsPerRace: LAPS_PER_RACE,
  });
  const collisions = setupCarCollisions({
    radius: CAR_RADIUS,
    damageThreshold: DAMAGE_MIN_IMPACT_SPEED,
    damagePerSpeed: DAMAGE_PER_IMPACT_SPEED,
    maxDamage: DAMAGE_MAX_SPEED_PENALTY,
  });
  const autopilot = createAutopilotProvider({
    centerline,
    headingOf,
    sideNormal,
    nearestTrackInfo,
    maxSpeed: car.maxSpeed,
    findCar: (id) => others.find((other) => other.driverId === id) || null,
    trackLength,
  });
  const driver = createLayeredProvider({ fast: autopilot, getState: () => snapshot(performance.now()) });
  log("circuit", circuit.id, `${Math.round(trackLength)}m`);
  return {
    circuit, centerline, trackLength, nearestTrackInfo, gridSlot, tyreWear, driverId,
    state, input, steering, others, integratePlayerMotion, systems,
    advanceProgress, collisions, driver,
  };
}

function placeOnGrid(slotIndex) {
  const { state, gridSlot, nearestTrackInfo, centerline } = sim;
  const slot = GRID_SLOTS[Math.min(Math.max(slotIndex, 0), GRID_SLOTS.length - 1)];
  const pos = gridSlot(slot.row, slot.lane);
  Object.assign(state, freshState(), {
    finishPullOver: null,
    x: pos.x,
    z: pos.z,
    heading: pos.heading,
    gridPosition: slotIndex + 1,
    prevRawProgress: nearestTrackInfo(pos.x, pos.z).idx / centerline.length,
    tyreCompound: state.tyreCompound,
  });
  sim.steering.value = 0;
  sim.input.forward = false;
  sim.input.back = false;
}

function seededUnit(seed) {
  let value = (Math.floor(seed) >>> 0) + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function startSession(nextPhase) {
  phase = nextPhase;
  raceState = "countdown";
  finishedReported = false;
  qualiBestTime = null;
  if (nextPhase === "qualifying") {
    // Every participant takes its own grid slot, by its index among the
    // participants with a driver (main.js's QUALI_START_INDEX).
    const withDriver = (room?.participants || []).filter((entry) => entry.driverId);
    placeOnGrid(withDriver.findIndex((entry) => entry.participantId === credentials?.participantId));
    goAt = Date.now() + QUALI_LAUNCH_DELAY_MS;
  } else {
    placeOnGrid((room?.grid || []).indexOf(driverId));
    const seed = room?.raceStartedAt ?? Date.now() + serverOffsetMs;
    const hold = LIGHTS_OUT_MIN_MS + seededUnit(seed) * (LIGHTS_OUT_MAX_MS - LIGHTS_OUT_MIN_MS);
    goAt = seed + MP_START_LEAD_MS + 5 * LIGHT_INTERVAL_MS + hold - serverOffsetMs;
  }
  log(nextPhase, "starts in", `${Math.max(0, Math.round(goAt - Date.now()))}ms`);
}

// --- Room protocol -------------------------------------------------------------

function sendRaw(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function request(type, payload = {}) {
  return new Promise((resolve, reject) => {
    const reqId = `h${++requestCounter}`;
    if (!sendRaw({ type, reqId, ...payload })) {
      reject(new Error("room socket not connected"));
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error(`${type}: room server timeout`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(reqId, { resolve, reject, timer });
  });
}

function settlePending(error) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(error);
  }
  pending.clear();
}

function participant() {
  return room?.participants?.find((entry) => entry.participantId === credentials?.participantId) || null;
}

function chooseDriver(publicRoom) {
  const wanted = option("driver");
  const selected = wanted
    ? DRIVER_ROSTER.find((entry) => entry.id === wanted || entry.name.toLowerCase() === wanted.toLowerCase())
    : null;
  if (wanted && !selected) throw new Error(`unknown driver: ${wanted}`);
  const occupied = new Set(publicRoom.participants.map((entry) => entry.driverId).filter(Boolean));
  const candidate = selected || DRIVER_ROSTER.find((entry) => !occupied.has(entry.id));
  if (!candidate || occupied.has(candidate.id)) throw new Error("no requested/free driver in room");
  return candidate.id;
}

async function ensureReady() {
  if (readyRequestInFlight || phase !== "lobby" || !room || !credentials) return;
  const me = participant();
  if (!me) return;
  readyRequestInFlight = true;
  try {
    if (!me.driverId) {
      driverId = chooseDriver(room);
      await request("reserve_driver", { driverId });
      log("reserved", driverId);
    } else {
      driverId = me.driverId;
    }
    if (!participant()?.ready) await request("set_ready", { ready: true });
    log("ready", driverId);
  } catch (error) {
    log("ready failed", error.message);
  } finally {
    readyRequestInFlight = false;
  }
}

function updateRoom(nextRoom) {
  if (!nextRoom) return;
  const previousPhase = room?.sessionPhase;
  room = nextRoom;
  driverId = participant()?.driverId || driverId;
  if (!sim || sim.driverId !== driverId || (room.circuitId && room.circuitId !== sim.circuit.id)) {
    sim = buildSim(room.circuitId || CIRCUITS[0].id);
  }
  if (room.sessionPhase === "lobby") {
    phase = "lobby";
    raceState = "waiting";
    queueMicrotask(ensureReady);
  } else if (room.sessionPhase !== previousPhase || phase !== room.sessionPhase) {
    startSession(room.sessionPhase);
  }
}

function updateRemote(message) {
  const entry = room?.participants?.find((p) => p.participantId === message.participantId);
  if (!entry?.driverId) return;
  const car = remoteCars.get(message.participantId) || {
    participantId: message.participantId,
    lateralSpeed: 0,
    yawRate: 0,
    damage: 0,
    lastCollisionTime: 0,
    lastImpactEffectTime: 0,
  };
  Object.assign(car, {
    driverId: entry.driverId,
    x: message.x,
    z: message.z,
    heading: message.heading,
    speed: message.speed || 0,
    lap: message.lap ?? car.lap ?? 0,
    totalProgress: Number.isFinite(message.totalProgress) ? message.totalProgress : car.totalProgress ?? 0,
    seenAt: Date.now(),
  });
  remoteCars.set(message.participantId, car);
}

function handleMessage(data) {
  let message;
  try { message = JSON.parse(data.toString()); } catch { return; }
  if (Number.isFinite(message.serverNow)) serverOffsetMs = message.serverNow - Date.now();
  if (message.type === "car_state") {
    updateRemote(message);
    return;
  }
  if (message.type === "voice_signal" && message.data?.kind === "radio") {
    log("radio", message.data.text);
    return;
  }
  if (message.room) updateRoom(message.room);
  if (!message.reqId || !pending.has(message.reqId)) return;
  const item = pending.get(message.reqId);
  pending.delete(message.reqId);
  clearTimeout(item.timer);
  if (message.type === "error") item.reject(Object.assign(new Error(message.message || message.code), { code: message.code }));
  else item.resolve(message);
}

async function bindConnection() {
  if (credentials) {
    const response = await request("reconnect", { roomCode: ROOM_CODE, ...credentials });
    updateRoom(response.room);
    log("reconnected", ROOM_CODE);
    return;
  }
  const response = await request("join_room", { roomCode: ROOM_CODE, nickname: NAME });
  credentials = { participantId: response.participantId, reconnectToken: response.reconnectToken };
  updateRoom(response.room);
  log("joined", ROOM_CODE, credentials.participantId);
  await ensureReady();
}

async function connect() {
  if (stopping) return;
  try {
    const socket = await proxySocket(WS_URL);
    ws = socket
      ? new WebSocket(WS_URL, { createConnection: () => socket })
      : new WebSocket(WS_URL);
    ws.on("message", handleMessage);
    ws.once("open", () => bindConnection().catch((error) => {
      log("bind failed", error.message);
      ws.close();
    }));
    ws.once("close", () => {
      settlePending(new Error("room socket closed"));
      if (!stopping) {
        log("disconnected; retrying");
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    });
    ws.once("error", (error) => log("socket", error.message));
  } catch (error) {
    log("connect", error.message);
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
  }
}

function readStrategy() {
  if (!sim) return;
  try {
    const stat = fs.statSync(STRATEGY_FILE);
    if (stat.mtimeMs === lastStrategyMtime) return;
    lastStrategyMtime = stat.mtimeMs;
    const update = JSON.parse(fs.readFileSync(STRATEGY_FILE, "utf8"));
    sim.driver.setStrategy(update);
    log("strategy", JSON.stringify(update));
  } catch (error) {
    log("strategy ignored", error.message);
  }
}

function sendRadio(text) {
  for (const entry of room?.participants || []) {
    if (entry.participantId !== credentials?.participantId) {
      sendRaw({ type: "voice_signal", to: entry.participantId, data: { kind: "radio", text } });
    }
  }
}

// --- One frame -----------------------------------------------------------------
// Same order as main.js's update() (race) and updateQualifying().

function drive(dt) {
  const { state, input, steering, driver } = sim;
  if (raceState === "finished") {
    const plan = finishPullOver(state, dt, { ...sim, sideNormal, trackWidth: sim.circuit.width });
    steering.value = plan.steer;
    input.forward = plan.throttle;
    input.back = plan.brake;
    state.ersActive = false;
    state.drsActive = false;
    return;
  }
  const out = driver.decide(state, dt);
  if (out.radio) sendRadio(out.radio);
  if (state.pitState === "servicing" && TYRE_COMPOUNDS[out.tyre]) state.tyreCompound = out.tyre;
  if (state.pitState !== "none") return;
  steering.value = out.steer;
  input.forward = out.throttle > 0 && !(out.brake > 0);
  input.back = out.brake > 0;
  if (phase !== "racing") return;
  if (out.pit) state.pitRequested = true;
  const wantErs = !!out.ers && state.ersCharge > 0;
  if (wantErs !== state.ersActive) state.ersActive = wantErs;
}

function completeLap(now) {
  const { state } = sim;
  const penaltyMs = state.trackLimitViolationsThisLap > TRACK_LIMIT_WARNING_THRESHOLD ? TRACK_LIMIT_PENALTY_MS : 0;
  const lapTime = now - state.lapStartTime + penaltyMs;
  state.lapStartTime = now;
  state.lastLapTime = lapTime;
  state.lastLapPenaltyMs = penaltyMs;
  state.trackLimitViolationsThisLap = 0;
  if (state.bestLapTime === null || lapTime < state.bestLapTime) state.bestLapTime = lapTime;
  if (phase === "qualifying" && (qualiBestTime === null || lapTime < qualiBestTime)) {
    qualiBestTime = lapTime;
    request("report_quali_time", { timeMs: lapTime }).catch((error) => log("quali report", error.message));
  }
  log("lap", state.completedLaps, `${(lapTime / 1000).toFixed(3)}s`, penaltyMs ? "(+penalty)" : "");
}

function simulate(dt) {
  if (!sim || phase === "lobby") return;
  const { state, systems, collisions, others } = sim;
  const now = performance.now();
  others.length = 0;
  for (const car of remoteCars.values()) {
    if (Date.now() - car.seenAt < REMOTE_STALE_MS) others.push(car);
  }
  if (raceState === "countdown") {
    if (Date.now() < goAt) return;
    raceState = phase === "racing" ? "racing" : "running";
    state.lapStartTime = now;
    log("lights out");
  }
  drive(dt);

  if (phase === "qualifying") {
    const info = sim.integratePlayerMotion(dt);
    if (sim.advanceProgress(state, info.idx / sim.centerline.length)) completeLap(now);
    state.currentLapTime = now - state.lapStartTime;
    return;
  }

  if (raceState !== "finished" && state.pitRequested) systems.startPitStop();
  updateDrsEligibility([state, ...others], sim.trackLength);
  systems.updateEnergyRecovery([state], dt);
  const inPit = systems.updatePitStop(now, dt);
  const info = inPit ? sim.nearestTrackInfo(state.x, state.z) : sim.integratePlayerMotion(dt);
  if (!inPit) systems.applyPitLimiter(dt);
  collisions.resolve(inPit ? others : [state, ...others], now);
  if (sim.advanceProgress(state, info.idx / sim.centerline.length)) completeLap(now);
  state.currentLapTime = now - state.lapStartTime;
  if (raceState === "racing" && state.completedLaps >= LAPS_PER_RACE && !finishedReported) {
    finishedReported = true;
    raceState = "finished";
    request("report_finish").catch((error) => log("finish report", error.message));
    log("finished");
  }
}

function broadcast(now) {
  if (!sim || phase === "lobby" || now - lastBroadcastAt < BROADCAST_INTERVAL_MS) return;
  lastBroadcastAt = now;
  const { state } = sim;
  sendRaw({
    type: "car_state",
    x: state.x,
    z: state.z,
    heading: state.heading,
    speed: state.speed,
    lap: state.lap,
    totalProgress: state.totalProgress,
  });
}

// state.json: the fields of agent-api.js getState() a strategy uses.
function snapshot(now) {
  if (!sim) return { session: { phase, state: raceState } };
  const { state, trackLength, others } = sim;
  const order = [
    { id: driverId, self: true, totalProgress: state.totalProgress, speed: state.speed },
    ...others.map((car) => ({ id: car.driverId, totalProgress: car.totalProgress, speed: car.speed })),
  ].sort((a, b) => b.totalProgress - a.totalProgress);
  const index = order.findIndex((entry) => entry.self);
  const gapSeconds = (lead, follow) => (follow.speed > 1 ? round1(((lead.totalProgress - follow.totalProgress) * trackLength) / follow.speed) : null);
  return {
    timestamp: Date.now(),
    session: { phase: phase === "racing" ? "race" : phase, state: raceState },
    circuit: sim.circuit.name,
    driver: driverId,
    speedKmh: round1(state.speed * KMH_PER_UNIT),
    lap: state.completedLaps,
    lapsTotal: LAPS_PER_RACE,
    position: index + 1,
    onTrack: !state.wasOffTrack,
    damagePct: Math.round((state.damage || 0) * 100),
    tyreCompound: state.tyreCompound,
    tyreWearPct: Math.round(sim.tyreWear(state.totalProgress, state) * 100),
    drsActive: !!state.drsActive,
    nearbyCars: others.map((car) => {
      const gapMeters = (car.totalProgress - state.totalProgress) * trackLength;
      return { id: car.driverId, relative: gapMeters >= 0 ? "ahead" : "behind", distanceMeters: round1(Math.abs(gapMeters)) };
    }).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 4),
    weather: sim.circuit.weather === "pioggia" ? "rain" : "dry",
    safetyCar: false,
    lapTimes: {
      currentMs: Math.round(state.currentLapTime || 0),
      lastMs: state.lastLapTime ? Math.round(state.lastLapTime) : null,
      bestMs: state.bestLapTime ? Math.round(state.bestLapTime) : null,
    },
    ers: { chargePct: Math.round(state.ersCharge ?? 0), active: !!state.ersActive },
    pit: { state: state.pitState, requested: !!state.pitRequested },
    gapAheadS: index > 0 ? gapSeconds(order[index - 1], order[index]) : null,
    gapBehindS: index < order.length - 1 ? gapSeconds(order[index], order[index + 1]) : null,
    targets: sim.driver.getTargets(),
  };
}

function tick() {
  const now = performance.now();
  let elapsed = Math.min((now - lastTickAt) / 1000, 0.25);
  lastTickAt = now;
  readStrategy();
  // A late timer tick never becomes one long step: the car is simulated in
  // frame-sized slices, like a browser at 60 fps.
  while (elapsed > 1e-4) {
    const dt = Math.min(elapsed, MAX_STEP_S);
    simulate(dt);
    elapsed -= dt;
  }
  broadcast(now);
  if (now - lastStateAt >= STATE_INTERVAL_MS) {
    lastStateAt = now;
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(snapshot(now), null, 1)}\n`);
  }
}

async function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(reconnectTimer);
  try {
    if (ws?.readyState === WebSocket.OPEN && credentials) await request("leave_room");
  } catch { /* best effort */ }
  if (ws) ws.close();
  log("stopped");
  process.exit(0);
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
setInterval(tick, TICK_INTERVAL_MS);
connect();
