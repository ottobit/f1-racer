// WebSocket transport for multiplayer Stage 1 (#36, part of #1). Thin by
// design: parses JSON envelopes, calls straight into the pure state
// machine in rooms.mjs, and broadcasts the result. All room/reservation
// logic lives in rooms.mjs so it stays testable without a socket.
//
// Opt-in, separate process — never imported by race.html/garage.html/
// index.html. Run from inside core/ with `npm run start:room-server`
// (PORT, ROOM_GRACE_MS, ROOM_QUALI_MS env vars optional). Provider-neutral
// (#333, service/README.md): one HTTP server carries the WebSocket upgrade and
// a GET /health for the host's health check and the keep-awake cron below.
//
// State is in-memory only (see rooms.mjs) and resets on restart. Fine for
// Stage 1's casual, short-lived rooms; not a database.

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import cron from "node-cron";
import { WebSocketServer } from "ws";
import {
  createStore,
  createRoom,
  joinRoom,
  reconnectParticipant,
  reserveDriver,
  releaseDriver,
  setReady,
  setCircuit,
  startRace,
  finishQualifying,
  reportQualiTime,
  reportFinish,
  rematch,
  touch,
  leaveRoom,
  markDisconnected,
  toPublicRoom,
  RoomError,
  DEFAULT_GRACE_MS,
  QUALIFYING_DURATION_MS,
} from "./rooms.mjs";
import { clientAddress, JoinLimiter } from "./join-limiter.mjs";

const PORT = Number(process.env.PORT) || 8787;
const GRACE_MS = Number(process.env.ROOM_GRACE_MS) || DEFAULT_GRACE_MS;
const QUALI_MS = Number(process.env.ROOM_QUALI_MS) || QUALIFYING_DURATION_MS;
// A client that dies without closing its socket (a suspended cloud bot, a
// phone that drops off the network) leaves a half-open connection that a
// tunnel like ngrok keeps alive forever: no close, no grace, a ghost in the
// room that blocks the start (#211). Protocol-level ping every interval;
// a socket that missed the previous pong is terminated, which runs the
// normal close -> grace path. Browsers answer pings on their own.
const HEARTBEAT_MS = Number(process.env.ROOM_HEARTBEAT_MS) || 15000;

const store = createStore();

// Transport-only bookkeeping: roomCode -> Map<participantId, ws>, so a
// broadcast can reach every socket currently associated with a room.
// rooms.mjs itself never touches a socket.
const socketsByRoom = new Map();

// Realtime agent relay (#201). A race page registers its already-bound room
// socket and gets a bearer token. A separate controller socket can attach
// with that token and call the same f1_* tools that native WebMCP exposes.
// The relay never simulates physics and never gains access to another car.
const AGENT_TOOL_NAMES = new Set(["f1_observe", "f1_act", "f1_enqueue", "f1_radio", "f1_release"]);
const agentBridges = new Map(); // token -> {roomCode, participantId, raceSocket, controllerSocket}
const agentTokenByParticipant = new Map(); // "ROOM:participant" -> token

function agentParticipantKey(roomCode, participantId) {
  return `${roomCode}:${participantId}`;
}

function detachAgentBridge(token, reason = "bridge_closed") {
  const bridge = agentBridges.get(token);
  if (!bridge) return;
  if (bridge.controllerSocket?.readyState === bridge.controllerSocket.OPEN) {
    send(bridge.controllerSocket, { type: "agent_detached", reason });
  }
  agentBridges.delete(token);
  agentTokenByParticipant.delete(agentParticipantKey(bridge.roomCode, bridge.participantId));
}

function registerAgentBridge(bound, raceSocket, requestedToken) {
  requireBound(bound);
  const key = agentParticipantKey(bound.roomCode, bound.participantId);
  const oldToken = agentTokenByParticipant.get(key);
  if (oldToken) detachAgentBridge(oldToken, "bridge_replaced");

  let token = typeof requestedToken === "string" ? requestedToken.trim() : "";
  if (token && token.length < 16) {
    throw new RoomError("agent_token_too_short", "Il token agente deve avere almeno 16 caratteri.");
  }
  if (!token) token = randomBytes(24).toString("base64url");
  if (agentBridges.has(token)) {
    throw new RoomError("agent_token_in_use", "Token agente già in uso.");
  }

  agentBridges.set(token, {
    roomCode: bound.roomCode,
    participantId: bound.participantId,
    raceSocket,
    controllerSocket: null,
  });
  agentTokenByParticipant.set(key, token);
  return token;
}

