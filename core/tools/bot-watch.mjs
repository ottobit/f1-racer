// Bot watch (#244): the agent's eyes during a race. Waits until something
// worth a decision happens to any bot (phase, lap, pit state or call, safety car,
// wear crossing 50/70/85%, damage +10%) or --timeout seconds pass, then
// prints one compact line per bot and exits. It decides nothing: the agent
// reads the lines and writes each bot's strategy.json itself.
//
//   node core/tools/bot-watch.mjs [DIR] [--timeout 20]
//
// DIR is the fleet directory (default <tmp>/f1-bots), one subdir per bot.
// Per bot: pace is the applied one, followed by the driver's tactical mode
// (cruise/attack/traffic/defend/preserve/wet/caution) that explains a gap from the
// requested pace; "pit none armed" means a box call is already pending.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const ti = args.indexOf("--timeout");
const timeoutS = ti >= 0 ? Number(args[ti + 1]) || 20 : 20;
const DIR = path.resolve(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--timeout") || path.join(os.tmpdir(), "f1-bots"));

const bots = () => fs.readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const read = (name) => {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, name, "state.json"), "utf8")); } catch { return null; }
};
const band = (w) => (w >= 85 ? 3 : w >= 70 ? 2 : w >= 50 ? 1 : 0);
// The parts of a bot's state whose change deserves a decision.
const key = (st) => st && [st.session?.phase, st.session?.state, st.lap, st.pit?.state, !!st.pit?.requested, !!st.safetyCar,
  band(st.tyreWearPct || 0), Math.floor((st.damagePct || 0) / 10)].join("|");

const start = bots().map((n) => key(read(n))).join("#");
const deadline = Date.now() + timeoutS * 1000;
let reason = "timeout";
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 1000));
  if (bots().map((n) => key(read(n))).join("#") !== start) { reason = "event"; break; }
}

const gap = (s) => (typeof s === "number" ? s.toFixed(1) : "-");
const first = bots().map(read).find(Boolean);
console.log(`[${reason}] ${first?.session?.phase ?? "-"}/${first?.session?.state ?? "-"} lap ${first?.lap ?? "-"}/${first?.lapsTotal ?? "-"}` +
  `${first?.safetyCar ? " SC" : ""}${first?.weather ? ` ${typeof first.weather === "string" ? first.weather : first.weather.state ?? ""}` : ""}`);
for (const name of bots()) {
  const st = read(name);
  if (!st) { console.log(`${name}: no state`); continue; }
  if (st.session?.phase === "room") {
    // Back in the room (#246): the last race, never a live-looking snapshot.
    const r = st.lastRace;
    console.log(`${name}: room/${st.session.state} last race ${r ? `${r.session?.state} P${r.position ?? "-"} lap ${r.lap}/${r.lapsTotal}` : "-"}`);
    continue;
  }
  const t = st.targets?.effective || st.targets || {};
  // "armed" = box call pending, not yet at the pit entry: don't call it again (#246).
  const pit = `${st.pit?.state ?? "-"}${st.pit?.requested ? " armed" : ""}`;
  console.log(`${name}: P${st.position ?? "-"} lap ${st.lap}/${st.lapsTotal} ${st.tyreCompound ?? "-"} ${Math.round(st.tyreWearPct ?? 0)}%` +
    ` dmg ${Math.round(st.damagePct ?? 0)}% ers ${Math.round(st.ers?.chargePct ?? 0)}% gap +${gap(st.gapAheadS)}/-${gap(st.gapBehindS)}` +
    ` pit ${pit} pace ${t.pace ?? "-"} ${st.targets?.mode ?? "-"} best ${st.lapTimes?.bestMs ?? "-"} fps ${st.botFps ?? "-"}`);
}
