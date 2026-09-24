export function setupRaceProgress({
  state,
  aiCars,
  allGridSlots,
  gridSlot,
  nearestTrackInfo,
  centerlineLength,
  finishProgress,
  lapsPerRace,
}) {
  let nextFinishPosition = 1;

  function advanceProgress(car, rawProgress) {
    const previousRaw = car.prevRawProgress;
    if (rawProgress > 0.42 && rawProgress < 0.58) car.lapCheckpointPassed = true;
    const previousToFinish = (previousRaw - finishProgress + 1) % 1;
    const currentToFinish = (rawProgress - finishProgress + 1) % 1;
    const crossedFinishForward = previousToFinish > 0.82 && currentToFinish < 0.18;
    let completedLap = false;
    if (crossedFinishForward && car.lapCheckpointPassed) {
      car.completedLaps = (car.completedLaps || 0) + 1;
      car.lap = car.completedLaps;
      car.lapCheckpointPassed = false;
      completedLap = true;
      if (car.completedLaps >= lapsPerRace && !car.finishPosition) {
        car.finishPosition = nextFinishPosition++;
      }
    }
    let delta = rawProgress - previousRaw;
    if (delta < -0.5) delta += 1;
    else if (delta > 0.5) delta -= 1;
    car.prevRawProgress = rawProgress;
    car.totalProgress += delta;
    car.tyreProgress = Math.max(0, (car.tyreProgress || 0) + delta);

    return completedLap;
  }

  function currentRaceOrder() {
    return [
      { driverId: "player", totalProgress: state.totalProgress, gridPosition: state.gridPosition },
      ...aiCars.map((car) => ({ driverId: car.driverId, totalProgress: car.totalProgress, gridPosition: car.gridPosition })),
    ].map((entry) => {
      const car = entry.driverId === "player"
        ? state
        : aiCars.find((candidate) => candidate.driverId === entry.driverId);
      return { ...entry, finishPosition: car.finishPosition || null };
    }).sort((a, b) => {
      if (a.finishPosition && b.finishPosition) return a.finishPosition - b.finishPosition;
      if (a.finishPosition) return -1;
      if (b.finishPosition) return 1;
      return b.totalProgress - a.totalProgress || a.gridPosition - b.gridPosition;
    });
  }

  function applyGridPositions(order) {
    nextFinishPosition = 1;
    order.forEach((driverId, index) => {
      const slot = allGridSlots[index];
      const pos = gridSlot(slot.row, slot.lane);
      const info = nearestTrackInfo(pos.x, pos.z);
      const car = driverId === "player" ? state : aiCars.find((entry) => entry.driverId === driverId);
      car.x = pos.x;
      car.z = pos.z;
      car.heading = pos.heading;
      car.speed = 0;
      car.lateralSpeed = 0;
      car.yawRate = 0;
      car.prevRawProgress = info.idx / centerlineLength;
      car.totalProgress = 0;
      car.tyreProgress = 0;
      car.lap = 0;
      car.completedLaps = 0;
      car.finishPosition = null;
      car.gridPosition = index + 1;
      car.lapCheckpointPassed = false;
      car.ersCharge = 100;
      car.ersActive = false;
      car.pitState = "none";
      car.pitServiceEndTime = 0;
    });
  }

  return { advanceProgress, applyGridPositions, currentRaceOrder };
}