function bridgeForRaceSocket(bound, raceSocket) {
  if (!bound) return null;
  const token = agentTokenByParticipant.get(agentParticipantKey(bound.roomCode, bound.participantId));
  const bridge = token ? agentBridges.get(token) : null;
  return bridge && bridge.raceSocket === raceSocket ? { token, bridge } : null;
}

function socketsFor(roomCode) {
  let map = socketsByRoom.get(roomCode);
  if (!map) {
    map = new Map();
    socketsByRoom.set(roomCode, map);
  }
  return map;
}

// serverNow lets clients map server timestamps (raceStartedAt) onto their
// own clock, so the start lights go out at the same instant for all (#109).
function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ ...payload, serverNow: Date.now() }));
}

function broadcastRoom(roomCode, room) {
  const map = socketsByRoom.get(roomCode);
  if (!map) return;
  if (!room) {
    for (const ws of map.values()) send(ws, { type: "room_closed" });
    socketsByRoom.delete(roomCode);
    return;
  }
  const payload = { type: "room_state", room: toPublicRoom(room) };
  for (const ws of map.values()) send(ws, payload);
}

function requireBound(bound) {
  if (!bound) throw new RoomError("not_in_room", "Devi essere in una stanza per farlo.");
}

// Qualifying is timed here, not by each browser's own clock, so every
// client transitions to racing together (Stage 2, #44). roomCode -> timer.
const qualifyingTimers = new Map();

function clearQualifyingTimer(roomCode) {
  const timer = qualifyingTimers.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    qualifyingTimers.delete(roomCode);
  }
}

function scheduleQualifyingEnd(roomCode) {
  clearQualifyingTimer(roomCode);
  const timer = setTimeout(() => {
    qualifyingTimers.delete(roomCode);
    try {
      const room = finishQualifying(store, { roomCode });
      broadcastRoom(roomCode, room);
    } catch (err) {
      if (!(err instanceof RoomError)) console.error("[room-server] unexpected error ending qualifying", err);
    }
  }, QUALI_MS);
  qualifyingTimers.set(roomCode, timer);
}

// Plain HTTP: /health answers 200 (any origin may ping it); everything else
// keeps the old "Upgrade Required", which tells a human the server is up.
const httpServer = createServer((req, res) => {
  const path = (req.url || "").split("?")[0];
  if (req.method === "GET" && path === "/health") {
    res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*", "cache-control": "no-store" });
    res.end("ok");
    return;
  }
  res.writeHead(426, { "content-type": "text/plain" });
  res.end("Upgrade Required");
});
const wss = new WebSocketServer({ server: httpServer });

// Keep-awake (#333), for hosts that put an idle service to sleep: with
// KEEP_AWAKE_URL set (the server's public https://… address), an in-process
// cron calls its own /health so the host sees traffic. KEEP_AWAKE_CRON is a
// cron pattern (default every 10 minutes, all day) read in KEEP_AWAKE_TZ
// (default UTC). If the host still puts the service to sleep (a restart, a
// pattern with gaps) the cron sleeps with it: the next visitor wakes it.
const KEEP_AWAKE_URL = (process.env.KEEP_AWAKE_URL || "").replace(/\/+$/, "");
const KEEP_AWAKE_CRON = process.env.KEEP_AWAKE_CRON || "*/10 * * * *";
const KEEP_AWAKE_TZ = process.env.KEEP_AWAKE_TZ || "UTC";
if (KEEP_AWAKE_URL) {
  if (!cron.validate(KEEP_AWAKE_CRON)) {
    console.error(`[room-server] KEEP_AWAKE_CRON "${KEEP_AWAKE_CRON}" is not a cron pattern; keep-awake off`);
  } else {
    cron.schedule(KEEP_AWAKE_CRON, () => {
      fetch(`${KEEP_AWAKE_URL}/health`, { cache: "no-store" })
        .catch((err) => console.error("[room-server] keep-awake ping failed:", err.message));
    }, { timezone: KEEP_AWAKE_TZ });
    console.log(`[room-server] keep-awake ${KEEP_AWAKE_URL}/health on "${KEEP_AWAKE_CRON}" ${KEEP_AWAKE_TZ}`);
  }
}

