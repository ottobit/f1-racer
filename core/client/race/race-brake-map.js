// Braking map (#77): a heading-up section of the track, from a little
// behind the player to 300 m ahead, turning around the player's dot like
// the #69 minimap. Each stretch is colored by how much the player would
// have to brake if they were there at their current speed: green = no
// braking needed, yellow to red = braking zone or the corner itself. As a
// corner gets closer the red reaches the dot. Rivals in the section are
// drawn as colored dots. Replaces the #75 straight bar.

const VIEW_AHEAD_M = 300;
const VIEW_BEHIND_M = 30;
const VIEW_RADIUS_M = 150; // metres from the dot to the canvas edge
const GREEN = [61, 220, 120];
const YELLOW = [255, 210, 58];
const RED = [255, 52, 36];

function mix(a, b, t) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}

// t: 0 = fine, 1 = must brake here now.
function urgencyColor(t) {
  if (t < 0.5) return mix(GREEN, YELLOW, Math.max(t, 0) / 0.5);
  return mix(YELLOW, RED, Math.min((t - 0.5) / 0.5, 1));
}

export function setupBrakeMap({
  canvas,
  centerline,
  centerlineStep,
  cornerTargetSpeed,
  usableBrake,
  state,
  aiCars,
  nearestTrackInfo,
}) {
  const ctx = canvas.getContext("2d");
  const n = centerline.length;
  const idxs = [];
  const dists = [];
  const envelope = [];
  const inSection = new Set();

  return function update() {
    // Match the backing store to the CSS box (it changes with the layout).
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.round(canvas.clientWidth * scale);
    const cssH = Math.round(canvas.clientHeight * scale);
    if (cssW > 0 && (canvas.width !== cssW || canvas.height !== cssH)) {
      canvas.width = cssW;
      canvas.height = cssH;
    }
    const size = canvas.width;
    const half = size / 2;
    const anchorY = canvas.height * 0.72; // more road ahead than behind
    const zoom = half / VIEW_RADIUS_M;

    // Samples from a little behind the player to well past the section, so
    // a corner just beyond 300 m still paints its braking zone inside it.
    const start = nearestTrackInfo(state.x, state.z).idx;
    let back = start;
    for (let d = 0; d < VIEW_BEHIND_M; ) {
      back = (back - 1 + n) % n;
      d += centerlineStep[back];
    }
    idxs.length = 0;
    dists.length = 0;
    inSection.clear();
    let d = 0;
    for (let k = 0; k < n && d < VIEW_AHEAD_M * 2; k++) {
      const idx = (back + k) % n;
      idxs.push(idx);
      dists.push(d);
      if (d <= VIEW_BEHIND_M + VIEW_AHEAD_M) inSection.add(idx);
      d += centerlineStep[idx];
    }

    // Braking envelope, walked backwards: the fastest speed at each sample
    // from which every later corner can still be made with usable braking.
    envelope.length = idxs.length;
    let next = Infinity;
    for (let k = idxs.length - 1; k >= 0; k--) {
      const gap = k + 1 < idxs.length ? dists[k + 1] - dists[k] : 0;
      const reachable = Math.sqrt(next * next + 2 * usableBrake * gap);
      next = Math.min(cornerTargetSpeed[idxs[k]], reachable);
      envelope[k] = next;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    // World forward is (sin h, cos h) with canvas x = world x, canvas y =
    // world z; rotate it to screen-up around the dot.
    const forwardAngle = Math.atan2(Math.cos(state.heading), Math.sin(state.heading));
    ctx.translate(half, anchorY);
    ctx.rotate(-Math.PI / 2 - forwardAngle);
    ctx.scale(zoom, zoom);
    ctx.translate(-state.x, -state.z);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const last = idxs.findIndex((_, k) => dists[k] > VIEW_BEHIND_M + VIEW_AHEAD_M);
    const end = last === -1 ? idxs.length - 1 : last;
    const traceSection = () => {
      ctx.beginPath();
      for (let k = 0; k <= end; k++) {
        const p = centerline[idxs[k]];
        if (k === 0) ctx.moveTo(p.x, p.z);
        else ctx.lineTo(p.x, p.z);
      }
    };
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 16 / zoom;
    traceSection();
    ctx.stroke();

    const v = Math.max(state.speed, 0);
    ctx.lineWidth = 10 / zoom;
    for (let k = 0; k < end; k++) {
      const a = centerline[idxs[k]];
      const b = centerline[idxs[k + 1]];
      const excess = v > 0 ? (v - envelope[k]) / (v * 0.15) : 0;
      ctx.strokeStyle = urgencyColor(excess);
      ctx.beginPath();
      ctx.moveTo(a.x, a.z);
      ctx.lineTo(b.x, b.z);
      ctx.stroke();
    }

    for (const car of aiCars) {
      if (!inSection.has(nearestTrackInfo(car.x, car.z).idx)) continue;
      ctx.fillStyle = `#${car.color.toString(16).padStart(6, "0")}`;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      ctx.arc(car.x, car.z, 7 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // Player dot, always at the anchor.
    ctx.beginPath();
    ctx.arc(half, anchorY, size * 0.055, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Soft edges instead of a disc or frame.
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    const fade = ctx.createRadialGradient(half, half, half * 0.62, half, half, half);
    fade.addColorStop(0, "rgba(0, 0, 0, 1)");
    fade.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  };
}
