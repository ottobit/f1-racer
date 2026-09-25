// Thin browser-side client for the multiplayer Stage 1 room protocol (#36,
// part of #1) served by server/room-server.mjs. Plain JSON messages over a
// WebSocket, correlated by reqId — no framework.
//
// Room-session identity (roomCode/participantId/reconnectToken) persists
// under its own localStorage key, entirely separate from
// f1racer-selected-driver-v1 (solo play) and championship state: joining a
// room never touches, and is never touched by, the solo flow.

const SESSION_KEY = "f1racer-room-session-v1";
const DEFAULT_ROOM_SERVER_URL = "ws://localhost:8787";
const REQUEST_TIMEOUT_MS = 8000;
const PING_INTERVAL_MS = 15000;

function serverUrl() {
  return new URLSearchParams(location.search).get("roomServer") || DEFAULT_ROOM_SERVER_URL;
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage unavailable (private mode, disabled) — the session just
    // won't survive a reload, which degrades gracefully.
  }
}

export function createRoomClient() {
  let ws = null;
  let reqCounter = 0;
  const pending = new Map(); // reqId -> {resolve, reject, timer}
  const stateListeners = new Set();
  const connectionListeners = new Set();
  const carStateListeners = new Set();
  const voiceSignalListeners = new Set();
  let session = loadSession(); // {roomCode, participantId, reconnectToken}
  let lastRoom = null;
  let pingTimer = null;
  let manuallyClosed = false;

  function notifyState(room) {
    lastRoom = room;
    stateListeners.forEach((cb) => cb(room));
  }
  function notifyConnection(status) {
    connectionListeners.forEach((cb) => cb(status));
  }

  function send(type, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Non connesso al server della stanza."));
        return;
      }
      const reqId = `c${++reqCounter}`;
      const timer = setTimeout(() => {
        pending.delete(reqId);
        reject(new Error("Il server non ha risposto in tempo."));
      }, REQUEST_TIMEOUT_MS);
      pending.set(reqId, { resolve, reject, timer });
      ws.send(JSON.stringify({ type, reqId, ...payload }));
    });
  }

  function handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === "car_state") {
      // High-frequency, ephemeral — never touches session/room state or the
      // pending-request map, so it can't collide with a real reqId.
      carStateListeners.forEach((cb) => cb(msg));
      return;
    }
    if (msg.type === "voice_signal") {
      voiceSignalListeners.forEach((cb) => cb(msg.from, msg.data));
      return;
    }
    if (msg.type === "error" && msg.code === "unknown_type" && !msg.reqId) {
      // A room server started before voice chat existed rejects its
      // signaling; tell the voice HUD instead of failing silently (#93).
      voiceSignalListeners.forEach((cb) => cb(null, { kind: "unsupported" }));
      return;
    }
    if (msg.type === "room_closed") {
      saveSession(null);
      session = null;
      notifyState(null);
    } else if (msg.room) {
      notifyState(msg.room);
    }
    if (msg.reqId && pending.has(msg.reqId)) {
      const { resolve, reject, timer } = pending.get(msg.reqId);
      clearTimeout(timer);
      pending.delete(msg.reqId);
      if (msg.type === "error") reject(Object.assign(new Error(msg.message || msg.code), { code: msg.code }));
      else resolve(msg);
    }
  }

  function connect() {
    return new Promise((resolve, reject) => {
      manuallyClosed = false;
      ws = new WebSocket(serverUrl());
      ws.addEventListener("open", () => {
        notifyConnection("connected");
        pingTimer = setInterval(() => { send("ping").catch(() => {}); }, PING_INTERVAL_MS);
        resolve();
      });
      ws.addEventListener("message", (e) => handleMessage(e.data));
      ws.addEventListener("close", () => {
        clearInterval(pingTimer);
        if (!manuallyClosed) notifyConnection("disconnected");
      });
      ws.addEventListener("error", () => reject(new Error("Impossibile connettersi al server della stanza.")));
    });
  }

  async function ensureConnected() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    await connect();
  }

  async function createRoom(nickname) {
    await ensureConnected();
    const res = await send("create_room", { nickname });
    session = { roomCode: res.roomCode, participantId: res.participantId, reconnectToken: res.reconnectToken };
    saveSession(session);
    notifyState(res.room);
    return res;
  }

  async function joinRoom(roomCode, nickname) {
    await ensureConnected();
    const res = await send("join_room", { roomCode: roomCode.toUpperCase(), nickname });
    session = { roomCode: res.room.code, participantId: res.participantId, reconnectToken: res.reconnectToken };
    saveSession(session);
    notifyState(res.room);
    return res;
  }

  // Resumes a session saved from a previous visit (e.g. after a reload).
  // A no-op — no connection even opened — when nothing was saved.
  async function tryResume() {
    if (!session) return null;
    await ensureConnected();
    try {
      const res = await send("reconnect", session);
      notifyState(res.room);
      return res.room;
    } catch (err) {
      saveSession(null);
      session = null;
      throw err;
    }
  }

  function reserveDriver(driverId) { return send("reserve_driver", { driverId }); }
  function releaseDriver() { return send("release_driver"); }
  function setReady(ready) { return send("set_ready", { ready }); }
  function setCircuit(circuitId, difficulty) { return send("set_circuit", { circuitId, difficulty }); }
  function startRace() { return send("start_race"); }
  function reportQualiTime(timeMs) { return send("report_quali_time", { timeMs }); }

  // Fire-and-forget, no reqId/ack — called every frame during a
  // multiplayer qualifying/race session (Stage 2, #44), too frequent to pay
  // the pending-request bookkeeping the other methods use.
  function sendCarState(data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "car_state", ...data }));
  }

  // Race voice chat (#1): WebRTC signaling to one peer, relayed verbatim
  // by the server. Fire-and-forget like sendCarState.
  function sendVoiceSignal(to, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "voice_signal", to, data }));
  }

  async function leaveRoom() {
    try { await send("leave_room"); } catch { /* best-effort — we're leaving anyway */ }
    saveSession(null);
    session = null;
    manuallyClosed = true;
    if (ws) ws.close();
    notifyState(null);
  }

  function onStateChange(cb) { stateListeners.add(cb); return () => stateListeners.delete(cb); }
  function onConnectionChange(cb) { connectionListeners.add(cb); return () => connectionListeners.delete(cb); }
  function onCarState(cb) { carStateListeners.add(cb); return () => carStateListeners.delete(cb); }
  function onVoiceSignal(cb) { voiceSignalListeners.add(cb); return () => voiceSignalListeners.delete(cb); }

  return {
    createRoom,
    joinRoom,
    tryResume,
    reserveDriver,
    releaseDriver,
    setReady,
    setCircuit,
    startRace,
    reportQualiTime,
    sendCarState,
    sendVoiceSignal,
    leaveRoom,
    onStateChange,
    onConnectionChange,
    onCarState,
    onVoiceSignal,
    hasSavedSession: () => !!session,
    get room() { return lastRoom; },
    get participantId() { return session ? session.participantId : null; },
  };
}
