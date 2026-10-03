#!/usr/bin/env node
// Keep-awake ping (#333): one GET to the room server's /health, then exit.
// Run it from the host's scheduler (a cron every 10 minutes) on plans that
// put an idle service to sleep. Provider-neutral, configured by env vars:
//   KEEP_AWAKE_URL     the server's public https://… address (required)
//   KEEP_AWAKE_WINDOW  "HH:MM-HH:MM", may cross midnight (default: all day)
//   KEEP_AWAKE_TZ      time zone of the window (default UTC)
// Outside the window it exits without calling, so the server may sleep; the
// window is checked here, in the given time zone, so a scheduler that only
// speaks UTC needs no daylight-saving edits.
const url = (process.env.KEEP_AWAKE_URL || "").replace(/\/+$/, "");
const windowText = process.env.KEEP_AWAKE_WINDOW || "00:00-24:00";
const timeZone = process.env.KEEP_AWAKE_TZ || "UTC";
// A sleeping free instance takes about a minute to answer.
const TIMEOUT_MS = 120_000;

function parseWindow(text) {
  const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, h1, m1, h2, m2] = match.map(Number);
  return { start: h1 * 60 + m1, end: h2 * 60 + m2 };
}

function minutesIn(zone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  return value("hour") * 60 + value("minute");
}

function insideWindow(now, { start, end }) {
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

const window = parseWindow(windowText);
if (!url || !window) {
  console.error(`[keep-awake] need KEEP_AWAKE_URL and KEEP_AWAKE_WINDOW as HH:MM-HH:MM (got "${url}", "${windowText}")`);
  process.exit(1);
}
if (!insideWindow(minutesIn(timeZone), window)) {
  console.log(`[keep-awake] outside ${windowText} ${timeZone}, not pinging`);
  process.exit(0);
}
try {
  const started = Date.now();
  const res = await fetch(`${url}/health`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  console.log(`[keep-awake] ${url}/health -> ${res.status} in ${Date.now() - started} ms`);
  process.exit(res.ok ? 0 : 1);
} catch (err) {
  console.error(`[keep-awake] ${url}/health failed: ${err.message}`);
  process.exit(1);
}
