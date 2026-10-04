// One AudioContext for all voices (#385). @moq/watch builds a context per
// heard driver and @moq/publish one for the mic, each a realtime audio
// thread and output stream: on a phone that is N+1 threads mixing in
// parallel. Neither library takes a context as input, so while voice is on
// the AudioContext constructor hands their exact request (interactive
// latency at an explicit sample rate) one shared context per rate. Any
// other caller, like the engine sound, still gets its own context.
//
// The libraries close their context when a player goes away; on the shared
// one that close is a no-op, and the real close happens in uninstall().
export class SharedVoiceAudioContext {
  #Native = null;
  #contexts = new Map(); // sampleRate -> AudioContext

  install() {
    if (this.#Native || typeof window.AudioContext !== "function") return;
    const Native = window.AudioContext;
    const shared = (options) => this.#shared(Native, options.sampleRate);
    function VoiceAudioContext(options) {
      if (!new.target) throw new TypeError("AudioContext requires 'new'");
      return options?.latencyHint === "interactive" && options.sampleRate
        ? shared(options)
        : new Native(options);
    }
    VoiceAudioContext.prototype = Native.prototype;
    Object.setPrototypeOf(VoiceAudioContext, Native);
    this.#Native = Native;
    window.AudioContext = VoiceAudioContext;
  }

  #shared(Native, sampleRate) {
    let context = this.#contexts.get(sampleRate);
    if (!context || context.state === "closed") {
      context = new Native({ latencyHint: "interactive", sampleRate });
      context.close = () => Promise.resolve();
      this.#contexts.set(sampleRate, context);
    }
    return context;
  }

  get count() { return this.#contexts.size; }

  uninstall() {
    if (!this.#Native) return;
    window.AudioContext = this.#Native;
    for (const context of this.#contexts.values()) {
      this.#Native.prototype.close.call(context).catch(() => {});
    }
    this.#contexts.clear();
    this.#Native = null;
  }
}
