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
  updateEngineSound,
  playShiftClick,
  minimapCanvasSize,
  minimapTrackPoints,
  minimapPoint,
}) {
  const circuitNameEl = document.getElementById("circuit-name");
  const positionEl = document.getElementById("position");
  const lapEl = document.getElementById("lap");
  const timeEl = document.getElementById("time");
  const bestEl = document.getElementById("best");
  const cautionBannerEl = document.getElementById("caution-banner");
  const damageRowEl = document.getElementById("damage-row");
  const damageEl = document.getElementById("damage");
  const tireWearEl = document.getElementById("tire-wear");
  const speedValueEl = document.getElementById("speed-value");
  const speedFillEl = document.getElementById("speed-fill");
  const gearValueEl = document.getElementById("gear-value");
  const drsIndicatorEl = document.getElementById("drs-indicator");
  const ersIndicatorEl = document.getElementById("ers-indicator");
  const tyreCompoundEl = document.getElementById("tyre-compound");
  const slipValueEl = document.getElementById("slip-value");
  const lateralValueEl = document.getElementById("lateral-value");
  const shiftLedEls = Array.from(document.querySelectorAll(".shift-led"));
  const hintEl = document.getElementById("hint");
  const penaltyNoticeEl = document.getElementById("penalty-notice");
  const minimapCtx = document.getElementById("minimap").getContext("2d");
  const raceHintText = hintEl.textContent;
  const kmhPerUnit = 3.6;
  const gaugeMaxKmh = 300;
  let lastGearLabel = null;
  let gearFlashTimeout = null;
  let penaltyNoticeTimeout = null;

  circuitNameEl.textContent = `${circuitLabel()} · Qualifica`;
  hintEl.textContent = "Giro di qualifica: fai il miglior tempo per partire davanti in griglia";

  function setRaceLabel() {
    circuitNameEl.textContent = circuitLabel();
    hintEl.textContent = raceHintText;
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

  function drawMinimap() {
    const ctx = minimapCtx;
    ctx.clearRect(0, 0, minimapCanvasSize, minimapCanvasSize);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    minimapTrackPoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.stroke();

    const drawDot = (x, z, fillStyle, radius) => {
      const point = minimapPoint(x, z);
      ctx.fillStyle = fillStyle;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    };

    for (const car of aiCars) {
      drawDot(car.x, car.z, `#${car.color.toString(16).padStart(6, "0")}`, 2.5);
    }
    const playerPoint = minimapPoint(state.x, state.z);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(playerPoint.x, playerPoint.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
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
    drawMinimap();
  }

  function updateHud() {
    const order = currentRaceOrder();
    const position = order.findIndex((entry) => entry.driverId === "player") + 1;
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
    bestEl.textContent = qualiBestTime !== null
      ? `Migliore ${formatTime(qualiBestTime)}`
      : "Migliore --:--.--";
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
