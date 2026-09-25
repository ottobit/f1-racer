// Braking map (#77, restyled in #81): a heading-up section of the track, from a little
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
    // The box may be wider than tall (#85): scale by the short side.
    const size = Math.min(canvas.width, canvas.height);
    const half = canvas.width / 2;
    const anchorY = canvas.height * 0.72; // more road ahead than behind
    const zoom = size / 2 / VIEW_RADIUS_M;

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

    // Braking point: the first sample ahead of the player where the current
    // speed is already above the envelope. Its distance is shown under the
    // arrow.
    const v = Math.max(state.speed, 0);
    const playerK = Math.max(idxs.indexOf(start), 0);
    let brakeDist = null;
    for (let k = playerK; k < idxs.length; k++) {
      if (v > envelope[k] + 0.5) {
        brakeDist = dists[k] - dists[playerK];
        break;
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    // World forward is (sin h, cos h) with canvas x = world x, canvas y =
    // world z; rotate it to screen-up around the arrow.
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
    // Road: see-through edge lines and asphalt so the track behind the
    // map stays visible (#85).
    const px = size / 256; // stroke widths are tuned for a 256 px canvas
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = (20 * px) / zoom;
    traceSection();
    ctx.stroke();
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = (16 * px) / zoom;
    traceSection();
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(20, 24, 30, 0.35)";
    traceSection();
    ctx.stroke();

    // Warning line down the middle, green -> yellow -> red.
    ctx.lineWidth = (6 * px) / zoom;
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
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = (2 * px) / zoom;
      ctx.beginPath();
      ctx.arc(car.x, car.z, (5 * px) / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // Player arrow, always at the anchor pointing up.
    const r = size * 0.06;
    ctx.beginPath();
    ctx.moveTo(half, anchorY - r);
    ctx.lineTo(half + r * 0.75, anchorY + r * 0.7);
    ctx.lineTo(half, anchorY + r * 0.35);
    ctx.lineTo(half - r * 0.75, anchorY + r * 0.7);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.lineWidth = 2 * px;
    ctx.stroke();

    // Soft elliptical edges instead of a disc or frame; the fade starts
    // early so the map melts into the scene (#85).
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    const halfH = canvas.height / 2;
    ctx.translate(half, halfH);
    ctx.scale(1, halfH / half);
    const fade = ctx.createRadialGradient(0, 0, half * 0.35, 0, 0, half);
    fade.addColorStop(0, "rgba(0, 0, 0, 1)");
    fade.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = fade;
    ctx.fillRect(-half, -half, canvas.width, canvas.width);
    ctx.restore();

    // Distance to the braking point, drawn after the fade so it stays sharp.
    if (brakeDist !== null) {
      const now = brakeDist < 8;
      const label = now ? "FRENA" : `${Math.round(brakeDist / 10) * 10} m`;
      const t = now ? 1 : brakeDist < 60 ? 0.8 : brakeDist < 150 ? 0.5 : 0;
      ctx.font = `800 ${Math.round(22 * px)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 4 * px;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
      ctx.fillStyle = urgencyColor(t);
      const y = Math.min(anchorY + r * 2.2, canvas.height - 14 * px);
      ctx.strokeText(label, half, y);
      ctx.fillText(label, half, y);
    }
  };
}
