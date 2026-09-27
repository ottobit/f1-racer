// Bot fleet (#244): one command to fill a room with browser bots, each with
// its own strategy, on any machine (cloud sandbox or a player's PC).
//
//   node core/tools/bot-fleet.mjs <roomServerUrl> <ROOM> [--count 5] [--dir DIR] [--gpu] [--headed]
//
// It serves the repo on http://localhost:8080 (unless something already
// listens there), writes each bot's starting strategy, runs the strategy
// loops in this process and starts room-bot.mjs with --names. Every 10 s it
// prints each bot's botFps and position. Ctrl-C stops everything.
// --gpu / --headed are passed to room-bot.mjs (see there).
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const [serverUrl, code] = args;
if (!serverUrl || !code) {
  console.error("usage: bot-fleet.mjs <roomServerUrl> <ROOM> [--count 5] [--dir DIR] [--gpu] [--headed]");
  process.exit(1);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const DIR = path.resolve(opt("dir", path.join(os.tmpdir(), "f1-bots")));
const stamp = () => new Date().toISOString().slice(11, 19);

// Strategy mix: [pace, box at tyre wear % (0 = no stop), compound fitted].
// The first 5 are the 3WK4 baseline (#239), so runs with --count 5 compare.
const MIX = [
  [0.93, 60, "soft"], [0.90, 0, "hard"], [0.88, 50, "soft"], [0.84, 70, "medium"], [0.80, 0, "hard"],
  [0.92, 75, "hard"], [0.86, 0, "hard"], [0.94, 0, "hard"], [0.95, 75, "hard"], [0.96, 80, "medium"], [0.88, 75, "medium"],
];
const count = Math.max(1, Math.min(MIX.length, Number(opt("count", 5)) || 5));
const bots = MIX.slice(0, count).map(([pace, pitWear, tyre], i) => ({
  name: `claude-b${i + 1}`, pace, pitWear, tyre, dir: path.join(DIR, `claude-b${i + 1}`),
}));

// --- Static server on :8080 -------------------------------------------------
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
};
const staticServer = http.createServer((req, res) => {
  const file = path.join(REPO, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(REPO)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(data);
  });
});
staticServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") console.log(stamp(), ":8080 already serving, reusing it");
  else console.log(stamp(), "static", err.message);
});
staticServer.listen(8080);

// --- Strategy loops ---------------------------------------------------------
// Same logic as the cloud play sessions: fixed pace, ERS auto (off under
// safety car), one box call at the chosen wear, radio on each decision.
fs.rmSync(DIR, { recursive: true, force: true });
for (const bot of bots) {
  fs.mkdirSync(bot.dir, { recursive: true });
  fs.writeFileSync(path.join(bot.dir, "strategy.json"), JSON.stringify({ pace: bot.pace, ers: "auto" }));
  Object.assign(bot, { pitted: false, announced: false, lastSc: false, last: "", state: null });
}

function readState(bot) {
  try { return JSON.parse(fs.readFileSync(path.join(bot.dir, "state.json"), "utf8")); } catch { return null; }
}

function steer(bot) {
  const st = readState(bot);
  bot.state = st;
  if (!st) return;
  const phase = st.session?.state;
  if (phase !== "racing") {
    if (phase !== "finished") { bot.pitted = false; bot.announced = false; }
    return;
  }
  const out = { pace: st.damagePct > 40 ? bot.pace - 0.07 : bot.pace, ers: st.safetyCar ? false : "auto" };
  let radio = null;
  if (!bot.announced) {
    bot.announced = true;
    radio = bot.pitWear
      ? `${bot.name}: ritmo ${bot.pace}, ERS auto, box a ${bot.pitWear}% usura per ${bot.tyre}`
      : `${bot.name}: ritmo ${bot.pace}, ERS auto, nessuna sosta`;
  }
  if (!!st.safetyCar !== bot.lastSc) {
    bot.lastSc = !!st.safetyCar;
    if (bot.lastSc) radio = `${bot.name}: safety car, ERS spento, carico batteria`;
  }
  if (bot.pitWear && !bot.pitted && st.tyreWearPct >= bot.pitWear && st.lapsTotal - st.lap >= 1) {
    out.pit = true;
    out.tyre = bot.tyre;
    bot.pitted = true;
    radio = `${bot.name}: box questo giro, monto ${bot.tyre} (usura ${Math.round(st.tyreWearPct)}%)`;
  }
  if (radio) out.radio = radio.slice(0, 80);
  const raw = JSON.stringify(out);
  if (raw !== bot.last) { fs.writeFileSync(path.join(bot.dir, "strategy.json"), raw); bot.last = raw; }
}

setInterval(() => bots.forEach(steer), 4000);
setInterval(() => {
  const parts = bots.map((b) => `${b.name.replace("claude-", "")} ${b.state?.botFps ?? "-"}fps P${b.state?.position ?? "-"}`);
  const phase = bots.find((b) => b.state)?.state?.session?.state || "waiting";
  console.log(stamp(), `[fleet] ${phase} | ${parts.join(" | ")}`);
}, 10000);

// --- room-bot.mjs -------------------------------------------------------------
// Playwright is usually a global install: find it once so users don't have to.
const env = { ...process.env };
if (!env.PLAYWRIGHT_PATH) {
  try { createRequire(import.meta.url).resolve("playwright"); } catch {
    try { env.PLAYWRIGHT_PATH = path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"); } catch {}
  }
}
const child = spawn(process.execPath, [
  path.join(HERE, "room-bot.mjs"), serverUrl, code,
  "--names", bots.map((b) => b.name).join(","), "--dir", DIR,
  ...["--gpu", "--headed"].filter((flag) => args.includes(flag)),
], { env, stdio: "inherit" });
console.log(stamp(), `[fleet] ${count} bots, files in ${DIR}`);

const stop = () => { child.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => { console.log(stamp(), `[fleet] room-bot exited (${code})`); process.exit(code ?? 1); });