httpServer.listen(PORT, () => {
  console.log(`[room-server] listening on :${PORT} (ws + GET /health; grace ${GRACE_MS}ms, qualifying ${QUALI_MS}ms, heartbeat ${HEARTBEAT_MS}ms)`);
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);
wss.on("close", () => clearInterval(heartbeat));

// Wrong room codes / reconnect tokens per address (#371).
const joinLimiter = new JoinLimiter();
const GUESS_TYPES = new Set(["join_room", "reconnect"]);
const GUESS_ERRORS = new Set(["room_not_found", "participant_not_found", "invalid_token"]);
setInterval(() => joinLimiter.prune(), 60_000).unref();

wss.on("connection", (ws, req) => {
  const address = clientAddress(req);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  // Which room/participant this specific socket currently represents, if
  // any — set on create/join/reconnect, cleared on explicit leave.
  let bound = null;
  // Non-room sockets can attach as one remote controller. Keeping the role
  // separate prevents an agent connection from masquerading as a racer.
  let controllerBridgeToken = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", code: "bad_json", message: "Messaggio non valido." });
      return;
    }
    const { type, reqId } = msg || {};
    try {
      if (GUESS_TYPES.has(type) && joinLimiter.blocked(address)) {
        throw new RoomError("too_many_attempts", "Troppi codici sbagliati: riprova tra un minuto.");
      }
      switch (type) {
        case "create_room": {
          const { room, participantId, reconnectToken } = createRoom(store, { nickname: msg.nickname });
          bound = { roomCode: room.code, participantId };
          socketsFor(room.code).set(participantId, ws);
          send(ws, { type: "room_created", reqId, roomCode: room.code, participantId, reconnectToken, room: toPublicRoom(room) });
          break;
        }
        case "join_room": {
          const { room, participantId, reconnectToken } = joinRoom(store, { roomCode: msg.roomCode, nickname: msg.nickname });
          bound = { roomCode: room.code, participantId };
          socketsFor(room.code).set(participantId, ws);
          send(ws, { type: "room_joined", reqId, participantId, reconnectToken, room: toPublicRoom(room) });
          broadcastRoom(room.code, room);
          break;
        }
        case "reconnect": {
          const room = reconnectParticipant(store, {
            roomCode: msg.roomCode,
            participantId: msg.participantId,
            reconnectToken: msg.reconnectToken,
          });
          bound = { roomCode: room.code, participantId: msg.participantId };
          socketsFor(room.code).set(msg.participantId, ws);
          send(ws, { type: "reconnected", reqId, room: toPublicRoom(room) });
          broadcastRoom(room.code, room);
          break;
        }
        case "reserve_driver": {
          requireBound(bound);
          const room = reserveDriver(store, { roomCode: bound.roomCode, participantId: bound.participantId, driverId: msg.driverId });
          send(ws, { type: "driver_reserved", reqId, driverId: msg.driverId });
          broadcastRoom(bound.roomCode, room);
          break;
        }
        case "release_driver": {
          requireBound(bound);
          const room = releaseDriver(store, { roomCode: bound.roomCode, participantId: bound.participantId });
          send(ws, { type: "driver_released", reqId });
          broadcastRoom(bound.roomCode, room);
          break;
        }
        case "set_ready": {
          requireBound(bound);
          const room = setReady(store, { roomCode: bound.roomCode, participantId: bound.participantId, ready: msg.ready });
          send(ws, { type: "ready_set", reqId, ready: !!msg.ready });
          broadcastRoom(bound.roomCode, room);
          break;
        }
        case "set_circuit": {
          requireBound(bound);
          const room = setCircuit(store, { roomCode: bound.roomCode, participantId: bound.participantId, circuitId: msg.circuitId, difficulty: msg.difficulty, qualifying: msg.qualifying });
          send(ws, { type: "circuit_set", reqId });
          broadcastRoom(bound.roomCode, room);
          break;
        }
        case "start_race": {
          requireBound(bound);
          const room = startRace(store, { roomCode: bound.roomCode, participantId: bound.participantId });
          // Stage 2 (#44): this now begins a real, timed qualifying phase
          // (see scheduleQualifyingEnd) instead of Stage 1's bare
          // confirmation — sessionPhase in the broadcast room_state is what
          // clients key their transition off.
          send(ws, { type: "race_start_ack", reqId });
          if (room.sessionPhase === "qualifying") scheduleQualifyingEnd(bound.roomCode);
          broadcastRoom(bound.roomCode, room);
          break;
        }
        case "report_finish": {
          requireBound(bound);
          const room = reportFinish(store, { roomCode: bound.roomCode, participantId: bound.participantId });
          send(ws, { type: "finish_ack", reqId });
          broadcastRoom(bound.roomCode, room);
          break;
        }
        case "rematch": {
          requireBound(bound);
          const room = rematch(store, { roomCode: bound.roomCode, participantId: bound.participantId });
          clearQualifyingTimer(bound.roomCode);
          send(ws, { type: "rematch_ack", reqId });
          broadcastRoom(bound.roomCode, room);
          break;
        }
        case "report_quali_time": {
          requireBound(bound);
          const room = reportQualiTime(store, { roomCode: bound.roomCode, participantId: bound.participantId, timeMs: msg.timeMs });
          send(ws, { type: "quali_time_ack", reqId });
          broadcastRoom(bound.roomCode, room);
          break;
        }

        // The race page opts into remote control only with ?agent=1. It can
        // provide its own secret (useful for scripted sessions) or let the
        // server generate one. The secret is never included in room_state.
        case "agent_bridge_register": {
          requireBound(bound);
          const token = registerAgentBridge(bound, ws, msg.token);
          send(ws, {
            type: "agent_bridge_registered",
            reqId,
            token,
            roomCode: bound.roomCode,
            participantId: bound.participantId,
          });
          break;
        }

        // A remote MCP/client process is deliberately not a room participant.
        // Possession of the bearer token is its only authority, scoped to the
        // single race socket that registered that token.
        case "agent_attach": {
          if (bound) throw new RoomError("agent_attach_from_racer", "Una socket di gara non può diventare controller agente.");
          const token = typeof msg.token === "string" ? msg.token.trim() : "";
          const bridge = agentBridges.get(token);
          if (!bridge || bridge.raceSocket.readyState !== bridge.raceSocket.OPEN) {
            throw new RoomError("agent_bridge_not_found", "Bridge agente non disponibile.");
          }
          if (controllerBridgeToken && controllerBridgeToken !== token) {
            const previous = agentBridges.get(controllerBridgeToken);
            if (previous?.controllerSocket === ws) previous.controllerSocket = null;
          }
          if (bridge.controllerSocket && bridge.controllerSocket !== ws && bridge.controllerSocket.readyState === bridge.controllerSocket.OPEN) {
            send(bridge.controllerSocket, { type: "agent_detached", reason: "controller_replaced" });
          }
          bridge.controllerSocket = ws;
          controllerBridgeToken = token;
          send(ws, {
            type: "agent_attached",
            reqId,
            roomCode: bridge.roomCode,
            participantId: bridge.participantId,
          });
          break;
        }

        case "agent_call": {
          const bridge = controllerBridgeToken ? agentBridges.get(controllerBridgeToken) : null;
          if (!bridge || bridge.controllerSocket !== ws) {
            throw new RoomError("agent_not_attached", "Controller agente non collegato.");
          }
          if (!AGENT_TOOL_NAMES.has(msg.tool)) {
            throw new RoomError("agent_tool_invalid", "Tool agente non valido.");
          }
          const callId = typeof msg.callId === "string" ? msg.callId.slice(0, 80) : "";
          if (!callId) throw new RoomError("agent_call_id_required", "callId obbligatorio.");
          if (bridge.raceSocket.readyState !== bridge.raceSocket.OPEN) {
            throw new RoomError("agent_bridge_not_found", "Pagina gara non disponibile.");
          }
          send(bridge.raceSocket, {
            type: "agent_command",
            callId,
            tool: msg.tool,
            args: msg.args && typeof msg.args === "object" ? msg.args : {},
          });
          break;
        }

        case "agent_result": {
          requireBound(bound);
          const found = bridgeForRaceSocket(bound, ws);
          if (!found) throw new RoomError("agent_bridge_not_registered", "Bridge agente non registrato.");
          const controller = found.bridge.controllerSocket;
          if (controller?.readyState === controller.OPEN) {
            send(controller, {
              type: "agent_result",
              callId: String(msg.callId || "").slice(0, 80),
              ok: !!msg.ok,
              result: msg.ok ? msg.result : undefined,
              error: msg.ok ? undefined : String(msg.error || "Agent command failed").slice(0, 500),
            });
          }
          break;
        }

        // Ephemeral per-frame position broadcast (Stage 2, #44): relayed
        // directly to the room's other sockets, never stored in rooms.mjs —
        // client-authoritative, so the server is just a fan-out relay here,
        // same spirit as room_state but far too frequent to route through
        // the pure state machine or its full-snapshot broadcast.
        case "car_state": {
          requireBound(bound);
          const map = socketsByRoom.get(bound.roomCode);
          if (map) {
            const payload = JSON.stringify({
              type: "car_state",
              participantId: bound.participantId,
              x: msg.x, z: msg.z, heading: msg.heading, speed: msg.speed,
              lap: msg.lap, totalProgress: msg.totalProgress,
            });
            for (const [pid, peer] of map) {
              if (pid !== bound.participantId && peer.readyState === peer.OPEN) peer.send(payload);
            }
          }
          break;
        }
        // Race voice chat (#1): WebRTC signaling (offer/answer/ICE/hello)
        // relayed to one named peer in the same room. Audio itself flows
        // peer-to-peer; the server never sees it and stores nothing.
        case "voice_signal": {
          requireBound(bound);
          const peer = socketsByRoom.get(bound.roomCode)?.get(msg.to);
          if (peer && msg.to !== bound.participantId) {
            send(peer, { type: "voice_signal", from: bound.participantId, data: msg.data });
          }
          break;
        }
        case "leave_room": {
          requireBound(bound);
          const bridgeEntry = bridgeForRaceSocket(bound, ws);
          if (bridgeEntry) detachAgentBridge(bridgeEntry.token, "participant_left");
          const { room } = leaveRoom(store, { roomCode: bound.roomCode, participantId: bound.participantId });
          socketsFor(bound.roomCode).delete(bound.participantId);
          if (!room) clearQualifyingTimer(bound.roomCode);
          send(ws, { type: "left_room", reqId });
          broadcastRoom(bound.roomCode, room);
          bound = null;
          break;
        }
        case "ping": {
          if (bound) touch(store, bound);
          send(ws, { type: "pong", reqId });
          break;
        }
        default:
          send(ws, { type: "error", reqId, code: "unknown_type", message: `Tipo di messaggio sconosciuto: ${type}` });
      }
    } catch (err) {
      // Remote agent calls are correlated by callId rather than reqId. Send
      // failures on the same channel so MCP callers fail immediately instead
      // of waiting for their timeout.
      if (type === "agent_call" && msg?.callId) {
        send(ws, {
          type: "agent_result",
          callId: String(msg.callId).slice(0, 80),
          ok: false,
          error: err instanceof RoomError ? err.message : "Errore interno del bridge agente.",
        });
      } else if (err instanceof RoomError) {
        if (GUESS_TYPES.has(type) && GUESS_ERRORS.has(err.code)) joinLimiter.fail(address);
        send(ws, { type: "error", reqId, code: err.code, message: err.message });
      } else {
        console.error("[room-server] unexpected error", err);
        send(ws, { type: "error", reqId, code: "internal_error", message: "Errore interno del server." });
      }
    }
  });

  ws.on("close", () => {
    if (controllerBridgeToken) {
      const bridge = agentBridges.get(controllerBridgeToken);
      if (bridge?.controllerSocket === ws) bridge.controllerSocket = null;
      controllerBridgeToken = null;
    }
    if (!bound) return;

    const bridgeEntry = bridgeForRaceSocket(bound, ws);
    if (bridgeEntry) detachAgentBridge(bridgeEntry.token, "race_page_closed");
    // A page navigation (room.html -> race.html) can deliver the old
    // socket's close after the new socket's reconnect: that participant is
    // already live on the new socket, so this close must not touch it (#95).
    const map = socketsByRoom.get(bound.roomCode);
    if (!map || map.get(bound.participantId) !== ws) return;
    map.delete(bound.participantId);
    try {
      const room = markDisconnected(store, {
        roomCode: bound.roomCode,
        participantId: bound.participantId,
        graceMs: GRACE_MS,
        onExpire: ({ room: expiredRoom }) => {
          if (!expiredRoom) clearQualifyingTimer(bound.roomCode);
          broadcastRoom(bound.roomCode, expiredRoom);
        },
      });
      broadcastRoom(bound.roomCode, room);
    } catch (err) {
      // Room or participant already gone (e.g. an explicit leave_room right
      // before the socket closed) — nothing to mark, not an error.
      if (!(err instanceof RoomError)) console.error("[room-server] unexpected error on close", err);
    }
  });
});
