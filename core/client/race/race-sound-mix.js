// Race sound mix (#379): one HUD button (or M) steps through how loud the
// cars are and whether the drivers' voices play. The race starts with the
// engines low, so in multiplayer the voice chat is what you hear first; a
// full-volume engine was dropped as unwanted (#381). The choice is
// remembered per context (solo / multiplayer).
const MIX = {
  low: { label: "MOTORI BASSI", engine: 0.2, voices: true },
  off: { label: "MOTORI SPENTI", engine: 0, voices: true },
  mute: { label: "TUTTO SPENTO", engine: 0, voices: false },
};
// First entry is the default. Solo has no voices, so no "tutto spento".
const ORDER = {
  solo: ["low", "off"],
  multiplayer: ["low", "off", "mute"],
};

export class SoundMix {
  #order;
  #index = 0;
  #storageKey;
  #setEngineVolume;
  #setVoicesOn;
  #button;

  constructor({ multiplayer, button, setEngineVolume, setVoicesOn = () => {} }) {
    const context = multiplayer ? "multiplayer" : "solo";
    this.#order = ORDER[context];
    this.#storageKey = `f1racer-sound-mix-${context}`;
    this.#setEngineVolume = setEngineVolume;
    this.#setVoicesOn = setVoicesOn;
    this.#button = button;
    let stored = null;
    try { stored = localStorage.getItem(this.#storageKey); } catch {}
    this.#index = Math.max(this.#order.indexOf(stored), 0);
    button?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.next();
    });
    window.addEventListener("keydown", (event) => {
      if (event.code === "KeyM" && !event.repeat) this.next();
    });
    this.#apply();
  }

  get mode() { return MIX[this.#order[this.#index]]; }

  next() {
    this.#index = (this.#index + 1) % this.#order.length;
    try { localStorage.setItem(this.#storageKey, this.#order[this.#index]); } catch {}
    this.#apply();
  }

  #apply() {
    const { label, engine, voices } = this.mode;
    this.#setEngineVolume(engine);
    this.#setVoicesOn(voices);
    if (!this.#button) return;
    this.#button.textContent = label;
    this.#button.dataset.mix = this.#order[this.#index];
    this.#button.setAttribute("aria-label", `Audio: ${label.toLowerCase()}. Tocca per cambiare`);
  }
}
