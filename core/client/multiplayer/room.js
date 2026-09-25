import { createRoomClient } from "./room-client.js?v=5";
import { DRIVER_ROSTER } from "../shared/driver-roster.js?v=1";
import { liveryById } from "../shared/driver-themes.js?v=27";
import { CIRCUITS } from "../shared/circuits.js?v=38";

const DIFFICULTY_LABELS = { facile: "Facile", normale: "Normale", difficile: "Difficile" };

const client = createRoomClient();

const el = {
  entry: document.getElementById("room-entry"),
  view: document.getElementById("room-view"),
  nickname: document.getElementById("room-nickname"),
  createBtn: document.getElementById("room-create-btn"),
  codeInput: document.getElementById("room-code-input"),
  joinBtn: document.getElementById("room-join-btn"),
  entryStatus: document.getElementById("room-entry-status"),
  codeDisplay: document.getElementById("room-code-display"),
  leaveBtn: document.getElementById("room-leave-btn"),
  shareBtn: document.getElementById("room-share-btn"),
  shareStatus: document.getElementById("room-share-status"),
  connectionStatus: document.getElementById("room-connection-status"),
  viewStatus: document.getElementById("room-view-status"),
  participantCount: document.getElementById("room-participant-count"),
  participantList: document.getElementById("room-participant-list"),
  driverGrid: document.getElementById("room-driver-grid"),
  readyCheckbox: document.getElementById("room-ready-checkbox"),
  startBtn: document.getElementById("room-start-btn"),
  raceStarted: document.getElementById("room-race-started"),
  circuitHost: document.getElementById("room-circuit-host"),
  circuitSelect: document.getElementById("room-circuit-select"),
  difficultySelect: document.getElementById("room-difficulty-select"),
  circuitDisplay: document.getElementById("room-circuit-display"),
};

el.circuitSelect.innerHTML += CIRCUITS.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");

let navigatedToRace = false;
// Set only when this page load actually rendered the lobby at least once —
// distinguishes "the race just started while I was sitting here" (auto-
// navigate, the whole point of this redirect) from "I landed on room.html
// with the room already mid-race" (e.g. the browser's back button after
// room.html already sent me to race.html once) — the latter must NOT
// immediately bounce the user right back into the race with no way to
// actually leave (bug reported by the user: desktop back button trapped
// inside the race).
let sawLobbyThisLoad = false;

function hex(color) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function driverLabel(driverId) {
  const driver = DRIVER_ROSTER.find((d) => d.id === driverId);
  return driver ? driver.name : driverId;
}

const CONNECTION_LABEL = { grace: "riconnessione…" };

function showView(inRoom) {
  el.entry.hidden = inRoom;
  el.view.hidden = !inRoom;
}

