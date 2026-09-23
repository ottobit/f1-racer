// WebSocket transport for multiplayer Stage 1 (#36, part of #1). Thin by
// design: parses JSON envelopes, calls straight into the pure state
// machine in rooms.mjs, and broadcasts the result. All room/reservation
// logic lives in rooms.mjs so it stays testable without a socket.
//
// Opt-in, separate process — never imported by race.html/garage.html/
// index.html. Run with `npm run start:room-server` (PORT, ROOM_GRACE_MS
// env vars optional).
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
  startRace,
  touch,
  leaveRoom,
  markDisconnected,
  toPublicRoom,
  RoomError,
  DEFAULT_GRACE_MS,
} from "./rooms.mjs";

const PORT = Number(process.env.PORT) || 8787;
const GRACE_MS = Number(process.env.ROOM_GRACE_MS) || DEFAULT_GRACE_MS;

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

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
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

const wss = new WebSocketServer({ port: PORT });
console.log(`[room-server] listening on ws://localhost:${PORT} (grace ${GRACE_MS}ms)`);

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
        case "start_race": {
          requireBound(bound);
          const room = startRace(store, { roomCode: bound.roomCode, participantId: bound.participantId });
          // Stage 1 stops at a shared confirmation, not a synced race — see
          // rooms.mjs's startRace comment. room_state's startedAt is what
          // the client keys its confirmation UI off; this ack just
          // correlates the request for whoever clicked "Avvia".
          send(ws, { type: "race_start_ack", reqId });
          broadcastRoom(bound.roomCode, room);
          break;
        }
        case "leave_room": {
          requireBound(bound);
          const { room } = leaveRoom(store, { roomCode: bound.roomCode, participantId: bound.participantId });
          socketsFor(bound.roomCode).delete(bound.participantId);
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
    const map = socketsByRoom.get(bound.roomCode);
    if (map) map.delete(bound.participantId);
    try {
      const room = markDisconnected(store, {
        roomCode: bound.roomCode,
        participantId: bound.participantId,
        graceMs: GRACE_MS,
        onExpire: ({ room: expiredRoom }) => broadcastRoom(bound.roomCode, expiredRoom),
      });
      broadcastRoom(bound.roomCode, room);
    } catch (err) {
      // Room or participant already gone (e.g. an explicit leave_room right
      // before the socket closed) — nothing to mark, not an error.
      if (!(err instanceof RoomError)) console.error("[room-server] unexpected error on close", err);
    }
  });
});
