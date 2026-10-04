// Race voice chat (#1, #369): the one place that picks the transport.
// Every driver uses the MoQ relay; the WebRTC mesh was dropped because a
// lone fallback phone could hear nobody on MoQ. A browser no transport
// supports shows "Audio non disponibile". A future transport is one more
// VoiceChat subclass (voice-transport.js) in this list.
import { MoqVoiceChat } from "./voice-moq.js?v=3";

const TRANSPORTS = [MoqVoiceChat];

const pick = () => TRANSPORTS.find((Transport) => Transport.supported) ?? null;

export function voiceSupported() {
  return pick() !== null;
}

// At room start, ahead of the engine-gate tap.
export function preloadVoice() {
  pick()?.preload();
}

// Inside the user gesture. Returns null when no transport is supported.
export function startVoiceChat({ client }) {
  const Transport = pick();
  return Transport ? new Transport({ client }) : null;
}
