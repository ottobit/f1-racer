// Pure room/participant state machine for multiplayer Stage 1 (#36, part of
// #1). No sockets, no framework, no database — every function here takes a
// `store` and plain data in, returns plain data out, so it's testable by
// calling it directly (see the verification plan in the issue) as well as
// from the real WebSocket transport in room-server.mjs.
//
// State lives in memory only and resets on process restart — a deliberate,
// documented Stage 1 limitation (see F1-RACER-WIKI.md), not an oversight.
//
// `driverId` reservations are keyed off the same ten identities `main.js`
// already treats as AI-able (see driver-roster.js); the client-only
// "player" pseudo-id from driver-selection.js is never a valid value here
// — solo play and room play are deliberately independent.

import { DRIVER_ROSTER } from "../driver-roster.js";

const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
const ROOM_CODE_LENGTH = 4;
const MAX_NICKNAME_LENGTH = 24;
export const MAX_PARTICIPANTS = DRIVER_ROSTER.length; // 10 — one slot per reservable driver
export const DEFAULT_GRACE_MS = 30000;

const VALID_DRIVER_IDS = new Set(DRIVER_ROSTER.map((d) => d.id));

export class RoomError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function randomCode() {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function randomSecret() {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function randomParticipantId() {
  return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeNickname(nickname) {
  const trimmed = typeof nickname === "string" ? nickname.trim().slice(0, MAX_NICKNAME_LENGTH) : "";
  return trimmed || "Pilota";
}

export function createStore() {
  return { rooms: new Map() };
}

function findRoom(store, roomCode) {
  const room = store.rooms.get(roomCode);
  if (!room) throw new RoomError("room_not_found", `Nessuna stanza con codice ${roomCode}.`);
  return room;
}

function findParticipant(room, participantId) {
  const participant = room.participants.get(participantId);
  if (!participant) throw new RoomError("participant_not_found", "Partecipante non trovato in questa stanza.");
  return participant;
}

function newParticipant(nickname) {
  const participantId = randomParticipantId();
  return {
    participant: {
      participantId,
      reconnectToken: randomSecret(),
      nickname: sanitizeNickname(nickname),
      driverId: null,
      ready: false,
      connectionState: "connected",
      graceTimer: null,
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
    },
    participantId,
  };
}

export function createRoom(store, { nickname } = {}) {
  let code;
  do { code = randomCode(); } while (store.rooms.has(code));
  const { participant, participantId } = newParticipant(nickname);
  const room = {
    code,
    hostParticipantId: participantId,
    createdAt: Date.now(),
    startedAt: null,
    participants: new Map([[participantId, participant]]),
  };
  store.rooms.set(code, room);
  return { room, participantId, reconnectToken: participant.reconnectToken };
}

export function joinRoom(store, { roomCode, nickname } = {}) {
  const room = findRoom(store, roomCode);
  if (room.startedAt) throw new RoomError("race_started", "La gara di questa stanza è già iniziata.");
  if (room.participants.size >= MAX_PARTICIPANTS) throw new RoomError("room_full", "La stanza è piena.");
  const { participant, participantId } = newParticipant(nickname);
  room.participants.set(participantId, participant);
  return { room, participantId, reconnectToken: participant.reconnectToken };
}

export function reconnectParticipant(store, { roomCode, participantId, reconnectToken }) {
  const room = findRoom(store, roomCode);
  const participant = findParticipant(room, participantId);
  if (participant.reconnectToken !== reconnectToken) throw new RoomError("invalid_token", "Token di riconnessione non valido.");
  clearGraceTimer(participant);
  participant.connectionState = "connected";
  participant.lastSeenAt = Date.now();
  return room;
}

export function reserveDriver(store, { roomCode, participantId, driverId }) {
  const room = findRoom(store, roomCode);
  const participant = findParticipant(room, participantId);
  if (!VALID_DRIVER_IDS.has(driverId)) throw new RoomError("invalid_driver", "Pilota non valido.");
  for (const other of room.participants.values()) {
    if (other.participantId !== participantId && other.driverId === driverId) {
      throw new RoomError("driver_taken", "Questo pilota è già stato scelto.");
    }
  }
  participant.driverId = driverId;
  return room;
}

export function releaseDriver(store, { roomCode, participantId }) {
  const room = findRoom(store, roomCode);
  const participant = findParticipant(room, participantId);
  participant.driverId = null;
  return room;
}

export function setReady(store, { roomCode, participantId, ready }) {
  const room = findRoom(store, roomCode);
  const participant = findParticipant(room, participantId);
  participant.ready = !!ready;
  return room;
}

export function startRace(store, { roomCode, participantId }) {
  const room = findRoom(store, roomCode);
  findParticipant(room, participantId);
  if (room.hostParticipantId !== participantId) throw new RoomError("not_host", "Solo l'host può avviare la gara.");
  if (room.startedAt) throw new RoomError("race_started", "La gara è già iniziata.");
  // Stage 1 stops here deliberately: this marks the room as started for
  // display purposes only. Actual car/position/lap sync is Stage 2's job
  // (a separate issue) — see room-client.js's confirmation-only handling.
  room.startedAt = Date.now();
  return room;
}

export function touch(store, { roomCode, participantId }) {
  const room = findRoom(store, roomCode);
  const participant = findParticipant(room, participantId);
  participant.lastSeenAt = Date.now();
  return room;
}

function clearGraceTimer(participant) {
  if (participant.graceTimer) {
    clearTimeout(participant.graceTimer);
    participant.graceTimer = null;
  }
}

function isRoomEmpty(room) {
  return room.participants.size === 0;
}

// Picks the longest-connected remaining participant as the new host so a
// room is never stuck without start authority. `connectedAt` (set once at
// join time), not `lastSeenAt` (updated on every heartbeat), is what
// "longest-connected" actually means here.
function promoteNextHost(room, excludeParticipantId) {
  let next = null;
  for (const p of room.participants.values()) {
    if (p.participantId === excludeParticipantId) continue;
    if (!next || p.connectedAt < next.connectedAt) next = p;
  }
  room.hostParticipantId = next ? next.participantId : null;
  return room.hostParticipantId;
}

// Shared by an explicit leave and a grace-period expiry: deletes the
// participant outright (no lingering "left" tombstone — a deleted
// participant's driverId is implicitly free again since reserveDriver only
// ever looks at participants still in the map) and hands off host if
// needed. Deletes the room itself once empty, freeing its code for reuse.
function removeParticipant(store, room, participantId) {
  room.participants.delete(participantId);
  let hostChanged = false;
  if (room.hostParticipantId === participantId) {
    promoteNextHost(room, participantId);
    hostChanged = true;
  }
  if (isRoomEmpty(room)) {
    store.rooms.delete(room.code);
    return { room: null, hostChanged };
  }
  return { room, hostChanged };
}

export function leaveRoom(store, { roomCode, participantId }) {
  const room = findRoom(store, roomCode);
  const participant = findParticipant(room, participantId);
  clearGraceTimer(participant);
  return removeParticipant(store, room, participantId);
}

// Called by the transport layer when a participant's socket closes. Starts
// a grace timer instead of releasing the slot immediately, so a brief
// network hiccup or a page reload doesn't cost someone their reserved
// driver. `onExpire({room, hostChanged})` fires once, only if the
// participant is still in "grace" (not reconnected) when the timer elapses.
export function markDisconnected(store, { roomCode, participantId, graceMs = DEFAULT_GRACE_MS, onExpire }) {
  const room = findRoom(store, roomCode);
  const participant = findParticipant(room, participantId);
  participant.connectionState = "grace";
  clearGraceTimer(participant);
  participant.graceTimer = setTimeout(() => {
    const stillGrace = room.participants.get(participantId);
    if (!stillGrace || stillGrace.connectionState !== "grace") return;
    const result = removeParticipant(store, room, participantId);
    if (onExpire) onExpire(result);
  }, graceMs);
  return room;
}

// JSON-safe view of a room: never includes a reconnectToken (private,
// returned only to its owner at create/join/reconnect time) or the live
// setTimeout handle, and drops lastSeenAt as internal-only bookkeeping.
export function toPublicRoom(room) {
  return {
    code: room.code,
    hostParticipantId: room.hostParticipantId,
    createdAt: room.createdAt,
    startedAt: room.startedAt,
    maxParticipants: MAX_PARTICIPANTS,
    participants: [...room.participants.values()].map((p) => ({
      participantId: p.participantId,
      nickname: p.nickname,
      driverId: p.driverId,
      ready: p.ready,
      connectionState: p.connectionState,
    })),
  };
}
