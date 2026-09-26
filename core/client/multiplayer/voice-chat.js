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
  let meterScratch = null;

  function attachMeter(peer, stream) {
    try {
      meterCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (meterCtx.state === "suspended") meterCtx.resume().catch(() => {});
      const source = meterCtx.createMediaStreamSource(stream);
      const analyser = meterCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      peer.meter = { source, analyser };
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
    }
  }

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
    if (peer.meter) peer.meter.source.disconnect();
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
    .then((stream) => { localTrack = stream.getAudioTracks()[0] || null; })
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
    greetNewPeers(room);
    report();
  });

  window.addEventListener("pagehide", stop);

  function stop() {
    stopped = true;
    for (const id of [...peers.keys()]) closePeer(id);
    if (localTrack) localTrack.stop();
  }

  return {
    // Fills `out` (Float32Array, 128 samples) with the loudest peer's
    // waveform and returns its RMS level; 0 when nothing is coming in.
    readWaveform(out) {
      let best = 0;
      for (const peer of peers.values()) {
        if (!peer.meter || peer.pc.connectionState !== "connected") continue;
        meterScratch ||= new Float32Array(peer.meter.analyser.fftSize);
        peer.meter.analyser.getFloatTimeDomainData(meterScratch);
        let sum = 0;
        for (const v of meterScratch) sum += v * v;
        const rms = Math.sqrt(sum / meterScratch.length);
        if (rms > best) {
          best = rms;
          for (let i = 0; i < out.length; i++) out[i] = meterScratch[Math.floor((i * meterScratch.length) / out.length)];
        }
      }
      return best;
    },
    toggleMute() {
      muted = !muted;
      if (localTrack) localTrack.enabled = !muted;
      report();
    },
    stop,
  };
}

// Short reason shown next to the peer count while nobody is connected (#93).
function voiceDiagnosis({ connected, connecting, failed, expected, heardFromPeer, serverUnsupported }) {
  if (serverUnsupported) return "server da aggiornare";
  if (connected > 0) return failed > 0 ? `${connected} · ${failed} falliti` : String(connected);
  if (failed > 0) return "collegamento fallito";
  if (connecting > 0) return "collego…";
  if (expected === 0) return "nessun altro";
  if (!heardFromPeer) return "nessuna risposta";
  return "in attesa";
}

// Connection outcome shown as the icon colour (#180).
function voiceTone({ connected, connecting, failed, expected, heardFromPeer, serverUnsupported }) {
  if (connected > 0) return "ok";
  if (serverUnsupported || failed > 0) return "fail";
  if (connecting > 0 || (expected > 0 && !heardFromPeer)) return "pending";
  return "idle";
}

const RECEIVING_RMS = 0.015; // below this the line stays hidden (silence)
const MIC_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none"/><path class="voice-toggle__slash" d="M4 4l16 16" fill="none"/></svg>`;

// HUD icon under the lap counter: coloured by the connection outcome, with
// a waveform line only while audio is actually coming in; a tap mutes or
// unmutes the local mic. The text diagnosis (#93) lives in its label.
// Returns the onStatus callback to wire in.
export function mountVoiceToggle(container) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "voice-toggle";
  button.dataset.tone = "pending";
  button.innerHTML = `${MIC_ICON}<canvas class="voice-toggle__wave" width="64" height="24"></canvas>`;
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-label", "Voce: collego…");
  container.appendChild(button);
  const canvas = button.querySelector("canvas");
  const g = canvas.getContext("2d");
  const wave = new Float32Array(64);
  let voice = null;
  button.addEventListener("click", () => voice && voice.toggleMute());

  function drawWave() {
    requestAnimationFrame(drawWave);
    const level = voice ? voice.readWaveform(wave) : 0;
    const receiving = level > RECEIVING_RMS;
    button.classList.toggle("is-receiving", receiving);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!receiving) return;
    const gain = Math.min(8, 0.35 / level);
    g.beginPath();
    for (let i = 0; i < wave.length; i++) {
      const y = canvas.height / 2 - wave[i] * gain * (canvas.height / 2);
      if (i === 0) g.moveTo(0, y);
      else g.lineTo((i / (wave.length - 1)) * canvas.width, y);
    }
    g.strokeStyle = getComputedStyle(button).color;
    g.lineWidth = 2;
    g.stroke();
  }
  requestAnimationFrame(drawWave);

  return {
    attach(v) { voice = v; },
    onStatus(status) {
      const { muted, hasMic } = status;
      const label = !hasMic ? "solo ascolto" : muted ? "muto" : "microfono attivo";
      button.dataset.tone = voiceTone(status);
      button.setAttribute("aria-label", `Voce: ${voiceDiagnosis(status)} · ${label}`);
      button.title = button.getAttribute("aria-label");
      button.setAttribute("aria-pressed", String(muted || !hasMic));
      button.disabled = !hasMic;
    },
  };
}
