export function formatTime(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}

export function setupRaceHud({
  circuitLabel,
  lapsPerRace,
  tyreCompounds,
  carMaxSpeed,
  state,
  aiCars,
  tireGripFactor,
  gearInfo,
  currentRaceOrder,
  nameOf,
  updateEngineSound,
  playShiftClick,
  updateAmbientChorus,
  qualifyingRivals,
  getQualifyingRivals,
  isDisconnected = () => false,
  getRaceState = () => "racing",
}) {
  // Solo play passes a static qualifyingRivals array (synthesized once);
  // multiplayer (#44) passes getQualifyingRivals instead, since live
  // participant times change over the session — this normalizes both to a
  // getter so the rest of this module only ever calls one.
  const readQualifyingRivals = getQualifyingRivals || (() => qualifyingRivals);
  const circuitNameEl = document.getElementById("circuit-name");
  const positionEl = document.getElementById("position");
  const lapEl = document.getElementById("lap");
  const timeEl = document.getElementById("time");
  const bestEl = document.getElementById("best");
  const cautionBannerEl = document.getElementById("caution-banner");
  const qualifyingTimingEl = document.getElementById("qualifying-timing");
  const damageRowEl = document.getElementById("damage-row");
  const damageEl = document.getElementById("damage");
  const tireWearEl = document.getElementById("tire-wear");
  const speedValueEl = document.getElementById("speed-value");
  const speedFillEl = document.getElementById("speed-fill");
  const gearValueEl = document.getElementById("gear-value");
  const drsIndicatorEl = document.getElementById("drs-indicator");
  const ersIndicatorEl = document.getElementById("ers-indicator");
  const pitToggleEl = document.getElementById("pit-toggle");
  const rootClasses = document.documentElement.classList;
  const tyreCompoundEl = document.getElementById("tyre-compound");
  const slipValueEl = document.getElementById("slip-value");
  const lateralValueEl = document.getElementById("lateral-value");
  const shiftLedEls = Array.from(document.querySelectorAll(".shift-led"));
  const hintEl = document.getElementById("hint");
  const penaltyNoticeEl = document.getElementById("penalty-notice");
  const raceHintText = hintEl.textContent;
  const kmhPerUnit = 3.6;
  const gaugeMaxKmh = 300;
  let lastGearLabel = null;
  let lastQualifyingTowerTime;
  let lastRaceTowerSignature = "";
  let gearFlashTimeout = null;
  let penaltyNoticeTimeout = null;

  circuitNameEl.textContent = circuitLabel();
  hintEl.textContent = "Giro di qualifica: fai il miglior tempo per partire davanti in griglia";

  function setRaceLabel() {
    circuitNameEl.textContent = circuitLabel();
    hintEl.textContent = raceHintText;
    lastRaceTowerSignature = "";
    updateRaceTiming(currentRaceOrder());
  }

  function updateQualifyingTiming(qualiBestTime) {
    const classification = [
      { id: "player", name: "TU", time: qualiBestTime ?? Infinity },
      ...readQualifyingRivals(),
    ].sort((a, b) => a.time - b.time);
    const playerPosition = classification.findIndex((entry) => entry.id === "player") + 1;
    const signature = classification.map((e) => `${e.id}:${e.time}`).join("|");
    if (lastQualifyingTowerTime === signature) return playerPosition;
    lastQualifyingTowerTime = signature;

    qualifyingTimingEl.innerHTML = `
      <div class="qualifying-timing__title">TEMPI</div>
      <ol>${classification.map((entry, index) => `
        <li class="${entry.id === "player" ? "is-player" : ""}${entry.id !== "player" && isDisconnected(entry.id) ? " is-disconnected" : ""}">
          <span class="qualifying-timing__position">${index + 1}</span>
          <span class="qualifying-timing__name">${entry.name}</span>
          <strong>${Number.isFinite(entry.time) ? formatTime(entry.time) : "--:--.--"}</strong>
        </li>`).join("")}</ol>`;
    qualifyingTimingEl.hidden = false;
    return playerPosition;
  }

  function updateRaceTiming(order) {
    const signature = order
      .map((entry) => `${entry.driverId}:${Math.floor(entry.totalProgress)}:${isDisconnected(entry.driverId)}`)
      .join("|");
    if (signature === lastRaceTowerSignature) return;
    lastRaceTowerSignature = signature;
    qualifyingTimingEl.innerHTML = `
      <div class="qualifying-timing__title">CLASSIFICA GARA</div>
      <ol>${order.map((entry, index) => `
        <li class="${entry.driverId === "player" ? "is-player" : ""}${entry.driverId !== "player" && isDisconnected(entry.driverId) ? " is-disconnected" : ""}">
          <span class="qualifying-timing__position">${index + 1}</span>
          <span class="qualifying-timing__name">${entry.driverId === "player" ? "TU" : nameOf(entry.driverId)}</span>
          <strong>G${Math.min(Math.floor(entry.totalProgress) + 1, lapsPerRace)}</strong>
        </li>`).join("")}</ol>`;
    qualifyingTimingEl.hidden = false;
  }

  function setCautionVisible(isVisible) {
    cautionBannerEl.hidden = !isVisible;
  }

  function showPenaltyNotice(penaltyMs) {
    penaltyNoticeEl.textContent = `Track limits — +${(penaltyMs / 1000).toFixed(1)}s`;
    clearTimeout(penaltyNoticeTimeout);
    penaltyNoticeEl.classList.add("visible");
    penaltyNoticeTimeout = setTimeout(() => penaltyNoticeEl.classList.remove("visible"), 2500);
  }

  function updateSpeedoHud() {
    const speedKmh = Math.abs(state.speed) * kmhPerUnit;
    speedValueEl.textContent = Math.round(speedKmh);

    const gaugeRatio = Math.min(speedKmh / gaugeMaxKmh, 1);
    speedFillEl.style.width = `${gaugeRatio * 100}%`;

    drsIndicatorEl.classList.toggle("drs-active", state.drsActive);
    const gripPercent = Math.round(tireGripFactor(state.totalProgress, state) * 100);
    if (ersIndicatorEl) {
      ersIndicatorEl.textContent = `ERS ${Math.round(state.ersCharge)}%`;
      ersIndicatorEl.classList.toggle("ers-active", state.ersActive);
    }
    // Phone shortcuts (#135): ERS/BOX dim outside the race, BOX lights up
    // while the call is armed, S/M/H show during the stop.
    rootClasses.toggle("hud-not-racing", getRaceState() !== "racing");
    rootClasses.toggle("pit-servicing", state.pitState === "servicing");
    pitToggleEl?.classList.toggle("pit-armed", state.pitRequested);
    if (tyreCompoundEl) {
      tyreCompoundEl.textContent = tyreCompounds[state.tyreCompound].label;
      tyreCompoundEl.dataset.compound = state.tyreCompound;
    }
    const lateralLimit = Math.max(Math.abs(state.speed) * 0.32, 1);
    const slipPercent = Math.round(
      Math.min(Math.abs(state.lateralSpeed) / lateralLimit, 1) * 100
    );
    tireWearEl.textContent = `Gomme ${gripPercent}%`;
    if (slipValueEl) slipValueEl.textContent = `${slipPercent}%`;
    if (lateralValueEl) {
      lateralValueEl.textContent = `${Math.round(Math.abs(state.lateralSpeed) * kmhPerUnit)} km/h`;
    }
    damageRowEl.hidden = state.damage <= 0;
    damageEl.textContent = `Danni ${Math.round(state.damage * 100)}%`;

    const { gear, rpmRatio } = gearInfo(Math.abs(state.speed) / carMaxSpeed);
    const gearLabel = Math.abs(state.speed) < 0.6 ? "N" : state.speed < 0 ? "R" : String(gear);
    if (gearLabel !== lastGearLabel) {
      gearValueEl.textContent = gearLabel;
      if (lastGearLabel !== null) {
        clearTimeout(gearFlashTimeout);
        gearValueEl.classList.remove("gear-shift");
        void gearValueEl.offsetWidth;
        gearValueEl.classList.add("gear-shift");
        gearFlashTimeout = setTimeout(() => gearValueEl.classList.remove("gear-shift"), 220);
        playShiftClick();
      }
      lastGearLabel = gearLabel;
    }

    const litCount = Math.round(rpmRatio * shiftLedEls.length);
    shiftLedEls.forEach((led, index) => led.classList.toggle("is-lit", index < litCount));

    updateEngineSound(Math.abs(state.speed) / carMaxSpeed, rpmRatio);
    updateAmbientChorus(aiCars, state);
  }

  function updateHud() {
    const order = currentRaceOrder();
    const position = order.findIndex((entry) => entry.driverId === "player") + 1;
    updateRaceTiming(order);
    positionEl.textContent = `P${position}`;
    lapEl.textContent = `Giro ${Math.min(state.lap + 1, lapsPerRace)}/${lapsPerRace}`;
    timeEl.textContent = formatTime(state.currentLapTime);
    bestEl.textContent = state.bestLapTime
      ? `Migliore ${formatTime(state.bestLapTime)}`
      : "Migliore --:--.--";
    updateSpeedoHud();
  }

  function updateQualifyingHud(qualiTimeRemainingMs, qualiBestTime) {
    positionEl.textContent = "Q";
    const remainingSeconds = Math.max(0, Math.ceil(qualiTimeRemainingMs / 1000));
    lapEl.textContent = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`;
    timeEl.textContent = formatTime(state.currentLapTime);
    const qualifyingPosition = updateQualifyingTiming(qualiBestTime);
    bestEl.textContent = qualiBestTime !== null
      ? `P${qualifyingPosition} · ${formatTime(qualiBestTime)}`
      : "P10 · --:--.--";
    updateSpeedoHud();
  }

  return {
    setCautionVisible,
    setRaceLabel,
    showPenaltyNotice,
    updateHud,
    updateQualifyingHud,
  };
}
