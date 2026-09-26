// Room bot (#7): joins a multiplayer room like any participant (same
// protocol), reserves a free driver, readies up and races with
// ?driver=layered. Strategy comes from a JSON file: every change to it is
// passed to window._DRIVER_.setStrategy (pace, line, ers, tyre, pit, radio);
// the car state is written back next to it every 2 s.
//
//   node core/tools/room-bot.mjs <roomServerUrl> <ROOM> [--name Claude] [--dir /tmp/bot]
//
// Needs Playwright (global install is fine) and a static server for the repo
// on http://localhost:8080 (e.g. `python3 -m http.server 8080` at the root).
// Behind an HTTPS-only egress proxy (HTTPS_PROXY set, as in cloud sandboxes)
// the WebSocket goes through a local relay on :8081 and three.js is served
// from core/node_modules, since the browser can't reach them directly.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import tls from "node:tls";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const [serverUrl, code] = args;
if (!serverUrl || !code) {
  console.error("usage: room-bot.mjs <roomServerUrl> <ROOM> [--name Claude] [--dir DIR]");
  process.exit(1);
}
const NAME = opt("name", "Claude");
const DIR = opt("dir", process.cwd());
const STRATEGY_FILE = path.join(DIR, "strategy.json");
const STATE_FILE = path.join(DIR, "state.json");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const proxy = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// --- WebSocket relay (proxied sandboxes only) ------------------------------
function startRelay(target) {
  const host = new URL(target).host;
  const ca = process.env.NODE_EXTRA_CA_CERTS ? fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS) : undefined;
  const tunnel = () => new Promise((resolve, reject) => {
    const req = http.request({ host: proxy.hostname, port: proxy.port, method: "CONNECT", path: `${host}:443` });
    req.on("connect", (res, sock) => {
      if (res.statusCode !== 200) return reject(new Error(`CONNECT ${res.statusCode}`));
      sock.setNoDelay(true); // no Nagle batching of the ~12/s car_state frames (#186)
      resolve(tls.connect({ socket: sock, servername: host, ca, ALPNProtocols: ["http/1.1"] }));
    });
    req.on("error", reject);
    req.end();
  });
  const wss = new WebSocketServer({ port: 8081 });
  wss.on("connection", async (down) => {
    const queue = [];
    let up = null;
    down.on("message", (d, binary) => (up?.readyState === 1 ? up.send(d, { binary }) : queue.push([d, binary])));
    try {
      const sock = await tunnel();
      up = new WebSocket(`wss://${host}/`, { createConnection: () => sock });
    } catch (err) {
      log("relay tunnel failed", err.message);
      down.close();
      return;
    }
    up.on("open", () => queue.splice(0).forEach(([d, binary]) => up.send(d, { binary })));
    up.on("message", (d, binary) => down.readyState === 1 && down.send(d, { binary }));
    up.on("close", () => down.close());
    up.on("error", (err) => { log("relay upstream", err.message); down.close(); });
    down.on("close", () => up.close());
  });
  return "ws://localhost:8081";
}

const roomServer = proxy ? startRelay(serverUrl) : serverUrl;
const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    ...(proxy ? [`--proxy-server=${proxy.origin}`, "--proxy-bypass-list=localhost;127.0.0.1", "--ignore-certificate-errors"] : []),
  ],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: !!proxy, permissions: ["microphone"] });
if (proxy) {
  await ctx.route("https://cdn.jsdelivr.net/npm/three@*/**", (route) => route.fulfill({
    path: path.join(REPO, "core/node_modules/three", new URL(route.request().url()).pathname.replace(/^\/npm\/three@[^/]+\//, "")),
    contentType: "text/javascript",
  }));
}
const page = await ctx.newPage();
page.on("pageerror", (err) => log("pageerror", err.message));
let lastStrategy = "";
let freshPage = false;
page.on("framenavigated", (frame) => {
  if (frame !== page.mainFrame()) return;
  const url = new URL(frame.url());
  log("page", url.pathname);
  // A new page starts without targets: resend them, minus the one-shot
  // box call and radio message that belonged to the previous race (#184).
  lastStrategy = "";
  freshPage = true;
  // The room page sends everyone to race.html; the bot needs its driver.
  if (url.pathname.endsWith("race.html") && !url.searchParams.has("driver")) {
    url.searchParams.set("driver", "layered");
    page.goto(url.href).catch((err) => log("goto", err.message));
  }
});

await page.goto(`http://localhost:8080/room.html?join=${code}&roomServer=${encodeURIComponent(roomServer)}`);
await page.fill("#room-nickname", NAME);

let lastJoinTry = 0;
let lastStateAt = 0;
let lastStatus = "";
for (;;) {
  try {
    const url = page.url();
    if (url.includes("room.html")) {
      const entryVisible = await page.$eval("#room-entry", (e) => !e.hidden).catch(() => false);
      const status = await page.$eval("#room-entry-status", (e) => e.textContent.trim()).catch(() => "");
      if (status !== lastStatus) { lastStatus = status; if (status) log("room", status); }
      if (entryVisible && Date.now() - lastJoinTry > 15000) {
        lastJoinTry = Date.now();
        await page.fill("#room-code-input", code);
        await page.click("#room-join-btn");
      }
      if (!entryVisible && !(await page.$("#room-driver-grid [data-driver-id].active"))) {
        const free = await page.$("#room-driver-grid [data-driver-id]:not([disabled])");
        if (free) { await free.click(); log("reserved", await free.getAttribute("data-driver-id")); }
      }
      const ready = await page.$("#room-ready-checkbox");
      if (!entryVisible && ready && !(await ready.isChecked())) await ready.check();
    } else if (await page.evaluate(() => !!window._DRIVER_).catch(() => false)) {
      const raw = fs.existsSync(STRATEGY_FILE) ? fs.readFileSync(STRATEGY_FILE, "utf8") : "";
      if (raw && raw !== lastStrategy) {
        lastStrategy = raw;
        try {
          const update = JSON.parse(raw);
          if (freshPage) { delete update.pit; delete update.radio; }
          freshPage = false;
          await page.evaluate((u) => window._DRIVER_.setStrategy(u), update);
          log("strategy", raw.trim());
        } catch (err) { log("bad strategy.json", err.message); }
      }
      if (Date.now() - lastStateAt > 2000) {
        lastStateAt = Date.now();
        const state = await page.evaluate(() => ({ ...window._DRIVER_.getState(), targets: window._DRIVER_.getTargets() }));
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
      }
    }
  } catch (err) {
    log("loop", err.message);
  }
  await page.waitForTimeout(500);
}
