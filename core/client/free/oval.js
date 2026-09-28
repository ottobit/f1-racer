// Free-drive circuit (#274): a wide banked oval, inspired by a proving-ground
// test course. It is deliberately NOT in CIRCUITS (circuits.js): the
// championship, the menu, multiplayer rooms and the bots never see it.
//
// Stadium shape, points evenly spaced (~40 units) so the Catmull-Rom spline
// stays round instead of bulging where spacing changes.
const STRAIGHT = 720; // each long straight
const RADIUS = 150; // turn radius of the centreline
const STEP = 40;

function stadiumPoints() {
  const points = [];
  const half = STRAIGHT / 2;
  // Bottom straight, heading +x: from (-half, -R) to just before (half, -R).
  const straightCount = Math.round(STRAIGHT / STEP);
  for (let i = 0; i < straightCount; i++) points.push([-half + (i * STRAIGHT) / straightCount, -RADIUS]);
  // Right turn (half circle centred on (half, 0)), from -90° to +90°.
  const arcCount = Math.round((Math.PI * RADIUS) / STEP);
  for (let i = 0; i < arcCount; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / arcCount;
    points.push([half + RADIUS * Math.cos(a), RADIUS * Math.sin(a)]);
  }
  // Top straight, heading -x.
  for (let i = 0; i < straightCount; i++) points.push([half - (i * STRAIGHT) / straightCount, RADIUS]);
  // Left turn, from 90° to 270°.
  for (let i = 0; i < arcCount; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / arcCount;
    points.push([-half + RADIUS * Math.cos(a), RADIUS * Math.sin(a)]);
  }
  return points.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
}

export const FREE_OVAL = {
  id: "ovale-sopraelevato",
  name: "Ovale sopraelevato",
  width: 30,
  curveTension: 0.5,
  maxBankDeg: 24,
  points: stadiumPoints(),
};
