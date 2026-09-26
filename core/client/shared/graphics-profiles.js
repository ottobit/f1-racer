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
// llm-wiki/wiki/f1-racer/roadmap.md).

const STORAGE_KEY = "f1racer-graphics-profile-v1";

export const GRAPHICS_PROFILES = {
  low: {
    label: "Basso",
    dprCap: 1,
    antialias: false,
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
// mobile signal; core count and a very high DPR (common on phones with a
// coarse pointer, rare on desktops) refine it toward "low" for the
// weakest likely devices instead of lumping every phone together.
const IS_COARSE_POINTER = matchMedia("(pointer: coarse)").matches;

function detectDefaultProfileId() {
  const isCoarsePointer = IS_COARSE_POINTER;
  const cores = navigator.hardwareConcurrency || 4;
  const dpr = window.devicePixelRatio || 1;
  if (!isCoarsePointer && cores >= 8) return "high";
  if (isCoarsePointer && (cores <= 4 || dpr >= 3)) return "low";
  return "medium";
}

// Touch-device extras applied on top of any profile (#159): hard-edged PCF
// shadows instead of the soft variant, and a 60 fps cap so 90/120 Hz phone
// screens don't render (and heat up) twice as often for no gameplay gain.
function withDeviceExtras(profile) {
  return { ...profile, softShadows: !IS_COARSE_POINTER, frameCapFps: IS_COARSE_POINTER ? 60 : 0 };
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
