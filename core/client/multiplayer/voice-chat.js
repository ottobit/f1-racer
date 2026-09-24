// Race voice chat (#1): every participant talks to every other one over a
// peer-to-peer WebRTC mesh (N<=10, audio only, ~30 kbps per peer). The room
// server only relays signaling (see room-server.mjs "voice_signal"); audio
// never touches it. Started from the engine-gate tap, the one user gesture
// every race already has, so the mic prompt needs no extra button.
//
// Pairing: the peer with the smaller participantId always makes the offer.
// Each side announces itself with "hello" when it starts; a hello tells the
// offerer to (re)connect, and the answerer replies so the offerer learns it
// is there. No mic (denied/unavailable) still joins, listen-only.

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const DEAD_STATES = new Set(["failed", "closed", "disconnected"]);

export function startVoiceChat({ client, onStatus = () => {} }) {
  const myId = client.participantId;
  const peers = new Map(); // participantId -> {pc, audio, chain}
  let localTrack = null;
  let muted = false;
  let stopped = false;

  const isOfferer = (otherId) => myId < otherId;

  function report() {
    let connected = 0;
    for (const peer of peers.values()) if (peer.pc.connectionState === "connected") connected += 1;
    onStatus({ connected, muted, hasMic: !!localTrack });
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
      if (pc.connectionState === "failed") closePeer(id);
      else report();
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
    const peer = peers.get(from);
    switch (data.kind) {
      case "hello":
        // The other side (re)started, so any connection we hold is stale.
        if (isOfferer(from)) await makeOffer(from);
        else {
          closePeer(from);
          client.sendVoiceSignal(from, { kind: "hello_reply" });
        }
        break;
      case "hello_reply":
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
    .then((stream) => { localTrack = stream.getAudioTracks()[0] || null; })
    .catch((err) => console.warn("[voice-chat] no microphone, listen-only", err))
    .then(() => {
      if (stopped) return;
      for (const id of otherIds(client.room)) client.sendVoiceSignal(id, { kind: "hello" });
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
  });

  window.addEventListener("pagehide", stop);

  function stop() {
    stopped = true;
    for (const id of [...peers.keys()]) closePeer(id);
    if (localTrack) localTrack.stop();
  }

  return {
    toggleMute() {
      muted = !muted;
      if (localTrack) localTrack.enabled = !muted;
      report();
    },
    stop,
  };
}

// HUD toggle under the lap counter: shows how many peers are heard and
// mutes/unmutes the local mic. Returns the onStatus callback to wire in.
export function mountVoiceToggle(container) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "voice-toggle";
  button.textContent = "Voce…";
  button.setAttribute("aria-pressed", "false");
  container.appendChild(button);
  let voice = null;
  button.addEventListener("click", () => voice && voice.toggleMute());
  return {
    attach(v) { voice = v; },
    onStatus({ connected, muted, hasMic }) {
      const label = !hasMic ? "Solo ascolto" : muted ? "Muto" : "Voce";
      button.textContent = `${hasMic && !muted ? "🎙" : "🔇"} ${label} · ${connected}`;
      button.setAttribute("aria-pressed", String(muted));
      button.disabled = !hasMic;
    },
  };
}