function renderRoom(room) {
  if (!room) {
    showView(false);
    return;
  }
  showView(true);
  el.codeDisplay.textContent = room.code;
  el.participantCount.textContent = `(${room.participants.length}/${room.maxParticipants})`;

  const me = room.participants.find((p) => p.participantId === client.participantId);
  const isHost = room.hostParticipantId === client.participantId;
  const takenDriverIds = new Set(
    room.participants.filter((p) => p.driverId && p.participantId !== client.participantId).map((p) => p.driverId)
  );

  el.participantList.innerHTML = room.participants
    .map((p) => `
      <li class="room-participant room-participant--${p.connectionState}">
        <span class="room-participant-name">${escapeHtml(p.nickname)}${p.participantId === room.hostParticipantId ? " 👑" : ""}</span>
        <span class="room-participant-driver">${p.driverId ? driverLabel(p.driverId) : "Nessun pilota"}</span>
        <span class="room-participant-ready">${p.ready ? "✅ pronto" : ""}</span>
        ${CONNECTION_LABEL[p.connectionState] ? `<span class="room-participant-state">${CONNECTION_LABEL[p.connectionState]}</span>` : ""}
      </li>
    `)
    .join("");

  el.driverGrid.innerHTML = DRIVER_ROSTER.map((driver) => {
    const taken = takenDriverIds.has(driver.id);
    const mine = me?.driverId === driver.id;
    const livery = liveryById(driver.team);
    return `
      <button type="button" class="room-driver-option${mine ? " active" : ""}" data-driver-id="${driver.id}" ${taken ? "disabled" : ""} aria-pressed="${mine}">
        <i style="--primary:${hex(livery.primary)}"></i>
        <strong>${driver.name}</strong>
        ${taken ? "<small>Occupato</small>" : ""}
      </button>
    `;
  }).join("");

  el.readyCheckbox.checked = !!me?.ready;

  const inLobby = room.sessionPhase === "lobby";
  el.circuitHost.hidden = !isHost || !inLobby;
  if (isHost && inLobby) {
    if (el.circuitSelect.value !== (room.circuitId || "")) el.circuitSelect.value = room.circuitId || "";
    if (el.difficultySelect.value !== room.difficulty) el.difficultySelect.value = room.difficulty;
  }
  const circuitName = room.circuitId ? (CIRCUITS.find((c) => c.id === room.circuitId)?.name || room.circuitId) : null;
  el.circuitDisplay.textContent = inLobby
    ? (circuitName ? `Circuito: ${circuitName} · ${DIFFICULTY_LABELS[room.difficulty]}` : (isHost ? "" : "In attesa che l'host scelga il circuito."))
    : (circuitName ? `Circuito: ${circuitName} · ${DIFFICULTY_LABELS[room.difficulty]}` : "");

  const allReady = room.participants.length > 0 && room.participants.every((p) => p.driverId && p.ready);
  el.startBtn.hidden = !isHost || !inLobby;
  el.startBtn.disabled = !room.circuitId || !allReady;

  if (inLobby) {
    sawLobbyThisLoad = true;
    el.raceStarted.hidden = true;
  } else if (room.sessionPhase === "qualifying" || room.sessionPhase === "racing") {
    const label = room.sessionPhase === "qualifying" ? "Qualifica" : "Gara";
    el.raceStarted.hidden = false;
    if (sawLobbyThisLoad) {
      el.raceStarted.textContent = `🏁 ${label} in corso — passa alla gara…`;
      goToRace(room);
    } else {
      el.raceStarted.innerHTML = `🏁 ${label} già in corso in questa stanza. <a href="#" id="room-rejoin-link">Rientra in gara</a>`;
    }
  }
}

// Navigates this tab into the actual race once the host starts the
// session (Stage 2, #44) — room-client's saved session lets race.html's
// multiplayer adapter reconnect as the same participant on load.
function goToRace(room) {
  if (navigatedToRace || !room.circuitId) return;
  navigatedToRace = true;
  const params = new URLSearchParams({ circuit: room.circuitId, difficulty: room.difficulty, room: room.code });
  const roomServer = new URLSearchParams(location.search).get("roomServer");
  if (roomServer) params.set("roomServer", roomServer);
  location.href = `race.html?${params.toString()}`;
}

el.raceStarted.addEventListener("click", (e) => {
  if (e.target.id !== "room-rejoin-link") return;
  e.preventDefault();
  if (client.room) goToRace(client.room);
});

