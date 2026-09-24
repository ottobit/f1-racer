export function setupRaceCommands({ state, tyreCompounds, getRaceState }) {
  function setTyreCompound(name) {
    if (!tyreCompounds[name]) return;
    if (getRaceState() === "racing" && state.pitState !== "servicing") return;
    state.tyreCompound = name;
  }

  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyE" && getRaceState() === "racing" && state.pitState === "none") {
      state.ersActive = !state.ersActive;
    }
    if (event.code === "KeyP" && getRaceState() === "racing") {
      state.pitRequested = true;
    }
    if (event.code === "Digit1") setTyreCompound("soft");
    if (event.code === "Digit2") setTyreCompound("medium");
    if (event.code === "Digit3") setTyreCompound("hard");
  });

  return { setTyreCompound };
}
