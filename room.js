import { createRoomClient } from "./room-client.js?v=1";
import { DRIVER_ROSTER } from "./driver-roster.js";
import { liveryById } from "./driver-themes.js?v=27";

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
  connectionStatus: document.getElementById("room-connection-status"),
  viewStatus: document.getElementById("room-view-status"),
  participantCount: document.getElementById("room-participant-count"),
  participantList: document.getElementById("room-participant-list"),
  driverGrid: document.getElementById("room-driver-grid"),
  readyCheckbox: document.getElementById("room-ready-checkbox"),
  startBtn: document.getElementById("room-start-btn"),
  raceStarted: document.getElementById("room-race-started"),
};

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
  el.startBtn.hidden = !isHost || !!room.startedAt;
  el.raceStarted.hidden = !room.startedAt;
}

client.onStateChange(renderRoom);
client.onConnectionChange((status) => {
  el.connectionStatus.textContent = status === "connected" ? "" : "Connessione al server della stanza persa.";
});

el.createBtn.addEventListener("click", async () => {
  el.entryStatus.textContent = "";
  el.createBtn.disabled = true;
  try {
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
client.tryResume().catch(() => {});
