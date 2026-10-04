// MoQ voice probe (#361): a standalone page that checks whether a phone can
// talk through a public Media over QUIC relay before voice-chat.js moves off
// peer-to-peer WebRTC. One phone publishes its microphone as
// <code>/<role>.hang and listens to the other role; "echo" listens to its
// own broadcast through a private connection, so one phone can test the
// full round trip through the relay.
const PUBLISH_URL = "https://esm.sh/@moq/publish@0.5.1";
const WATCH_URL = "https://esm.sh/@moq/watch@0.6.1";
const PATH_PREFIX = "f1-racer-probe";
const OTHER_ROLE = { a: "b", b: "a" };
// Loaded with the page so the tap that starts the probe reaches the mic
// prompt without waiting on the network (iOS ties it to the gesture).
const modules = Promise.all([import(PUBLISH_URL), import(WATCH_URL)]);

// What the browser offers, checked before any network or mic access.
class SupportReport {
  async collect() {
    return [
      ["WebTransport", typeof WebTransport === "function"],
      ["WebSocket", typeof WebSocket === "function"],
      ["AudioWorklet", typeof AudioWorkletNode === "function"],
      ["Opus encoder", await this.#codec(globalThis.AudioEncoder)],
      ["Opus decoder", await this.#codec(globalThis.AudioDecoder)],
      ["Microfono", !!navigator.mediaDevices?.getUserMedia],
    ];
  }

  async #codec(codecClass) {
    if (!codecClass?.isConfigSupported) return false;
    try {
      const result = await codecClass.isConfigSupported({ codec: "opus", sampleRate: 48000, numberOfChannels: 1 });
      return !!result.supported;
    } catch {
      return false;
    }
  }
}

// One probe run: a publishing connection with the microphone, and a
// listening connection of its own so even an echo goes through the relay.
class MoqVoiceProbe {
  constructor({ relay, code, role, echo, onStatus }) {
    this.relay = new URL(relay);
    this.code = code;
    this.role = role;
    this.listenRole = echo ? role : OTHER_ROLE[role];
    this.onStatus = onStatus;
    this.disposers = [];
    this.closers = [];
  }

  async start() {
    const [Publish, Watch] = await modules;
    this.#publish(Publish);
    this.#listen(Watch);
  }

  #path(Net, role) {
    return Net.Path.from(`${PATH_PREFIX}/${this.code}/${role}.hang`);
  }

  #publish(Publish) {
    const connection = new Publish.Net.Connection({ url: this.relay, enabled: true, share: false });
    const broadcast = new Publish.Broadcast({
      origin: connection.origin,
      enabled: true,
      name: this.#path(Publish.Net, this.role),
    });
    const microphone = new Publish.Source.Microphone({
      enabled: true,
      constraints: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const source = new Publish.Signals.Computed((effect) => effect.get(microphone.out.source)?.audio);
    const capture = new Publish.Audio.Capture({ source });
    const encoder = new Publish.Audio.Encoder("audio", { broadcast, capture, enabled: true });
    this.#watchConnection("Invio", connection);
    this.disposers.push(microphone.out.error.subscribe((err) => {
      if (err) this.onStatus("Microfono", `errore: ${err.name || err.message}`);
    }));
    this.disposers.push(encoder.out.active.subscribe((active) => {
      this.onStatus("Codifica", active ? "attiva (qualcuno ascolta)" : "in attesa di ascoltatori");
    }));
    this.onStatus("Microfono", "richiesto");
    this.closers.push(encoder, capture, microphone, broadcast, connection);
  }

  #listen(Watch) {
    const connection = new Watch.Net.Connection({ url: this.relay, enabled: true, share: false });
    const canvas = document.createElement("canvas");
    const player = new Watch.Player({
      origin: connection.origin,
      probe: connection.probe,
      name: this.#path(Watch.Net, this.listenRole),
      canvas,
      visible: "never",
      volume: 1,
    });
    this.#watchConnection("Ascolto", connection);
    this.onStatus("Ascolto di", `${this.code}/${this.listenRole}`);
    this.closers.push(player, connection);
  }

  #watchConnection(label, connection) {
    const show = () => {
      const transport = connection.transport.peek();
      const error = connection.error.peek();
      this.onStatus(label, `${connection.status.peek()}${transport ? ` via ${transport}` : ""}${error ? ` — ${error.message}` : ""}`);
    };
    show();
    this.disposers.push(connection.status.subscribe(show), connection.transport.subscribe(show), connection.error.subscribe(show));
  }

  stop() {
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const item of this.closers.splice(0)) {
      try { item.close(); } catch (err) { console.warn("[voice-probe] close", err); }
    }
  }
}

function randomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => "abcdefghjkmnpqrstuvwxyz23456789"[n % 31]).join("");
}

function renderRows(list, rows) {
  list.replaceChildren(...rows.map(([name, value]) => {
    const item = document.createElement("li");
    item.textContent = `${name}: ${value === true ? "sì" : value === false ? "NO" : value}`;
    if (value === false) item.className = "probe-missing";
    return item;
  }));
}

const form = document.getElementById("probe-form");
const codeInput = document.getElementById("probe-code");
const supportList = document.getElementById("probe-support");
const statusList = document.getElementById("probe-status");
const startButton = document.getElementById("probe-start");
const shareButton = document.getElementById("probe-share");

codeInput.value = new URLSearchParams(location.search).get("code") || randomCode();
new SupportReport().collect().then(async (rows) => {
  renderRows(supportList, rows);
  const loaded = await modules.then(() => true, (err) => `NO (${err.message})`);
  renderRows(supportList, [...rows, ["Libreria MoQ", loaded]]);
});

shareButton.addEventListener("click", async () => {
  const link = `${location.origin}${location.pathname}?code=${encodeURIComponent(codeInput.value.trim())}`;
  try {
    if (navigator.share) await navigator.share({ title: "Prova voce F1 Racer", url: link });
    else await navigator.clipboard.writeText(link);
  } catch (err) {
    console.warn("[voice-probe] share", err);
  }
});

let probe = null;
const status = new Map();
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (probe) {
    probe.stop();
    probe = null;
    startButton.textContent = "Avvia prova";
    return;
  }
  const data = new FormData(form);
  status.clear();
  probe = new MoqVoiceProbe({
    relay: data.get("relay"),
    code: codeInput.value.trim() || randomCode(),
    role: data.get("role"),
    echo: data.get("echo") === "on",
    onStatus(name, value) {
      status.set(name, value);
      renderRows(statusList, [...status]);
    },
  });
  startButton.textContent = "Ferma";
  // Started inside the tap so iOS allows the mic prompt and audio playback.
  probe.start().catch((err) => {
    status.set("Errore", err.message || String(err));
    renderRows(statusList, [...status]);
  });
});
