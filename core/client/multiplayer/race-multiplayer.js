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

import { preloadVoice, startVoiceChat, voiceSupported } from "./voice-chat.js?v=10";

const BROADCAST_INTERVAL_MS = 80; // ~12/s — plenty smooth at N<=10, trivial bandwidth

export function setupMultiplayer() {
  const client = window.__mpClient;
  if (!client || !client.room) return null;
  delete window.__mpClient; // one-shot handoff
  preloadVoice();

  const remoteSamples = new Map(); // participantId -> latest car_state payload
  const disconnected = new Set();
  let latestRoom = client.room;
  let gridCallback = null;
  let gridDelivered = false;
  let lastBroadcastAt = 0;
  let voicesDeafened = false;

  // "player" is this browser's own driver.
  const participantOf = (driverId) => latestRoom.participants.find((p) => driverId === "player"
    ? p.participantId === client.participantId : p.driverId === driverId);

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

  // A dropped socket comes back on its own (room-client.js, #343); the
  // server forgets the agent bridge with the old socket, so register it
  // again with the same token.
  let bridge = null; // { token }
  let wasDropped = false;
  client.onConnectionChange((status) => {
    if (status !== "connected") { wasDropped = true; return; }
    if (!wasDropped || !bridge) return;
    wasDropped = false;
    client.registerAgentBridge(bridge.token).catch(() => {});
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

    // "connected" | "reconnecting" | "disconnected" | "lost" (room-client.js).
    onConnectionChange(cb) { client.onConnectionChange(cb); },

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

    // Browser-independent agent transport (#201). Native WebMCP is just one
    // adapter; this path lets an external MCP process call the exact same
    // controller through the room server's WebSocket relay.
    async registerAgentBridge(execute, token = null) {
      const unsubscribe = client.onAgentCommand(async (msg) => {
        try {
          const result = await execute(msg.tool, msg.args || {});
          client.sendAgentResult(msg.callId, true, result);
        } catch (error) {
          client.sendAgentResult(msg.callId, false, null, error?.message || error);
        }
      });
      try {
        const res = await client.registerAgentBridge(token);
        bridge = { token: res.token };
        return {
          serverUrl: client.getServerUrl(),
          token: res.token,
          roomCode: res.roomCode,
          participantId: res.participantId,
        };
      } catch (error) {
        unsubscribe();
        throw error;
      }
    },

    getVoiceState(driverId) {
      const participant = participantOf(driverId);
      if (!participant || participant.connectionState !== "connected") return { status: "disconnected" };
      if (!voiceSupported()) return { status: "error", hasMic: false };
      return this.voice?.getState(participant.participantId) || { status: "idle" };
    },
    toggleVoice() {
      if (this.voice) this.voice.toggleMute();
      else this.startVoice();
    },
    // Listener side (#379): tap a rival's name to stop or resume hearing
    // them; the sound mix's "tutto spento" silences every driver.
    toggleListen(driverId) {
      const participant = participantOf(driverId);
      if (!this.voice || !participant) return;
      const { excluded } = this.voice.getState(participant.participantId);
      this.voice.setExcluded(participant.participantId, !excluded);
    },
    get voiceDiagnostics() { return this.voice?.diagnostics ?? "voce: spenta"; },
    setVoicesDeafened(on) {
      voicesDeafened = on;
      this.voice?.setDeafened(on);
    },

    // Race voice chat (#1). Call from inside a user gesture (the engine
    // gate) so the mic permission prompt is allowed. Idempotent.
    startVoice() {
      if (this.voice || !voiceSupported()) return;
      this.voice = startVoiceChat({ client });
      this.voice?.setDeafened(voicesDeafened);
    },
  };
}
