// Race voice chat interface (#369). voice-chat.js picks the transport (today
// only the MoQ relay); the HUD and race-multiplayer.js only ever talk to
// this interface.
export class VoiceChat {
  // Whether this browser can run the transport.
  static get supported() { return false; }
  // Called when the room session starts, before the engine-gate tap, so the
  // tap reaches the mic prompt without waiting on the network.
  static preload() {}

  // { status: "idle"|"connecting"|"active"|"listen-only"|"error", hasMic, muted, speaking,
  //   excluded } — excluded: this listener turned that driver off (#379).
  getState(_participantId) { throw new Error("not implemented"); }
  toggleMute() { throw new Error("not implemented"); }
  // Listener side (#379): stop hearing one driver, or every driver.
  setExcluded(_participantId, _excluded) { throw new Error("not implemented"); }
  setDeafened(_deafened) { throw new Error("not implemented"); }
  stop() { throw new Error("not implemented"); }
}

const SPEAKING_RMS = 0.015;
const SPEAKING_HOLD_MS = 180;
let scratch = null;

// "Is this voice speaking right now" (#180), from an analyser that is never
// routed to the speakers. Shared by every transport.
export class LevelMeter {
  #source;
  #analyser;
  #spokeAt = -Infinity;

  constructor(source, analyser) {
    this.#source = source;
    this.#analyser = analyser;
    source.connect(analyser);
  }

  static fromStream(context, stream) {
    return new LevelMeter(context.createMediaStreamSource(stream), new AnalyserNode(context, { fftSize: 256 }));
  }

  // Taps a node that already plays somewhere, in its own context.
  static fromNode(node) {
    return new LevelMeter(node, new AnalyserNode(node.context, { fftSize: 256 }));
  }

  get speaking() {
    if (scratch?.length !== this.#analyser.fftSize) scratch = new Float32Array(this.#analyser.fftSize);
    this.#analyser.getFloatTimeDomainData(scratch);
    let sum = 0;
    for (const sample of scratch) sum += sample * sample;
    const now = performance.now();
    if (Math.sqrt(sum / scratch.length) > SPEAKING_RMS) this.#spokeAt = now;
    return now - this.#spokeAt < SPEAKING_HOLD_MS;
  }

  disconnect() {
    try { this.#source.disconnect(this.#analyser); } catch {}
  }
}
