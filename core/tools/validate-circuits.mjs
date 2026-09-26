#!/usr/bin/env node
// Circuit geometry validator (#6). Runs the same closed Catmull-Rom curve
// math the game actually drives on (via track-geometry.js, fed the real
// npm `three` build pinned to the CDN version — see package.json) against
// every entry in circuits.js, and reports geometry problems before they
// reach a PR: a wrong closure, a self-crossing/reversed loop, a corner tight
// enough to detach its kerb ribbon, or two unrelated parts of the track
// running closer together than their wall margins allow.
//
// Usage (run from inside core/ — this and package.json both live there,
// see core/package.json's "validate:circuits" script):
//   node tools/validate-circuits.mjs                 validate every circuit
//   node tools/validate-circuits.mjs <id> [<id> ...]  validate only these ids
//   node tools/validate-circuits.mjs --svg [outDir]   also write a top-down
//                                                      diagnostic SVG per
//                                                      circuit (default
//                                                      outDir: tools/out,
//                                                      relative to the
//                                                      current working
//                                                      directory — gitignored,
//                                                      dev-only, never shipped)
//
// Exit code is 1 if any circuit has an unsuppressed issue, 0 otherwise.

import * as THREE from "three";
import { CIRCUITS } from "../client/shared/circuits.js";
import { sampleCenterline, headingOf, sideNormal, nearestTrackInfo } from "../client/shared/track-geometry.js";
import { buildPitLane, PIT_LANE } from "../client/shared/pit-lane.js";

const SAMPLES = 360; // matches main.js's CENTERLINE_SAMPLES: validate the resolution the game actually drives on

// Same formula as main.js's WALL_LIMIT (runoff/wall margin past the asphalt
// edge). Curvature and non-adjacent-separation checks both use it as "how
// close is too close", per the existing dev comments in circuits.js.
function wallMargin(width) {
  return width / 2 + 4;
}

// Known, intentionally close geometry that would otherwise trip the
// non-adjacent-separation check — e.g. Marzamemi's shared coastal corridor,
// where the real streets run two legs close together (see circuits.js and
// F1-RACER-WIKI.md). Each entry is a floor, not a blanket exemption: a
// separation below it is still a real finding, so a future edit that makes
// the corridor even tighter still gets caught.
const ALLOWED_MIN_SEPARATION = {
  marzamemi: { floor: 12, reason: "shared coastal corridor between the two dogbone legs (circuits.js theme: marzamemi)" },
};

function dist(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function buildCurve(circuit) {
  const points = circuit.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
  return new THREE.CatmullRomCurve3(points, true, "catmullrom", circuit.curveTension ?? 0.5);
}

// --- Checks ------------------------------------------------------------
// Each returns a list of { level: "error"|"warning", message, at?: {x,z} }.
// `at` is a world point, used by --svg to place a marker.

// Closure: adjacent raw control points (including the wrap from last back
// to first) must not coincide — a near-duplicate pair collapses the spline
// tangent there into a degenerate/zero-length segment.
function checkClosure(circuit) {
  const issues = [];
  const pts = circuit.points;
  const MIN_CONTROL_POINT_GAP = 1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d < MIN_CONTROL_POINT_GAP) {
      issues.push({
        level: "error",
        message: `control points ${i} and ${(i + 1) % pts.length} are ${d.toFixed(2)} units apart (< ${MIN_CONTROL_POINT_GAP}) — near-duplicate, degenerate closure`,
        at: { x: a[0], z: a[1] },
      });
    }
  }
  return issues;
}

// Direction/winding: a simple, single-wound closed loop accumulates exactly
// ±360° of heading change over one lap. Far from that means either a
// self-crossing loop (nets toward 0°) or a reversal/double-wind — either
// way, something downstream (AI lookahead, grid ordering, lap progress)
// would misbehave.
function checkWinding(centerline) {
  const TOLERANCE_DEG = 20;
  let turning = 0;
  for (let i = 0; i < centerline.length; i++) {
    const h1 = headingOf(centerline[i]);
    const h2 = headingOf(centerline[(i + 1) % centerline.length]);
    turning += wrapAngle(h2 - h1);
  }
  const deg = (turning * 180) / Math.PI;
  if (Math.abs(Math.abs(deg) - 360) > TOLERANCE_DEG) {
    return [
      {
        level: "error",
        message: `total heading change over one lap is ${deg.toFixed(1)}°, expected ±360° (±${TOLERANCE_DEG}°) — likely a self-crossing or reversed loop`,
      },
    ];
  }
  return [];
}

