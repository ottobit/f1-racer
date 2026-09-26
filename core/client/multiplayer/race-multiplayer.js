// Multiplayer Stage 2 (#44, part of #1) integration adapter for main.js.
// Opt-in only: returns null unless race-bootstrap.js already resolved a
// room session and handed it over via window.__mpClient (see that file for
// why the connection happens before main.js loads, not inside it). Solo
// play never touches window.__mpClient and this always returns null for it.
//
// Owns the client-authoritative sync model (see decisions.md): every
// browser simulates its own car exactly as solo play already does and
// broadcasts position/heading/speed/progress a few times a second; this
// module hands those broadcasts to main.js and relays main.js's own local
// state back out. No physics happen here.

import { startVoiceChat, mountVoiceToggle } from "./voice-chat.js?v=3";

const BROADCAST_INTERVAL_MS = 80; // ~12/s — plenty smooth at N<=10, trivial bandwidth

export function setupMultiplayer() {
  const client = window.__mpClient;
  if (!client || !client.room) return null;
  delete window.__mpClient; // one-shot handoff

  const remoteSamples = new Map(); // participantId -> latest car_state payload
  const disconnected = new Set();
  let latestRoom = client.room;
  let gridCallback = null;
  let gridDelivered = false;
  let lastBroadcastAt = 0;

  function syncDisconnected(room) {
    disconnected.clear();
    for (const p of room.participants) {
      if (p.connectionState !== "connected") disconnected.add(p.participantId);
    }
  }
  syncDisconnected(latestRoom);

  client.onCarState((msg) => {
    // Arrival time lets the race extrapolate between samples (#111).
    remoteSamples.set(msg.participantId, { ...msg, receivedAt: performance.now() });
  });

  client.onStateChange((room) => {
    latestRoom = room;
    if (!room) return;
    syncDisconnected(room);
    if (room.sessionPhase === "racing" && room.grid && !gridDelivered && gridCallback) {
      gridDelivered = true;
      gridCallback(room.grid);
    }
  });

  return {
    get myParticipantId() { return client.participantId; },
    get room() { return latestRoom; },
    // Server-clock "now" (ms), for timestamps like raceStartedAt (#109).
    serverNow() { return client.serverNow(); },

    // Other participants who reserved a driver, in stable participant order
    // (not grid order — that only exists once qualifying ends).
    getRemoteDrivers() {
      return latestRoom.participants
        .filter((p) => p.participantId !== client.participantId && p.driverId)
        .map((p) => ({ participantId: p.participantId, driverId: p.driverId }));
    },

    getRemoteSample(participantId) {
      return remoteSamples.get(participantId) || null;
    },

    isDriverDisconnected(driverId) {
      const p = latestRoom.participants.find((entry) => entry.driverId === driverId);
      return p ? disconnected.has(p.participantId) : false;
    },

    // Fires once, the first time the server broadcasts a grid (qualifying
    // just ended) — never again, so a late room_state replay can't
    // re-trigger the race-start transition a second time.
    onGridReady(cb) {
      gridCallback = cb;
      if (latestRoom.sessionPhase === "racing" && latestRoom.grid && !gridDelivered) {
        gridDelivered = true;
        cb(latestRoom.grid);
      }
    },

    // Throttled fire-and-forget — safe to call every frame.
    broadcastState(data) {
      const now = performance.now();
      if (now - lastBroadcastAt < BROADCAST_INTERVAL_MS) return;
      lastBroadcastAt = now;
      client.sendCarState(data);
    },

    get isHost() { return latestRoom.hostParticipantId === client.participantId; },

    // Radio messages (#7): short text from the room bot, relayed peer by
    // peer over the existing voice_signal channel (the server forwards it
    // untouched, so no protocol change); voice-chat.js ignores the kind.
    sendRadio(text) {
      for (const p of latestRoom.participants) {
        if (p.participantId !== client.participantId) client.sendVoiceSignal(p.participantId, { kind: "radio", text });
      }
    },
    onRadio(cb) {
      client.onVoiceSignal((from, data) => {
        if (data?.kind !== "radio" || typeof data.text !== "string") return;
        const sender = latestRoom.participants.find((p) => p.participantId === from);
        cb(sender?.nickname || "Radio", data.text.slice(0, 80));
      });
    },

    // Shared results (#113): every room update, after this is set.
    onRoomUpdate(cb) {
      client.onStateChange((room) => { if (room) cb(room); });
    },
    reportFinish() { client.reportFinish().catch(() => {}); },
    rematch() { return client.rematch(); },

    reportQualiTime(timeMs) {
      client.reportQualiTime(timeMs).catch(() => {});
    },

    // Race voice chat (#1). Call from inside a user gesture (the engine
    // gate) so the mic permission prompt is allowed. Idempotent.
    startVoice() {
      if (this.voice || !window.RTCPeerConnection) return;
      const toggle = mountVoiceToggle(document.getElementById("hud-topleft"));
      this.voice = startVoiceChat({ client, onStatus: toggle.onStatus });
      toggle.attach(this.voice);
    },
  };
}
