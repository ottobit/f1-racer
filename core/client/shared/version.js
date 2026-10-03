// Release badge: shows the ?v of this script's own URL, which every HTML page
// sets to the number of the last merged cycle PR (never lower than before;
// see the concludi skill). If the badge shows an old number, the browser is
// still serving a cached copy of the page.
(() => {
  const script = document.currentScript;
  const version = script && new URL(script.src).searchParams.get("v");
  if (!version) return;
  const badge = document.createElement("div");
  badge.className = "app-version";
  badge.textContent = `v${version}`;
  badge.setAttribute("aria-label", `Versione ${version}`);
  Object.assign(badge.style, {
    position: "fixed",
    left: "50%",
    bottom: "calc(2px + env(safe-area-inset-bottom, 0px))",
    transform: "translateX(-50%)",
    font: "10px/1.2 system-ui, sans-serif",
    color: "#fff",
    opacity: "0.45",
    textShadow: "0 0 2px #000",
    pointerEvents: "none",
    userSelect: "none",
    zIndex: "2147483647",
  });
  const mount = () => document.body.appendChild(badge);
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
