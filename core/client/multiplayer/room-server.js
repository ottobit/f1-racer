// Which room server a page talks to (#333). The public site (GitHub Pages)
// uses the hosted one (HOSTED_ROOM_SERVER: wherever deploy/ puts the
// server, today Render; see deploy/README.md); a page served from this
// computer uses the local server (npm run start:room-server). ?roomServer= overrides both and
// accepts what ngrok prints (https://...) or a bare host too (#99): http(s)
// maps to ws(s), no scheme means wss.
export const HOSTED_ROOM_SERVER = "wss://f1-racer-rooms.onrender.com";
const LOCAL_ROOM_SERVER = "ws://localhost:8787";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", ""]);

export function isLocalHost(hostname) {
  return LOCAL_HOSTS.has(hostname);
}

export function roomServerUrl(search = location.search) {
  const raw = (new URLSearchParams(search).get("roomServer") || "").trim();
  if (!raw) return isLocalHost(location.hostname) ? LOCAL_ROOM_SERVER : HOSTED_ROOM_SERVER;
  if (/^https:\/\//i.test(raw)) return raw.replace(/^https:/i, "wss:");
  if (/^http:\/\//i.test(raw)) return raw.replace(/^http:/i, "ws:");
  if (/^wss?:\/\//i.test(raw)) return raw;
  return `wss://${raw}`;
}

// A free hosting plan (Render's today) sleeps after 15 idle minutes and
// takes ~1 min to wake: a page that will need the server pings /health as soon as it
// opens, so the room is ready by the time the player creates or joins it.
export function wakeRoomServer() {
  const url = roomServerUrl().replace(/^ws/i, "http").replace(/\/+$/, "");
  try {
    fetch(`${url}/health`, { mode: "no-cors", cache: "no-store" }).catch(() => {});
  } catch {}
}
