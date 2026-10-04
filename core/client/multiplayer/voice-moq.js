// MoQ voice transport (#369), the default behind voice-chat.js: every
// driver publishes their mic once to a public Media over QUIC relay as
// f1-racer/<voiceKey>/<participantId>.hang and plays every other
// connected participant's broadcast. All connections are outbound, so
// mobile NAT does not matter (the WebRTC mesh failed there), and a phone
// uploads one stream whatever the grid size. Proven on two iPhones with
// voice-probe.html (#361, #367). See wiki c4-voice.md, flow B.
//
// voiceKey is a GUID the room server sends only to members (#371): the
// relay is public, so the path itself is what keeps strangers out.
//
// Mute and has-mic still travel peer to peer as "voice_state" over the room
// server's voice_signal relay; audio never touches the room server.
import { LevelMeter, VoiceChat } from "./voice-transport.js?v=1";

const PUBLISH_URL = "https://esm.sh/@moq/publish@0.5.1";
const WATCH_URL = "https://esm.sh/@moq/watch@0.6.1";
const RELAY_URL = "https://cdn.moq.dev/anon";
const PATH_PREFIX = "f1-racer";

let modules = null;

export class MoqVoiceChat extends VoiceChat {
  static get supported() {
    return typeof AudioWorkletNode === "function" && typeof WebSocket === "function";
  }

  static preload() {
    modules ||= Promise.all([import(PUBLISH_URL), import(WATCH_URL)]);
    modules.catch((err) => console.warn("[voice-moq] library not loaded", err));
    return modules;
  }

  #client;
  #myId;
  #voiceKey = null;
  #track = null;
  #muted = false;
  #ready = false;
  #failed = false;
  #stopped = false;
  #Watch = null;
  #watchConnection = null;
  #closers = []; // publish side
  #players = new Map(); // participantId -> { player, meter, unsubscribe }
  #remote = new Map(); // participantId -> { muted, hasMic }
  #meterContext = null;
  #localMeter = null;
  #onPageHide = () => this.stop();

