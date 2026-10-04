// WebRTC voice transport (#1), the fallback behind voice-chat.js (#369) for
// browsers the MoQ relay transport cannot run in: every participant talks
// to every other one over a peer-to-peer WebRTC mesh (N<=12, audio only, ~30 kbps per peer). The room
// server only relays signaling (see room-server.mjs "voice_signal"); audio
// never touches it. Started from the engine-gate tap, the one user gesture
// every race already has, so the mic prompt needs no extra button.
//
// Pairing: the peer with the smaller participantId always makes the offer.
// Each side announces itself with "hello" when it starts; a hello tells the
// offerer to (re)connect, and the answerer replies so the offerer learns it
// is there. No mic (denied/unavailable) still joins, listen-only.

import { LevelMeter, VoiceChat } from "./voice-transport.js?v=1";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const DEAD_STATES = new Set(["failed", "closed", "disconnected"]);

export class WebRtcVoiceChat extends VoiceChat {
  static get supported() { return typeof window.RTCPeerConnection === "function"; }

  #mesh;
  constructor(options) {
    super();
    this.#mesh = startMesh(options);
  }

  getState(id) { return this.#mesh.getState(id); }
  toggleMute() { this.#mesh.toggleMute(); }
  stop() { this.#mesh.stop(); }
}

function startMesh({ client, onStatus = () => {} }) {
  const myId = client.participantId;
  const peers = new Map(); // participantId -> {pc, audio, chain}
  let localTrack = null;
  let muted = false;
  let stopped = false;
  // Diagnostics (#93): why the peer count stays at 0.
  const failed = new Set(); // peers whose connection failed and was dropped
  let heardFromPeer = false; // any signal from another participant
  let serverUnsupported = false; // room server predates voice_signal
  // Peers already greeted; a peer that drops out and comes back (or shows
  // up after we started) gets a fresh hello (#95).
  const greeted = new Set();
  let ready = false; // mic question settled, hellos may go out
  // Incoming level meter (#180): one analyser per peer, never routed to the
  // speakers (the <audio> element already plays it).
  let meterCtx = null;
  const localMeter = {};
  const remoteStatus = new Map();

  function attachMeter(peer, stream) {
    try {
      meterCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (meterCtx.state === "suspended") meterCtx.resume().catch(() => {});
      peer.meter = LevelMeter.fromStream(meterCtx, stream);
    } catch (err) {
      console.warn("[voice-chat] no level meter", err);
    }
  }

  function greetNewPeers(room) {
    const present = new Set(otherIds(room));
    for (const id of [...greeted]) if (!present.has(id)) greeted.delete(id);
    if (!ready) return;
    for (const id of present) {
      if (greeted.has(id)) continue;
      greeted.add(id);
      client.sendVoiceSignal(id, { kind: "hello" });
      sendState(id);
    }
  }

  function sendState(id) {
    client.sendVoiceSignal(id, { kind: "voice_state", muted, hasMic: !!localTrack && localTrack.readyState === "live" });
  }

  function broadcastState() {
    for (const id of otherIds(client.room)) sendState(id);
  }

  const speaking = (peer) => peer?.meter?.speaking ?? false;

  const isOfferer = (otherId) => myId < otherId;

  function report() {
    let connected = 0;
    let connecting = 0;
    for (const peer of peers.values()) {
      if (peer.pc.connectionState === "connected") connected += 1;
      else connecting += 1;
    }
    onStatus({
      connected,
      connecting,
      failed: failed.size,
      expected: otherIds(client.room).length,
      heardFromPeer,
      serverUnsupported,
      muted,
      hasMic: !!localTrack,
    });
  }

  function otherIds(room) {
    if (!room) return [];
    return room.participants
      .filter((p) => p.participantId !== myId && p.connectionState === "connected")
      .map((p) => p.participantId);
  }

  function closePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    peer.meter?.disconnect();
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    report();
  }

  function createPeer(id) {
    closePeer(id);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    audio.hidden = true;
    document.body.appendChild(audio);
    const peer = { pc, audio };
    peers.set(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) client.sendVoiceSignal(id, { kind: "ice", candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      if (!peer.meter) attachMeter(peer, audio.srcObject);
      audio.play().catch(() => {
        // Autoplay refused (no mic granted, so no capture exemption): retry
        // on the next tap or key.
        const retry = () => audio.play().catch(() => {});
        window.addEventListener("pointerdown", retry, { once: true });
        window.addEventListener("keydown", retry, { once: true });
      });
    };
    pc.onconnectionstatechange = () => {
      if (peers.get(id) !== peer) return;
      console.info("[voice-chat]", id, "connection", pc.connectionState, "ice", pc.iceConnectionState);
      if (pc.connectionState === "connected") failed.delete(id);
      if (pc.connectionState === "failed") {
        failed.add(id);
        closePeer(id);
      } else report();
    };
    return peer;
  }

  async function makeOffer(id) {
    const peer = createPeer(id);
    if (localTrack) peer.pc.addTrack(localTrack, new MediaStream([localTrack]));
    else peer.pc.addTransceiver("audio", { direction: "recvonly" });
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    client.sendVoiceSignal(id, { kind: "offer", sdp: peer.pc.localDescription.sdp });
  }

  async function acceptOffer(id, sdp) {
    const peer = createPeer(id);
    await peer.pc.setRemoteDescription({ type: "offer", sdp });
    const transceiver = peer.pc.getTransceivers()[0];
    if (transceiver) {
      if (localTrack) {
        await transceiver.sender.replaceTrack(localTrack);
        transceiver.direction = "sendrecv";
      } else {
        transceiver.direction = "recvonly";
      }
    }
    await peer.pc.setLocalDescription(await peer.pc.createAnswer());
    client.sendVoiceSignal(id, { kind: "answer", sdp: peer.pc.localDescription.sdp });
  }

  async function handleSignal(from, data) {
    if (stopped || !data) return;
    if (data.kind === "unsupported") {
      serverUnsupported = true;
      report();
      return;
    }
    heardFromPeer = true;
    const peer = peers.get(from);
    switch (data.kind) {
      case "voice_state":
        remoteStatus.set(from, { muted: data.muted === true, hasMic: data.hasMic === true });
        break;
      case "hello":
        sendState(from);
        // The other side (re)started, so any connection we hold is stale.
        if (isOfferer(from)) await makeOffer(from);
        else {
          closePeer(from);
          client.sendVoiceSignal(from, { kind: "hello_reply" });
        }
        break;
      case "hello_reply":
        sendState(from);
        if (isOfferer(from) && (!peer || DEAD_STATES.has(peer.pc.connectionState))) await makeOffer(from);
        break;
      case "offer":
        if (!isOfferer(from)) await acceptOffer(from, data.sdp);
        break;
      case "answer":
        if (peer && peer.pc.signalingState === "have-local-offer") {
          await peer.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
        }
        break;
      case "ice":
        if (peer && peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
        else if (peer) (peer.pendingIce ||= []).push(data.candidate);
        break;
    }
    // Candidates that arrived before the remote description was set.
    const current = peers.get(from);
    if (current && current.pc.remoteDescription && current.pendingIce) {
      const queued = current.pendingIce.splice(0);
      for (const candidate of queued) await current.pc.addIceCandidate(candidate).catch(() => {});
    }
    report();
  }

  // Must run inside the user gesture for iOS to show the mic prompt.
  const micRequest = navigator.mediaDevices?.getUserMedia
    ? navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    : Promise.reject(new Error("getUserMedia unavailable"));

  // Signaling is handled strictly in order (an offer before its ICE
  // candidates), and only once the mic question is settled, so an answer
  // always carries the local track when there is one.
  let signalChain = micRequest
    .then((stream) => {
      if (stopped) { for (const track of stream.getTracks()) track.stop(); return; }
      localTrack = stream.getAudioTracks()[0] || null;
      if (localTrack) {
        attachMeter(localMeter, stream);
        localTrack.addEventListener("ended", () => { broadcastState(); report(); });
      }
    })
    .catch((err) => console.warn("[voice-chat] no microphone, listen-only", err))
    .then(() => {
      if (stopped) return;
      ready = true;
      greetNewPeers(client.room);
      report();
    });
  client.onVoiceSignal((from, data) => {
    signalChain = signalChain
      .then(() => handleSignal(from, data))
      .catch((err) => console.warn("[voice-chat] signaling error", err));
  });

  client.onStateChange((room) => {
    if (stopped) return;
    const present = new Set(otherIds(room));
    for (const id of [...peers.keys()]) if (!present.has(id)) closePeer(id);
    for (const id of [...failed]) if (!present.has(id)) failed.delete(id);
    for (const id of remoteStatus.keys()) if (!present.has(id)) remoteStatus.delete(id);
    greetNewPeers(room);
    report();
  });

  window.addEventListener("pagehide", stop);

  function stop() {
    stopped = true;
    for (const id of [...peers.keys()]) closePeer(id);
    if (localTrack) localTrack.stop();
    localMeter.meter?.disconnect();
    meterCtx?.close().catch(() => {});
    window.removeEventListener("pagehide", stop);
  }

  return {
    getState(id) {
      if (stopped || serverUnsupported) return { status: "error", hasMic: false };
      if (id === myId) {
        const hasMic = !!localTrack && localTrack.readyState === "live";
        return { status: !ready ? "connecting" : hasMic ? "active" : "listen-only",
          hasMic, muted, speaking: hasMic && !muted && speaking(localMeter) };
      }
      const peer = peers.get(id);
      const remote = remoteStatus.get(id);
      const connection = peer?.pc.connectionState;
      const status = failed.has(id) || DEAD_STATES.has(connection) ? "error"
        : connection === "connected" ? "active" : "connecting";
      return { status, ...remote, speaking: status === "active" && remote?.muted !== true && speaking(peer) };
    },
    toggleMute() {
      if (!localTrack || localTrack.readyState !== "live") return;
      muted = !muted;
      if (localTrack) localTrack.enabled = !muted;
      broadcastState();
      report();
    },
    stop,
  };
}
