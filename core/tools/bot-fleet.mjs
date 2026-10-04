// Bot fleet (#244): one command to fill a room with browser bots on any
// machine (cloud sandbox or a player's PC). Strategy is the agent's job.
//
//   node core/tools/bot-fleet.mjs <roomServerUrl> <ROOM> [--count 5] [--dir DIR] [--gpu] [--headed] [--voice]
//
// It serves the repo on http://localhost:8080 (unless something already
// listens there), writes each bot's starting strategy.json and starts
// room-bot.mjs with --names. Every 10 s it
// prints each bot's botFps and position. Ctrl-C stops everything.
// --gpu / --headed / --voice are passed to room-bot.mjs (see there).
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
  console.error("usage: bot-fleet.mjs <roomServerUrl> <ROOM> [--count 5] [--dir DIR] [--gpu] [--headed] [--voice]");
  process.exit(1);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const DIR = path.resolve(opt("dir", path.join(os.tmpdir(), "f1-bots")));
const stamp = () => new Date().toISOString().slice(11, 19);

const count = Math.max(1, Math.min(11, Number(opt("count", 5)) || 5));
const bots = Array.from({ length: count }, (_, i) => ({ name: `claude-b${i + 1}`, dir: path.join(DIR, `claude-b${i + 1}`) }));

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

// --- Starting strategy ------------------------------------------------------
// No strategy logic here: the agent decides every bot's pace, stops, tyres
// and radio live by rewriting its strategy.json (read the race with
// bot-watch.mjs). autoPit:false turns off the driver's own wear-based box
// call, so every stop is the agent's.
fs.rmSync(DIR, { recursive: true, force: true });
for (const bot of bots) {
  fs.mkdirSync(bot.dir, { recursive: true });
  fs.writeFileSync(path.join(bot.dir, "strategy.json"), JSON.stringify({ pace: 0.86, ers: "auto", autoPit: false }));
}
const readState = (bot) => {
  try { return JSON.parse(fs.readFileSync(path.join(bot.dir, "state.json"), "utf8")); } catch { return null; }
};

setInterval(() => {
  bots.forEach((b) => { b.state = readState(b); });
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
  ...["--gpu", "--headed", "--voice"].filter((flag) => args.includes(flag)),
], { env, stdio: "inherit" });
console.log(stamp(), `[fleet] ${count} bots, files in ${DIR}`);

const stop = () => { child.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => { console.log(stamp(), `[fleet] room-bot exited (${code})`); process.exit(code ?? 1); });
