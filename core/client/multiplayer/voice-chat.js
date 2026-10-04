// Race voice chat (#1, #369): the one place that picks the transport. MoQ
// relay first (works across mobile NAT), WebRTC mesh as the fallback for
// browsers MoQ cannot run in. Both answer the VoiceChat interface
// (voice-transport.js), so callers never ask which one they got.
// Note: two drivers on different transports cannot hear each other.
import { MoqVoiceChat } from "./voice-moq.js?v=1";
import { WebRtcVoiceChat } from "./voice-webrtc.js?v=1";

const TRANSPORTS = [MoqVoiceChat, WebRtcVoiceChat];

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