  // Must be constructed inside the user gesture (engine gate): iOS ties the
  // mic prompt and the audio session to it.
  constructor({ client }) {
    super();
    this.#client = client;
    this.#myId = client.participantId;
    if (navigator.audioSession) navigator.audioSession.type = "play-and-record";
    const micRequest = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }).catch((err) => { console.warn("[voice-moq] no microphone, listen-only", err); return null; })
      : Promise.resolve(null);
    Promise.all([micRequest, MoqVoiceChat.preload()])
      .then(([stream, [Publish, Watch]]) => this.#start(stream, Publish, Watch))
      .catch((err) => {
        console.warn("[voice-moq] start failed", err);
        this.#failed = true;
      });
    client.onVoiceSignal((from, data) => {
      if (data?.kind !== "voice_state") return;
      this.#remote.set(from, { muted: data.muted === true, hasMic: data.hasMic === true });
    });
    client.onStateChange((room) => this.#sync(room));
    window.addEventListener("pagehide", this.#onPageHide);
  }

  #start(stream, Publish, Watch) {
    this.#voiceKey = this.#client.room?.voiceKey ?? null;
    if (this.#stopped || !this.#voiceKey) {
      for (const track of stream?.getTracks() ?? []) track.stop();
      // A room server older than #371 sends no key: no voice rather than a
      // guessable path.
      if (!this.#voiceKey) this.#failed = true;
      return;
    }
    this.#track = stream?.getAudioTracks()[0] ?? null;
    if (this.#track) {
      this.#publish(Publish);
      try {
        this.#meterContext = new AudioContext();
        this.#localMeter = LevelMeter.fromStream(this.#meterContext, stream);
      } catch (err) {
        console.warn("[voice-moq] no level meter", err);
      }
      this.#track.addEventListener("ended", () => this.#broadcastState());
    }
    this.#Watch = Watch;
    this.#watchConnection = new Watch.Net.Connection({ url: new URL(RELAY_URL), enabled: true, share: false });
    this.#ready = true;
    this.#sync(this.#client.room);
    this.#broadcastState();
  }

  #path(Net, participantId) {
    return Net.Path.from(`${PATH_PREFIX}/${this.#voiceKey}/${participantId}.hang`);
  }

  // Publish and watch use separate connections, as in the probe.
  #publish(Publish) {
    const connection = new Publish.Net.Connection({ url: new URL(RELAY_URL), enabled: true, share: false });
    const broadcast = new Publish.Broadcast({
      origin: connection.origin,
      enabled: true,
      name: this.#path(Publish.Net, this.#myId),
    });
    const capture = new Publish.Audio.Capture({ source: new Publish.Signals.Signal(this.#track) });
    const encoder = new Publish.Audio.Encoder("audio", { broadcast, capture, enabled: true });
    this.#closers.push(encoder, capture, broadcast, connection);
  }

  #otherIds(room) {
    if (!room) return [];
    return room.participants
      .filter((p) => p.participantId !== this.#myId && p.connectionState === "connected")
      .map((p) => p.participantId);
  }

  // One player per connected participant; newcomers also get our state.
  #sync(room) {
    if (this.#stopped) return;
    const present = new Set(this.#otherIds(room));
    for (const id of [...this.#players.keys()]) if (!present.has(id)) this.#closePlayer(id);
    for (const id of [...this.#remote.keys()]) if (!present.has(id)) this.#remote.delete(id);
    if (!this.#ready) return;
    for (const id of present) {
      if (this.#players.has(id)) continue;
      this.#openPlayer(id);
      this.#sendState(id);
    }
  }

  // The player builds its AudioContext when that driver's audio arrives;
  // iOS keeps it suspended until the next tap, which racing on a phone
  // gives at once (the library resumes it on any pointerup).
  #openPlayer(id) {
    const Watch = this.#Watch;
    const player = new Watch.Player({
      origin: this.#watchConnection.origin,
      probe: this.#watchConnection.probe,
      name: this.#path(Watch.Net, id),
      canvas: document.createElement("canvas"),
      visible: "never",
      volume: 1,
    });
    const entry = { player, meter: null, unsubscribe: null };
    entry.unsubscribe = player.audio.out.root.subscribe((root) => {
      entry.meter?.disconnect();
      entry.meter = root ? LevelMeter.fromNode(root) : null;
    });
    this.#players.set(id, entry);
  }

  #closePlayer(id) {
    const entry = this.#players.get(id);
    if (!entry) return;
    this.#players.delete(id);
    entry.unsubscribe?.();
    entry.meter?.disconnect();
    try { entry.player.close(); } catch (err) { console.warn("[voice-moq] close", err); }
  }

  get #hasMic() { return !!this.#track && this.#track.readyState === "live"; }

  #sendState(id) {
    this.#client.sendVoiceSignal(id, { kind: "voice_state", muted: this.#muted, hasMic: this.#hasMic });
  }

  #broadcastState() {
    for (const id of this.#otherIds(this.#client.room)) this.#sendState(id);
  }

  getState(id) {
    if (this.#stopped || this.#failed) return { status: "error", hasMic: false };
    if (id === this.#myId) {
      const hasMic = this.#hasMic;
      return {
        status: !this.#ready ? "connecting" : hasMic ? "active" : "listen-only",
        hasMic, muted: this.#muted,
        speaking: hasMic && !this.#muted && (this.#localMeter?.speaking ?? false),
      };
    }
    const entry = this.#players.get(id);
    const remote = this.#remote.get(id);
    // A driver without a mic publishes nothing; they are still "in".
    const status = entry?.meter || remote?.hasMic === false ? "active" : "connecting";
    return { status, ...remote, speaking: remote?.muted !== true && (entry?.meter?.speaking ?? false) };
  }

  toggleMute() {
    if (!this.#hasMic) return;
    this.#muted = !this.#muted;
    this.#track.enabled = !this.#muted;
    this.#broadcastState();
  }

  stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    for (const id of [...this.#players.keys()]) this.#closePlayer(id);
    for (const item of this.#closers.splice(0)) {
      try { item.close(); } catch (err) { console.warn("[voice-moq] close", err); }
    }
    try { this.#watchConnection?.close(); } catch {}
    this.#track?.stop();
    this.#localMeter?.disconnect();
    this.#meterContext?.close().catch(() => {});
    window.removeEventListener("pagehide", this.#onPageHide);
  }
}
