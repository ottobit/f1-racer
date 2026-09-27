// Node-only multiplayer driver. Unlike room-bot.mjs it never opens the game
// page, creates a WebGL renderer or needs Chromium: it joins the public room
// protocol directly and advances a lightweight car along the same sampled
// circuit centerline used by the browser runtime.
//
//   node core/tools/headless-room-bot.mjs <server> <ROOM> \
//     --name ChatGPT --dir /tmp/bot-ChatGPT [--driver rival-red-2]

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import tls from "node:tls";
import * as THREE from "three";
import { WebSocket } from "ws";
import { CIRCUITS, LAPS_PER_RACE, TYRE_LIFE_LAPS, getCircuit } from "../client/shared/circuits.js";
import { DRIVER_ROSTER } from "../client/shared/driver-roster.js";
import { headingOf, sampleCenterline, sideNormal } from "../client/shared/track-geometry.js";

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
const BROADCAST_INTERVAL_MS = 80;
const STATE_INTERVAL_MS = 2000;
const TICK_INTERVAL_MS = 16;
const QUALI_LAUNCH_DELAY_MS = 1800;
const RACE_START_LEAD_MS = 8000;
const LIGHT_INTERVAL_MS = 1000;
const LIGHTS_OUT_MIN_MS = 200;
const LIGHTS_OUT_MAX_MS = 3000;
const MAX_SPEED = 82;
const ACCEL = 15;
const BRAKE = 45;
const COAST = 8;
const CENTERLINE_SAMPLES = 360;

fs.mkdirSync(DIR, { recursive: true });
if (!fs.existsSync(STRATEGY_FILE)) {
  fs.writeFileSync(STRATEGY_FILE, '{"pace":0.95,"ers":true}\n');
}

const log = (...values) => console.log(new Date().toISOString().slice(11, 19), ...values);
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const wrap01 = (value) => ((value % 1) + 1) % 1;
const wrapAngle = (value) => {
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
};

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
const remoteCars = new Map();

const targets = { pace: 0.95, line: 0, ers: true, tyre: "medium", station: null };
let lastStrategyMtime = -1;
let lastRadio = null;
let pitRequested = false;

let circuit = getCircuit();
let curve = null;
let centerline = [];
let trackLength = 1;
let phase = "lobby";
let phaseState = "waiting";
let goAt = Infinity;
let distance = 0;
let speed = 0;
let lap = 0;
let completedLaps = 0;
let lapStartedAt = 0;
let bestLapTime = null;
let lastLapTime = null;
let lapTimes = [];
let finishedReported = false;
let qualiReported = false;
let tyreWearPct = 0;
let tyreCompound = "medium";
let tyreDistance = 0;
let ersChargePct = 100;
let pitState = "none";
let pitUntil = 0;
let lastBroadcastAt = 0;
let lastStateAt = 0;
let lastTickAt = Date.now();

function buildTrack(circuitId) {
  circuit = getCircuit(circuitId);
  const points = circuit.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  curve = new THREE.CatmullRomCurve3(points, true, "catmullrom", circuit.curveTension ?? 0.5);
  centerline = sampleCenterline(curve, CENTERLINE_SAMPLES);
  trackLength = curve.getLength();
  log("circuit", circuit.id, `${Math.round(trackLength)}m`);
}

function seededUnit(seed) {
  let value = (Math.floor(seed) >>> 0) + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function gridDistance() {
  const order = room?.grid || [];
  const row = Math.max(0, order.indexOf(driverId));
  return -row * 5;
}

function resetRun(nextPhase) {
  phase = nextPhase;
  phaseState = "countdown";
  speed = 0;
  completedLaps = 0;
  lap = 0;
  bestLapTime = null;
  lastLapTime = null;
  lapTimes = [];
  finishedReported = false;
  qualiReported = false;
  tyreWearPct = 0;
  tyreDistance = 0;
  pitState = "none";
  pitUntil = 0;
  if (nextPhase === "qualifying") {
    distance = 0;
    goAt = Date.now() + QUALI_LAUNCH_DELAY_MS;
  } else {
    distance = gridDistance();
    const seed = room?.raceStartedAt || Date.now();
    const hold = LIGHTS_OUT_MIN_MS + seededUnit(seed) * (LIGHTS_OUT_MAX_MS - LIGHTS_OUT_MIN_MS);
    goAt = seed + RACE_START_LEAD_MS + 5 * LIGHT_INTERVAL_MS + hold;
  }
  lapStartedAt = goAt;
  log(nextPhase, "starts in", `${Math.max(0, Math.round(goAt - Date.now()))}ms`);
}

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
  if (room.circuitId && room.circuitId !== circuit.id) buildTrack(room.circuitId);
  if (room.sessionPhase === "lobby") {
    phase = "lobby";
    phaseState = "waiting";
    queueMicrotask(ensureReady);
  } else if (room.sessionPhase !== previousPhase || phase !== room.sessionPhase) {
    resetRun(room.sessionPhase);
  }
}

