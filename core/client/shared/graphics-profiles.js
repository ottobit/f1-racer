// Automatic, persisted graphics profile selection (#2). Scales rendering
// cost — device pixel ratio, shadows, rain/cloud particle counts — without
// touching physics, collision or track-limit constants: CAR/AI tuning,
// TRACK_WIDTH, GRASS_LIMIT/WALL_LIMIT and every other gameplay-visible
// distance stay exactly as authored regardless of profile.
//
// No new UI: this is deliberately invisible in normal play, same spirit as
// the diagnostics overlay (see race-diagnostics.js) and the existing
// `?agent=1` opt-in pattern. Auto-detects a sensible default from cheap,
// synchronous device signals; a `?gfx=low|medium|high` URL override exists
// for testing and is persisted once used. Covers the DPR/shadow/effects
// levers with the clearest performance-per-risk payoff; distant-scenery
// density and reflections are a deliberate follow-up, not done here (see
// .knowledge/wiki/synthesis/roadmap.md).

const STORAGE_KEY = "f1racer-graphics-profile-v1";

export const GRAPHICS_PROFILES = {
  low: {
    label: "Basso",
    dprCap: 1,
    antialias: true,
    shadowsEnabled: false,
    shadowMapSize: 512,
    rainParticleMultiplier: 0.35,
    cloudCountMultiplier: 0.5,
  },
  medium: {
    label: "Medio",
    dprCap: 1.5,
    antialias: true,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    rainParticleMultiplier: 0.7,
    cloudCountMultiplier: 0.75,
  },
  high: {
    label: "Alto",
    dprCap: 2,
    antialias: true,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    rainParticleMultiplier: 1,
    cloudCountMultiplier: 1,
  },
};

// Cheap, synchronous-only heuristic — no benchmarking pass, just signals
// already on `navigator`/`window`. A coarse pointer (touch) is the primary
// mobile signal. Phones start on "medium" and drop to "low" only on real
// weak-device signals: little RAM (`deviceMemory`, Chromium only) or few
// cores. DPR is not used (#167): every recent iPhone has DPR 3 and an
// iPhone 17 holds the 60 fps cap even on "high".
const IS_COARSE_POINTER = matchMedia("(pointer: coarse)").matches;

function detectDefaultProfileId() {
  const cores = navigator.hardwareConcurrency || 4;
  if (!IS_COARSE_POINTER) return cores >= 8 ? "high" : "medium";
  const memoryGb = navigator.deviceMemory;
  if ((memoryGb && memoryGb <= 4) || cores < 4) return "low";
  return "medium";
}

// Touch-device extras applied on top of any profile (#159): hard-edged PCF
// shadows instead of the soft variant, and a frame cap so 90/120 Hz phone
// screens don't render (and heat up) twice as often for no gameplay gain.
// Phones also cap the pixel ratio at 1.25 (#355): ~30% fewer pixels than
// 1.5 — the GPU fill work that heats a phone most — at a full 60 fps — and
// shade matte surfaces and rival cars with cheaper materials (#357, see
// lite-materials.js).
// The cap is 30 fps since #385: the phone still heated in multiplayer with
// voices at 60. 30 divides 60 and 120 Hz evenly (no judder), physics runs
// in fixed substeps and multiplayer broadcasts every 80 ms, so only the
// smoothness changes, not the driving.
// MSAA stays on (#383): with light shadows the user measured no heat
// difference on a phone. `?aa=1|0` forces it either way for an A/B check
// (this page load only).
const PHONE_DPR_CAP = 1.25;
const PHONE_FPS_CAP = 30;
const AA_OVERRIDE = new URLSearchParams(location.search).get("aa");
function withDeviceExtras(profile) {
  const antialias = AA_OVERRIDE === "1" || AA_OVERRIDE === "0"
    ? AA_OVERRIDE === "1" : profile.antialias;
  return {
    ...profile,
    antialias,
    // Light shadows (#381): only the player's car casts, on a 512 map.
    shadowCasters: IS_COARSE_POINTER ? "player" : "all",
    shadowMapSize: IS_COARSE_POINTER ? Math.min(profile.shadowMapSize, 512) : profile.shadowMapSize,
    dprCap: IS_COARSE_POINTER ? Math.min(profile.dprCap, PHONE_DPR_CAP) : profile.dprCap,
    softShadows: !IS_COARSE_POINTER,
    frameCapFps: IS_COARSE_POINTER ? PHONE_FPS_CAP : 0,
    liteMaterials: IS_COARSE_POINTER,
  };
}

// Light shadows on phones (#381): the shadow camera sees one layer that
// only the player's car is on, so the shadow pass draws one car instead of
// the whole field and the scenery, over a tighter area that keeps the
// smaller map sharp. Rivals and scenery cast no shadow there.
export const PLAYER_SHADOW_LAYER = 1;
export function applyShadowCasters(profile, sun, playerGroup) {
  if (profile.shadowCasters !== "player") return;
  sun.shadow.camera.layers.set(PLAYER_SHADOW_LAYER);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 });
  playerGroup.traverse((object) => object.layers.enable(PLAYER_SHADOW_LAYER));
}

// Returns a `(now) => boolean` gate for a requestAnimationFrame loop: true
// when this frame should run. Carries the leftover time forward so a 90 Hz
// screen still averages 60 fps, and tolerates 60 Hz vsync jitter.
export function createFrameLimiter(fps) {
  if (!fps) return () => true;
  const frameMs = 1000 / fps;
  let last = -Infinity;
  return (now) => {
    const elapsed = now - last;
    if (elapsed < frameMs - 2) return false;
    last = elapsed > frameMs * 2 ? now : now - Math.max(0, elapsed - frameMs);
    return true;
  };
}

export function loadGraphicsProfile() {
  const override = new URLSearchParams(location.search).get("gfx");
  if (override && GRAPHICS_PROFILES[override]) {
    try {
      localStorage.setItem(STORAGE_KEY, override);
    } catch {
      // storage unavailable (private mode, disabled) — override still
      // applies for this session, just doesn't persist.
    }
    return withDeviceExtras({ id: override, ...GRAPHICS_PROFILES[override] });
  }

  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage unavailable — fall through to auto-detection.
  }
  if (stored && GRAPHICS_PROFILES[stored]) {
    return withDeviceExtras({ id: stored, ...GRAPHICS_PROFILES[stored] });
  }

  const id = detectDefaultProfileId();
  return withDeviceExtras({ id, ...GRAPHICS_PROFILES[id] });
}