// Segment length: sampled step distances should be neither near-zero
// (duplicate samples) nor absurdly long relative to track width (a gap
// wide enough to suggest sparse/malformed control points).
function checkSegmentLengths(centerline, width) {
  const MIN_SEGMENT = 0.05;
  const MAX_SEGMENT = width * 10;
  const issues = [];
  for (let i = 0; i < centerline.length; i++) {
    const a = centerline[i];
    const b = centerline[(i + 1) % centerline.length];
    const d = dist(a, b);
    if (d < MIN_SEGMENT) {
      issues.push({ level: "error", message: `sample ${i}->${(i + 1) % centerline.length} is only ${d.toFixed(3)} units apart (< ${MIN_SEGMENT})`, at: a });
    } else if (d > MAX_SEGMENT) {
      issues.push({ level: "error", message: `sample ${i}->${(i + 1) % centerline.length} is ${d.toFixed(1)} units apart (> ${MAX_SEGMENT.toFixed(0)}, 10x track width)`, at: a });
    }
  }
  return issues;
}

// Curvature: local radius (a 5-sample-wide stencil, wide enough to smooth
// out per-sample sampling noise while still catching a genuinely tight
// corner) must clear the same wall margin the runoff/collision model uses.
// This doubles as the "detached kerb" check: a corner tight enough to pull
// the inside kerb ribbon's offset points past each other necessarily shows
// up here first, as a too-small radius.
function checkCurvature(centerline, width) {
  const STENCIL = 5;
  const margin = wallMargin(width);
  const issues = [];
  const n = centerline.length;
  for (let i = 0; i < n; i++) {
    const a = centerline[(i - STENCIL + n) % n];
    const b = centerline[i];
    const c = centerline[(i + STENCIL) % n];
    const ab = dist(a, b);
    const bc = dist(b, c);
    const ca = dist(c, a);
    const s = (ab + bc + ca) / 2;
    const area = Math.sqrt(Math.max(s * (s - ab) * (s - bc) * (s - ca), 0));
    const radius = area < 1e-6 ? Infinity : (ab * bc * ca) / (4 * area);
    if (radius < margin) {
      issues.push({
        level: "error",
        message: `sample ${i}: local curvature radius ${radius.toFixed(2)} is below the wall margin ${margin.toFixed(2)} (width/2 + 4) — corner too tight, kerb ribbon risks detaching`,
        at: b,
      });
    }
  }
  return issues;
}

// Non-adjacent separation: two sampled points that are NOT near each other
// along the loop (guarded by a band so we don't compare a point to its own
// neighbours) must stay at least 2x the wall margin apart, so their
// individual runoff/wall corridors can't overlap. Known, intentional
// exceptions (e.g. Marzamemi's shared corridor) get a documented floor
// instead of being skipped outright.
function checkSeparation(circuit, centerline) {
  const margin = wallMargin(circuit.width);
  const required = margin * 2;
  const allowed = ALLOWED_MIN_SEPARATION[circuit.id];
  const floor = allowed ? allowed.floor : required;
  const n = centerline.length;
  const guard = Math.max(10, Math.round(n * 0.08));

  let minSep = Infinity;
  let minPair = null;
  for (let i = 0; i < n; i += 2) {
    for (let j = i + guard; j < n; j += 2) {
      if (n - (j - i) < guard) continue; // also guard the wrap-around neighbourhood
      const d = dist(centerline[i], centerline[j]);
      if (d < minSep) {
        minSep = d;
        minPair = [i, j];
      }
    }
  }
  if (minSep >= required) return [];
  if (minSep >= floor) {
    return [
      {
        level: "warning",
        message: `closest non-adjacent samples ${minPair[0]}/${minPair[1]} are ${minSep.toFixed(2)} apart (< required ${required.toFixed(2)}), but >= the documented floor ${floor} — accepted: ${allowed.reason}`,
        at: centerline[minPair[0]],
      },
    ];
  }
  return [
    {
      level: "error",
      message: `closest non-adjacent samples ${minPair[0]}/${minPair[1]} are ${minSep.toFixed(2)} apart (< ${allowed ? `documented floor ${floor}` : `required ${required.toFixed(2)}`}) — wall margins would overlap`,
      at: centerline[minPair[0]],
    },
  ];
}

// Pit lane (#147): on its flat stretch the lane asphalt must stay clear of
// every track leg, and its nearest centerline sample must only move forward
// (lap progress and the chase camera both project onto the centerline).
function checkPitLane(circuit, centerline) {
  const lane = buildPitLane(centerline, circuit.width, 1);
  const n = centerline.length, half = circuit.width / 2;
  const issues = [];
  let prev = null;
  for (const p of lane.path) {
    const info = nearestTrackInfo(centerline, p.x, p.z);
    if (p.flat && info.dist < half + PIT_LANE.halfWidth + 0.5) {
      issues.push({ level: "error", message: `pit lane at s=${p.s.toFixed(0)} is ${info.dist.toFixed(2)} from the centerline — overlaps the track`, at: p });
      break;
    }
    if (prev !== null) {
      const step = (info.idx - prev + n) % n;
      if (step > n / 2 || step > 6) {
        issues.push({ level: "error", message: `pit lane at s=${p.s.toFixed(0)} jumps from centerline sample ${prev} to ${info.idx}`, at: p });
        break;
      }
    }
    prev = info.idx;
  }
  return issues;
}

