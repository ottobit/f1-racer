// WebSocket transport for multiplayer Stage 1 (#36, part of #1). Thin by
// design: parses JSON envelopes, calls straight into the pure state
// machine in rooms.mjs, and broadcasts the result. All room/reservation
// logic lives in rooms.mjs so it stays testable without a socket.
//
// Opt-in, separate process — never imported by race.html/garage.html/
// index.html. Run from inside core/ with `npm run start:room-server`
// (PORT, ROOM_GRACE_MS, ROOM_QUALI_MS env vars optional).
//
// State is in-memory only (see rooms.mjs) and resets on restart. Fine for
// Stage 1's casual, short-lived rooms; not a database.

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
  touch,
  leaveRoom,
  markDisconnected,
  toPublicRoom,
  RoomError,
  DEFAULT_GRACE_MS,
  QUALIFYING_DURATION_MS,
} from "./rooms.mjs";

const PORT = Number(process.env.PORT) || 8787;
const GRACE_MS = Number(process.env.ROOM_GRACE_MS) || DEFAULT_GRACE_MS;
const QUALI_MS = Number(process.env.ROOM_QUALI_MS) || QUALIFYING_DURATION_MS;

const store = createStore();

// Transport-only bookkeeping: roomCode -> Map<participantId, ws>, so a
// broadcast can reach every socket currently associated with a room.
// rooms.mjs itself never touches a socket.
const socketsByRoom = new Map();

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

const wss = new WebSocketServer({ port: PORT });
console.log(`[room-server] listening on ws://localhost:${PORT} (grace ${GRACE_MS}ms, qualifying ${QUALI_MS}ms)`);

wss.on("connection", (ws) => {
  // Which room/participant this specific socket currently represents, if
  // any — set on create/join/reconnect, cleared on explicit leave.
  let bound = null;

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
        case "report_quali_time": {
          requireBound(bound);
          const room = reportQualiTime(store, { roomCode: bound.roomCode, participantId: bound.participantId, timeMs: msg.timeMs });
          send(ws, { type: "quali_time_ack", reqId });
          broadcastRoom(bound.roomCode, room);
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
      if (err instanceof RoomError) {
        send(ws, { type: "error", reqId, code: err.code, message: err.message });
      } else {
        console.error("[room-server] unexpected error", err);
        send(ws, { type: "error", reqId, code: "internal_error", message: "Errore interno del server." });
      }
    }
  });

  ws.on("close", () => {
    if (!bound) return;
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
