// Braking bar (#75): the next 300 m of track unrolled into a vertical strip
// on the right edge, player at the bottom, rivals as dots. Each stretch is
// colored by how much the player would have to brake if they were there at
// their current speed: green = no braking needed, red = braking zone or the
// corner itself. As a corner gets closer the red reaches the bottom of the
// bar, i.e. the car. Replaces the #69 minimap and #73 brake trail.

const VIEW_AHEAD_M = 300;
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

export function setupBrakeBar({
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
  const aheadOf = new Map(); // centerline idx -> metres ahead of the player

  return function update() {
    // Match the backing store to the CSS box (it changes with the layout).
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.round(canvas.clientWidth * scale);
    const cssH = Math.round(canvas.clientHeight * scale);
    if (cssW > 0 && (canvas.width !== cssW || canvas.height !== cssH)) {
      canvas.width = cssW;
      canvas.height = cssH;
    }
    const w = canvas.width;
    const h = canvas.height;
    const pad = w * 0.35; // room for the player marker and rival dots
    const top = pad;
    const bottom = h - pad;
    const yAt = (d) => bottom - (d / VIEW_AHEAD_M) * (bottom - top);
    const barX = w * 0.3;
    const barW = w * 0.4;

    // Samples covering the window, plus enough beyond it that a corner just
    // past 300 m still paints its braking zone inside the bar.
    const start = nearestTrackInfo(state.x, state.z).idx;
    idxs.length = 0;
    dists.length = 0;
    aheadOf.clear();
    let d = 0;
    for (let k = 0; k < n && d < VIEW_AHEAD_M * 2.5; k++) {
      const idx = (start + k) % n;
      idxs.push(idx);
      dists.push(d);
      aheadOf.set(idx, d);
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

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(5, 10, 16, 0.55)";
    ctx.beginPath();
    ctx.roundRect(barX - 3, top - 3, barW + 6, bottom - top + 6, barW / 2);
    ctx.fill();

    const v = Math.max(state.speed, 0);
    for (let k = 0; k < idxs.length - 1 && dists[k] < VIEW_AHEAD_M; k++) {
      const y0 = yAt(dists[k]);
      const y1 = yAt(Math.min(dists[k + 1], VIEW_AHEAD_M));
      const excess = v > 0 ? (v - envelope[k]) / (v * 0.2) : 0;
      ctx.fillStyle = urgencyColor(excess);
      ctx.fillRect(barX, y1, barW, y0 - y1 + 0.5);
    }

    for (const car of aiCars) {
      const ahead = aheadOf.get(nearestTrackInfo(car.x, car.z).idx);
      if (ahead === undefined || ahead > VIEW_AHEAD_M) continue;
      ctx.fillStyle = `#${car.color.toString(16).padStart(6, "0")}`;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(w / 2, yAt(ahead), w * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Player: white arrow at the bottom, pointing up the bar.
    const s = w * 0.3;
    ctx.beginPath();
    ctx.moveTo(w / 2, bottom - s);
    ctx.lineTo(w / 2 + s, bottom + s * 0.8);
    ctx.lineTo(w / 2 - s, bottom + s * 0.8);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();
  };
}