export function validateCircuit(circuit) {
  const curve = buildCurve(circuit);
  const centerline = sampleCenterline(curve, SAMPLES);
  const issues = [
    ...checkClosure(circuit),
    ...checkWinding(centerline),
    ...checkSegmentLengths(centerline, circuit.width),
    ...checkCurvature(centerline, circuit.width),
    ...checkSeparation(circuit, centerline),
    ...checkPitLane(circuit, centerline),
  ];
  return { circuit, centerline, issues };
}

// --- SVG diagnostic preview ----------------------------------------------
// A flat top-down view: the sampled centerline, error markers (red) and
// warning markers (amber). Written to disk only when --svg is passed —
// nothing here is referenced by the shipped game.
function toSvg({ circuit, centerline, issues }) {
  const PADDING = 20;
  const xs = centerline.map((p) => p.x);
  const zs = centerline.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const w = maxX - minX || 1;
  const h = maxZ - minZ || 1;
  const scale = Math.min(800 / w, 800 / h);
  const toSvgPoint = (x, z) => [(x - minX) * scale + PADDING, (z - minZ) * scale + PADDING];

  const pathPoints = centerline
    .concat([centerline[0]])
    .map((p) => toSvgPoint(p.x, p.z).join(","))
    .join(" ");

  const markers = issues
    .filter((issue) => issue.at)
    .map((issue) => {
      const [sx, sy] = toSvgPoint(issue.at.x, issue.at.z);
      const color = issue.level === "error" ? "#e5484d" : "#f5a623";
      return `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5" fill="${color}" fill-opacity="0.85"><title>${escapeXml(issue.message)}</title></circle>`;
    })
    .join("\n  ");

  const width = (maxX - minX) * scale + PADDING * 2;
  const height = (maxZ - minZ) * scale + PADDING * 2;
  const status = issues.some((i) => i.level === "error") ? "FAIL" : issues.length ? "WARN" : "OK";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" width="${width.toFixed(0)}" height="${height.toFixed(0)}">
  <rect width="100%" height="100%" fill="#101418" />
  <polyline points="${pathPoints}" fill="none" stroke="#5b9dd9" stroke-width="2" />
  ${markers}
  <text x="10" y="20" fill="#e6e6e6" font-family="sans-serif" font-size="16">${escapeXml(circuit.name)} (${circuit.id}) — ${status}</text>
</svg>
`;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// --- CLI -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const svgIndex = args.indexOf("--svg");
  const writeSvg = svgIndex !== -1;
  let outDir = "tools/out";
  const ids = [];
  for (let i = 0; i < args.length; i++) {
    if (i === svgIndex) continue;
    if (svgIndex !== -1 && i === svgIndex + 1 && !args[i].startsWith("-")) {
      outDir = args[i];
      continue;
    }
    if (args[i].startsWith("-")) continue;
    ids.push(args[i]);
  }

  const circuits = ids.length ? CIRCUITS.filter((c) => ids.includes(c.id)) : CIRCUITS;
  if (ids.length && circuits.length !== ids.length) {
    const known = new Set(CIRCUITS.map((c) => c.id));
    for (const id of ids) {
      if (!known.has(id)) console.error(`unknown circuit id: ${id}`);
    }
  }

  let hasError = false;

  if (writeSvg) {
    const fs = await import("node:fs");
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const circuit of circuits) {
    const result = validateCircuit(circuit);
    const errors = result.issues.filter((i) => i.level === "error");
    const warnings = result.issues.filter((i) => i.level === "warning");
    if (errors.length) hasError = true;

    const status = errors.length ? "FAIL" : warnings.length ? "WARN" : "OK";
    console.log(`\n${circuit.id} (${circuit.name}) — ${status}`);
    for (const issue of errors) console.log(`  ERROR: ${issue.message}`);
    for (const issue of warnings) console.log(`  warn:  ${issue.message}`);
    if (!result.issues.length) console.log("  no issues");

    if (writeSvg) {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const outPath = path.join(outDir, `${circuit.id}.svg`);
      fs.writeFileSync(outPath, toSvg(result));
      console.log(`  preview: ${outPath}`);
    }
  }

  console.log(`\n${circuits.length} circuit(s) checked.`);
  process.exit(hasError ? 1 : 0);
}

// Only run the CLI when this file is executed directly (`node
// tools/validate-circuits.mjs ...`), not when `validateCircuit` is imported
// for reuse (e.g. a future test file) — otherwise importing this module
// would side-effect the whole CLI, exit code included.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
