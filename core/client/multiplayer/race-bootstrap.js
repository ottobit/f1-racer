// Tiny synchronous-looking bootstrap so main.js's own top-level code (which
// builds the whole scene synchronously, top to bottom) never has to become
// async itself (Stage 2, #44). If ?room=CODE is present and a saved room
// session exists, this resolves the WebSocket reconnect *before* main.js
// loads, and hands the already-connected client to it via a one-shot
// window property. Solo play (no ?room=) skips straight to importing
// main.js with no delay.

import { createRoomClient } from "./room-client.js?v=2";

const roomCode = new URLSearchParams(location.search).get("room");
if (roomCode) {
  const client = createRoomClient();
  if (client.hasSavedSession()) {
    try {
      await client.tryResume();
    } catch (err) {
      // Session expired, room gone, server unreachable, etc. — fall back to
      // an ordinary solo race rather than stalling on a room that can't be
      // rejoined.
      console.warn("[race-bootstrap] could not resume room session, falling back to solo race", err);
    }
  }
  if (client.room) window.__mpClient = client;
}

import("../race/main.js?v=44");
