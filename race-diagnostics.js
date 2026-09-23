// Dev-only performance diagnostics overlay (#2). Off by default and no DOM
// node is even created unless explicitly enabled — normal play never pays
// for or sees it, satisfying the issue's "niente pannello nella visuale di
// gioco normale" / "diagnostica disattivata per i giocatori" requirement.
//
// Enable with `?diag=1` (persists via localStorage so it survives the next
// navigation, e.g. from qualifying into the race); `?diag=0` clears it.
// Reads FPS/frame time (rolling half-second average) plus three.js's own
// `renderer.info` counters — draw calls, triangles, and the geometries/
// textures currently held in GPU memory — rather than reimplementing any
// of that measurement.

const STORAGE_KEY = "f1racer-diagnostics-enabled";

function resolveEnabled() {
  const flag = new URLSearchParams(location.search).get("diag");
  if (flag === "1") {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // storage unavailable — still enabled for this session.
    }
    return true;
  }
  if (flag === "0") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable — nothing to clear.
    }
    return false;
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setupDiagnosticsOverlay({ renderer, graphicsProfileId }) {
  if (!resolveEnabled()) {
    return { update() {} };
  }

  const el = document.createElement("pre");
  el.style.cssText =
    "position:fixed;top:4px;left:4px;z-index:9999;margin:0;" +
    "padding:6px 8px;background:rgba(0,0,0,0.6);color:#7CFC00;" +
    "font:11px/1.4 monospace;pointer-events:none;white-space:pre;" +
    "border-radius:4px;";
  document.body.appendChild(el);

  let frames = 0;
  let elapsed = 0;
  let fps = 0;
  let frameMs = 0;

  function update(dt) {
    frames++;
    elapsed += dt;
    if (elapsed >= 0.5) {
      fps = frames / elapsed;
      frameMs = (elapsed / frames) * 1000;
      frames = 0;
      elapsed = 0;
    }
    const info = renderer.info;
    el.textContent =
      `gfx:${graphicsProfileId}  FPS ${fps.toFixed(0)}  ${frameMs.toFixed(1)}ms\n` +
      `calls ${info.render.calls}  tris ${info.render.triangles}\n` +
      `geo ${info.memory.geometries}  tex ${info.memory.textures}`;
  }

  return { update };
}
