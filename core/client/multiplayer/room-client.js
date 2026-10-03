// Thin browser-side client for the multiplayer Stage 1 room protocol (#36,
// part of #1) served by server/room-server.mjs. Plain JSON messages over a
// WebSocket, correlated by reqId — no framework.
//
// Room-session identity (roomCode/participantId/reconnectToken) persists
// under its own localStorage key, entirely separate from
// f1racer-selected-driver-v1 (solo play) and championship state: joining a
// room never touches, and is never touched by, the solo flow.

import { roomServerUrl } from "./room-server.js?v=1";

const SESSION_KEY = "f1racer-room-session-v1";
const REQUEST_TIMEOUT_MS = 8000;
const PING_INTERVAL_MS = 15000;
// Auto-reconnect (#343): retries after an unwanted drop, ~23 s in total so
// it ends inside the server's 30 s grace (rooms.mjs DEFAULT_GRACE_MS).
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 8000];


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
  const agentCommandListeners = new Set();
  let session = loadSession(); // {roomCode, participantId, reconnectToken}
  let lastRoom = null;
  let pingTimer = null;
  let manuallyClosed = false;
  let retryTimer = null;
  // Set once a session is live on a socket: a first connect that never got
  // that far (race-bootstrap falling back to solo) must not retry on its own.
  let live = false;
  let retryAttempt = 0;
  // Server clock minus local clock, from the serverNow stamped on every
  // server reply (#109); 0 until the first one (or with an older server).
  let clockOffsetMs = 0;

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
    if (typeof msg.serverNow === "number") clockOffsetMs = msg.serverNow - Date.now();
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
    if (msg.type === "agent_command") {
      agentCommandListeners.forEach((cb) => cb(msg));
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

  // Connection status, to onConnectionChange listeners:
  // "connected" | "reconnecting" | "disconnected" (gave up; a reload may
  // still work) | "lost" (the server refused the session: room gone).
  function connect() {
    return new Promise((resolve, reject) => {
      manuallyClosed = false;
      const sock = new WebSocket(roomServerUrl());
      ws = sock;
      sock.addEventListener("open", () => {
        if (sock !== ws) return;
        notifyConnection("connected");
        clearInterval(pingTimer);
        // An unanswered ping means a dead socket the browser hasn't noticed
        // (phone back from sleep): drop it and reconnect.
        pingTimer = setInterval(() => {
          send("ping").catch(() => { if (sock === ws) dropSocket(); });
        }, PING_INTERVAL_MS);
        resolve();
      });
      sock.addEventListener("message", (e) => { if (sock === ws) handleMessage(e.data); });
      sock.addEventListener("close", () => {
        if (sock !== ws) return;
        clearInterval(pingTimer);
        failPending();
        if (!manuallyClosed) scheduleReconnect();
      });
      sock.addEventListener("error", () => reject(new Error("Impossibile connettersi al server della stanza.")));
    });
  }

  function failPending() {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error("Non connesso al server della stanza."));
    }
    pending.clear();
  }

  // Abandons the current socket without waiting for its close event; its
  // listeners ignore it from now on (sock !== ws). The server sees the
  // close later and, since we already reconnected, ignores it (#95).
  function dropSocket() {
    const sock = ws;
    ws = null;
    clearInterval(pingTimer);
    failPending();
    try { sock?.close(); } catch {}
    if (!manuallyClosed) scheduleReconnect();
  }

  function scheduleReconnect() {
    if (!live || !session || manuallyClosed || retryTimer) return;
    if (retryAttempt >= RECONNECT_DELAYS_MS.length) {
      notifyConnection("disconnected");
      return;
    }
    notifyConnection("reconnecting");
    retryTimer = setTimeout(() => {
      retryTimer = null;
      resumeNow();
    }, RECONNECT_DELAYS_MS[retryAttempt++]);
  }

  async function resumeNow() {
    if (!session || manuallyClosed) return;
    if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) return;
    try {
      await tryResume();
      retryAttempt = 0;
    } catch (err) {
      if (!session) notifyConnection("lost");
      else scheduleReconnect();
    }
  }

  // Back to the page or the network: retry now, with a fresh budget.
  function wake() {
    if (!live || !session || manuallyClosed) return;
    if (ws && ws.readyState === WebSocket.OPEN) return;
    clearTimeout(retryTimer);
    retryTimer = null;
    retryAttempt = 0;
    resumeNow();
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") wake();
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
    live = true;
    notifyState(res.room);
    return res;
  }

  async function joinRoom(roomCode, nickname) {
    await ensureConnected();
    const res = await send("join_room", { roomCode: roomCode.toUpperCase(), nickname });
    session = { roomCode: res.room.code, participantId: res.participantId, reconnectToken: res.reconnectToken };
    saveSession(session);
    live = true;
    notifyState(res.room);
    return res;
  }

  // Resumes a session saved from a previous visit (e.g. after a reload)
  // or a dropped socket (#343). A no-op — no connection even opened — when
  // nothing was saved. Only the server refusing it (an error code: room
  // gone, grace expired) forgets the session; a network failure keeps it
  // for the next try.
  async function tryResume() {
    if (!session) return null;
    await ensureConnected();
    try {
      const res = await send("reconnect", session);
      live = true;
      notifyState(res.room);
      return res.room;
    } catch (err) {
      if (err.code) {
        saveSession(null);
        session = null;
      }
      throw err;
    }
  }

  function reserveDriver(driverId) { return send("reserve_driver", { driverId }); }
  function releaseDriver() { return send("release_driver"); }
  function setReady(ready) { return send("set_ready", { ready }); }
  function setCircuit(circuitId, difficulty, qualifying) { return send("set_circuit", { circuitId, difficulty, qualifying }); }
  function startRace() { return send("start_race"); }
  function reportQualiTime(timeMs) { return send("report_quali_time", { timeMs }); }
  function reportFinish() { return send("report_finish"); }
  function rematch() { return send("rematch"); }

  // Realtime agent bridge (#201): the race page registers its participant
  // socket as a remotely controllable target. The server returns a bearer
  // token; a caller that already supplied a >=16-char token can reuse it so
  // no browser-specific WebMCP support is required.
  function registerAgentBridge(token = null) {
    return send("agent_bridge_register", token ? { token } : {});
  }

  // Results are paired by callId on the relay, not reqId, because the remote
  // controller owns the request lifecycle.
  function sendAgentResult(callId, ok, result = null, error = null) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "agent_result",
      callId,
      ok: !!ok,
      result: ok ? result : undefined,
      error: ok ? undefined : String(error || "Agent command failed").slice(0, 500),
    }));
  }

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
    live = false;
    manuallyClosed = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (ws) ws.close();
    notifyState(null);
  }

  function onStateChange(cb) { stateListeners.add(cb); return () => stateListeners.delete(cb); }
  function onConnectionChange(cb) { connectionListeners.add(cb); return () => connectionListeners.delete(cb); }
  function onCarState(cb) { carStateListeners.add(cb); return () => carStateListeners.delete(cb); }
  function onVoiceSignal(cb) { voiceSignalListeners.add(cb); return () => voiceSignalListeners.delete(cb); }
  function onAgentCommand(cb) { agentCommandListeners.add(cb); return () => agentCommandListeners.delete(cb); }

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
    reportFinish,
    rematch,
    registerAgentBridge,
    sendAgentResult,
    sendCarState,
    sendVoiceSignal,
    leaveRoom,
    onStateChange,
    onConnectionChange,
    onCarState,
    onVoiceSignal,
    onAgentCommand,
    hasSavedSession: () => !!session,
    getServerUrl: () => roomServerUrl(),
    serverNow: () => Date.now() + clockOffsetMs,
    get room() { return lastRoom; },
    get participantId() { return session ? session.participantId : null; },
  };
}