// Invite link (#97): room.html?join=CODE, carrying the room server so a
// friend lands on the same server without typing anything.
const NICKNAME_KEY = "f1racer-room-nickname-v1";
const pageParams = new URLSearchParams(location.search);
const inviteCode = (pageParams.get("join") || "").trim().toUpperCase();
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalUrl(url) {
  try { return LOCAL_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

function inviteLink(code) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("join", code);
  const roomServer = pageParams.get("roomServer");
  if (roomServer) url.searchParams.set("roomServer", roomServer);
  return url.toString();
}

// Why a friend could not use this link, or "" when it looks reachable.
function inviteWarning() {
  if (LOCAL_HOSTS.has(location.hostname)) return "Attenzione: il link punta a questo computer (localhost), gli amici non lo aprono. Apri il gioco dal sito pubblico.";
  const roomServer = pageParams.get("roomServer");
  if (!roomServer || isLocalUrl(roomServer)) return "Attenzione: il server della stanza è locale, gli amici non lo raggiungono. Apri la pagina con ?roomServer=https://… (l'URL di ngrok).";
  return "";
}

try { el.nickname.value = localStorage.getItem(NICKNAME_KEY) || ""; } catch { /* storage unavailable */ }
function rememberNickname() {
  try { localStorage.setItem(NICKNAME_KEY, el.nickname.value.trim()); } catch { /* storage unavailable */ }
}

if (inviteCode) {
  el.codeInput.value = inviteCode;
  el.entryStatus.textContent = `Invito alla stanza ${inviteCode}: scrivi il tuo nome e premi Entra.`;
}

el.shareBtn.addEventListener("click", async () => {
  const room = client.room;
  if (!room) return;
  const link = inviteLink(room.code);
  const warning = inviteWarning();
  el.shareStatus.textContent = warning;
  if (navigator.share) {
    try {
      await navigator.share({ title: "F1 Racer", text: `Entra nella mia stanza ${room.code}`, url: link });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    el.shareStatus.textContent = `Link copiato. ${warning}`.trim();
  } catch {
    el.shareStatus.textContent = `${link} ${warning}`.trim();
  }
});

client.onStateChange(renderRoom);
client.onConnectionChange((status) => {
  el.connectionStatus.textContent = status === "connected" ? "" : "Connessione al server della stanza persa.";
});

el.createBtn.addEventListener("click", async () => {
  el.entryStatus.textContent = "";
  el.createBtn.disabled = true;
  try {
    rememberNickname();
    await client.createRoom(el.nickname.value);
  } catch (err) {
    el.entryStatus.textContent = err.message;
  } finally {
    el.createBtn.disabled = false;
  }
});

el.joinBtn.addEventListener("click", async () => {
  el.entryStatus.textContent = "";
  const code = el.codeInput.value.trim().toUpperCase();
  if (!code) {
    el.entryStatus.textContent = "Inserisci un codice stanza.";
    return;
  }
  el.joinBtn.disabled = true;
  try {
    rememberNickname();
    await client.joinRoom(code, el.nickname.value);
  } catch (err) {
    el.entryStatus.textContent = err.message;
  } finally {
    el.joinBtn.disabled = false;
  }
});

el.leaveBtn.addEventListener("click", () => client.leaveRoom());

el.driverGrid.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-driver-id]");
  if (!btn || btn.disabled) return;
  el.viewStatus.textContent = "";
  try {
    if (btn.classList.contains("active")) await client.releaseDriver();
    else await client.reserveDriver(btn.dataset.driverId);
  } catch (err) {
    el.viewStatus.textContent = err.message;
  }
});

el.readyCheckbox.addEventListener("change", () => {
  client.setReady(el.readyCheckbox.checked).catch((err) => { el.viewStatus.textContent = err.message; });
});

function submitCircuitChoice() {
  if (!el.circuitSelect.value) return;
  client.setCircuit(el.circuitSelect.value, el.difficultySelect.value).catch((err) => { el.viewStatus.textContent = err.message; });
}
el.circuitSelect.addEventListener("change", submitCircuitChoice);
el.difficultySelect.addEventListener("change", submitCircuitChoice);

el.startBtn.addEventListener("click", async () => {
  el.viewStatus.textContent = "";
  try {
    await client.startRace();
  } catch (err) {
    el.viewStatus.textContent = err.message;
  }
});

// Resume a session saved from a previous visit (e.g. a reload); a no-op if
// nothing was saved, so a first-time visitor never opens a connection
// before choosing to create or join.
// An invite to a different room wins over the saved one: leave it so the
// entry form (code prefilled) shows up.
client.tryResume()
  .then((room) => {
    if (room && inviteCode && room.code !== inviteCode) return client.leaveRoom();
  })
  .catch(() => {});