function handleMessage(data) {
  let message;
  try { message = JSON.parse(data.toString()); } catch { return; }
  if (message.type === "car_state") {
    remoteCars.set(message.participantId, { ...message, seenAt: Date.now() });
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
  try {
    const stat = fs.statSync(STRATEGY_FILE);
    if (stat.mtimeMs === lastStrategyMtime) return;
    lastStrategyMtime = stat.mtimeMs;
    const update = JSON.parse(fs.readFileSync(STRATEGY_FILE, "utf8"));
    if (Number.isFinite(update.pace)) targets.pace = clamp(update.pace, 0.5, 1);
    if (Number.isFinite(update.line)) targets.line = clamp(update.line, -1, 1);
    if (typeof update.ers === "boolean") targets.ers = update.ers;
    if (["soft", "medium", "hard"].includes(update.tyre)) targets.tyre = update.tyre;
    if (update.station === null) targets.station = null;
    else if (update.station && typeof update.station.car === "string") {
      targets.station = {
        car: update.station.car,
        gap: Number.isFinite(update.station.gap) ? clamp(update.station.gap, -500, 500) : 0,
        side: Number.isFinite(update.station.side) ? clamp(update.station.side, -1, 1) : 0,
      };
    }
    if (update.pit === true) pitRequested = true;
    if (typeof update.radio === "string" && update.radio.trim() && update.radio !== lastRadio) {
      lastRadio = update.radio;
      for (const entry of room?.participants || []) {
        if (entry.participantId !== credentials?.participantId) {
          sendRaw({ type: "voice_signal", to: entry.participantId, data: { kind: "radio", text: update.radio.trim().slice(0, 80) } });
        }
      }
    }
    log("strategy", JSON.stringify(targets));
  } catch (error) {
    log("strategy ignored", error.message);
  }
}

function cornerSeverity(fraction) {
  const index = Math.floor(wrap01(fraction) * centerline.length);
  let turn = 0;
  let previous = headingOf(centerline[index]);
  for (let step = 1; step <= 22; step++) {
    const current = headingOf(centerline[(index + step) % centerline.length]);
    turn += wrapAngle(current - previous);
    previous = current;
  }
  return Math.min(1, Math.abs(turn) * 0.72);
}

function carPose() {
  const fraction = wrap01(distance / trackLength);
  const point = curve.getPointAt(fraction);
  const tangent = curve.getTangentAt(fraction);
  const normal = sideNormal({ tx: tangent.x, tz: tangent.z });
  return {
    x: point.x + normal.x * targets.line * 2,
    z: point.z + normal.z * targets.line * 2,
    heading: Math.atan2(tangent.x, tangent.z),
    fraction,
  };
}

function stationSpeed(targetSpeed) {
  const station = targets.station;
  if (!station || !room) return targetSpeed;
  const targetParticipant = room.participants.find((entry) => entry.driverId === station.car || entry.nickname === station.car);
  const remote = targetParticipant ? remoteCars.get(targetParticipant.participantId) : null;
  if (!remote || !Number.isFinite(remote.totalProgress)) return targetSpeed;
  const ownProgress = distance / trackLength;
  const offStation = (remote.totalProgress - ownProgress) * trackLength + station.gap;
  return clamp((remote.speed || 0) + offStation * 0.8, 0, targetSpeed);
}

function completeLap(now) {
  completedLaps += 1;
  lap = completedLaps;
  const time = now - lapStartedAt;
  lapStartedAt = now;
  lastLapTime = time;
  bestLapTime = bestLapTime === null ? time : Math.min(bestLapTime, time);
  lapTimes.push(time);
  if (phase === "qualifying" && (!qualiReported || time <= bestLapTime)) {
    qualiReported = true;
    request("report_quali_time", { timeMs: time }).catch((error) => log("quali report", error.message));
  }
  if (phase === "racing" && completedLaps >= LAPS_PER_RACE && !finishedReported) {
    finishedReported = true;
    phaseState = "finished";
    request("report_finish").catch((error) => log("finish report", error.message));
    log("finished", `${Math.round((now - goAt) / 1000)}s`);
  }
}

function simulate(now, dt) {
  if (!curve || phase === "lobby") return;
  if (now < goAt) return;
  if (phaseState === "countdown") {
    phaseState = "driving";
    lapStartedAt = now;
    log("lights out");
  }
  if (phaseState === "finished") {
    speed = Math.max(0, speed - COAST * dt);
    return;
  }
  if (pitState === "servicing") {
    speed = 0;
    if (now >= pitUntil) {
      pitState = "none";
      tyreWearPct = 0;
      tyreDistance = 0;
      tyreCompound = targets.tyre || tyreCompound;
    }
    return;
  }

  const beforeLap = Math.floor(Math.max(distance, 0) / trackLength);
  const wearFactor = 1 - Math.max(0, tyreWearPct - 70) / 250;
  const ersFactor = targets.ers && ersChargePct > 0 ? 1.05 : 1;
  let targetSpeed = MAX_SPEED * (1 - cornerSeverity(distance / trackLength) * 0.48) * targets.pace * wearFactor * ersFactor;
  targetSpeed = stationSpeed(targetSpeed);
  if (speed < targetSpeed) speed = Math.min(targetSpeed, speed + ACCEL * dt);
  else speed = Math.max(targetSpeed, speed - BRAKE * dt);
  const stepDistance = speed * dt;
  distance += stepDistance;
  tyreDistance += stepDistance;
  tyreWearPct = clamp((tyreDistance / (trackLength * TYRE_LIFE_LAPS)) * 100, 0, 100);
  if (targets.ers && speed > 1) ersChargePct = Math.max(0, ersChargePct - 4 * dt);
  else ersChargePct = Math.min(100, ersChargePct + 2 * dt);
  const afterLap = Math.floor(Math.max(distance, 0) / trackLength);
  if (afterLap > beforeLap) {
    completeLap(now);
    if (pitRequested && phase === "racing" && !finishedReported) {
      pitRequested = false;
      pitState = "servicing";
      pitUntil = now + 2500;
      log("pit stop", tyreCompound, "->", targets.tyre || tyreCompound);
    }
  }
}

function broadcast(now) {
  if (!curve || now - lastBroadcastAt < BROADCAST_INTERVAL_MS) return;
  lastBroadcastAt = now;
  const pose = carPose();
  sendRaw({
    type: "car_state",
    x: pose.x,
    z: pose.z,
    heading: pose.heading,
    speed,
    lap,
    totalProgress: distance / trackLength,
  });
}

function ranking() {
  const own = { participantId: credentials?.participantId, totalProgress: distance / trackLength, speed };
  const entries = [own, ...[...remoteCars.values()].filter((entry) => Date.now() - entry.seenAt < 3000)];
  return entries.sort((a, b) => (b.totalProgress ?? 0) - (a.totalProgress ?? 0));
}

function snapshot(now) {
  const pose = curve ? carPose() : { x: 0, z: 0, heading: 0 };
  const order = ranking();
  const index = order.findIndex((entry) => entry.participantId === credentials?.participantId);
  const ahead = index > 0 ? order[index - 1] : null;
  const behind = index >= 0 && index < order.length - 1 ? order[index + 1] : null;
  const gapSeconds = (entry) => entry
    ? Math.abs((entry.totalProgress - distance / trackLength) * trackLength) / Math.max(speed, 1)
    : null;
  return {
    session: { phase, state: phaseState },
    circuit: circuit.name,
    driver: driverId,
    x: pose.x,
    z: pose.z,
    heading: pose.heading,
    speed,
    lap,
    lapsTotal: LAPS_PER_RACE,
    position: index >= 0 ? index + 1 : null,
    tyreWearPct,
    tyreCompound,
    damagePct: 0,
    ers: { chargePct: ersChargePct, active: !!targets.ers },
    gapAheadS: gapSeconds(ahead),
    gapBehindS: gapSeconds(behind),
    nearbyCars: order.filter((entry) => entry.participantId !== credentials?.participantId).slice(0, 4),
    weather: circuit.weather || "sereno",
    safetyCar: false,
    lapTimes,
    bestLapTime,
    lastLapTime,
    pit: { state: pitState, requested: pitRequested },
    targets: { ...targets, updatedAt: now },
  };
}

function tick() {
  const now = Date.now();
  const dt = Math.min((now - lastTickAt) / 1000, 0.1);
  lastTickAt = now;
  readStrategy();
  simulate(now, dt);
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
buildTrack(CIRCUITS[0].id);
setInterval(tick, TICK_INTERVAL_MS);
connect();
