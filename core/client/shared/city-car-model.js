import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// Cinquino (#311): a round 1960s city car for free drive, not an F1 car.
// Same contract as buildCar() in car-model.js — {group, wheels,
// steeringPivots, driverSteeringWheel, wheelRadius} — so applyCarToMesh()
// and the cockpit camera work unchanged. +Z is forward, +X is the car's
// left, y = 0 is the road. No badges or lettering: a generic shape only.
const WHEEL_RADIUS = .3;
const WHEEL_X = .6;
const WHEEL_Z = .88;
const BODY_WIDTH = 1.15; // extrusion depth; the bevel adds BODY_BEVEL a side
const BODY_BEVEL = .08;
// Inner outline radius: the bevel grows the shape, so the arch shrinks by it.
const ARCH_RADIUS = .42;

// A side profile in (z, y), extruded across the car's width and centred.
// Shape x -> car z, shape y -> y, extrusion -> car x.
function extrudeAcross(shape, width, bevel) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: 4, curveSegments: 20,
  });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(width / 2, 0, 0);
  return geometry;
}

function bodyOutline() {
  const s = new THREE.Shape();
  // Rear bottom, round tail (rear engine), long flat belt line, short
  // sloping bonnet and a round nose; then back along the bottom with an
  // arch over each axle.
  s.moveTo(-1.26, .28);
  s.quadraticCurveTo(-1.36, .3, -1.35, .5);
  s.quadraticCurveTo(-1.33, .74, -1.05, .77);
  s.lineTo(.55, .77);
  s.quadraticCurveTo(.98, .76, 1.22, .6);
  s.quadraticCurveTo(1.36, .5, 1.34, .38);
  s.quadraticCurveTo(1.32, .28, 1.22, .28);
  const start = Math.asin((.28 - WHEEL_RADIUS) / ARCH_RADIUS);
  for (const z of [WHEEL_Z, -WHEEL_Z]) {
    s.lineTo(z + ARCH_RADIUS * Math.cos(start), .28);
    s.absarc(z, WHEEL_RADIUS, ARCH_RADIUS, start, Math.PI - start, false);
  }
  s.closePath();
  return s;
}

function cabinOutline() {
  const s = new THREE.Shape();
  s.moveTo(-.93, .78);
  s.lineTo(-.72, 1.2);
  s.quadraticCurveTo(-.66, 1.27, -.5, 1.27);
  s.lineTo(.1, 1.28);
  s.quadraticCurveTo(.2, 1.28, .26, 1.2);
  s.lineTo(.56, .78);
  s.closePath();
  return s;
}

function roofOutline() {
  const s = new THREE.Shape();
  s.moveTo(-.72, 1.17);
  s.lineTo(-.66, 1.27);
  s.quadraticCurveTo(-.6, 1.31, -.48, 1.31);
  s.lineTo(.1, 1.32);
  s.quadraticCurveTo(.22, 1.31, .27, 1.17);
  s.closePath();
  return s;
}

export function buildCityCar(color = 0x6b4226, { scale = 1, detail = false } = {}) {
  const primary = typeof color === 'object' ? color.primary : color;
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: primary, metalness: .3, roughness: .3, clearcoat: 1, clearcoatRoughness: .12 });
  paint.userData.carPaintRole = 'primary';
  // Bright enough to read as chrome without an environment map too.
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe8ecef, metalness: .75, roughness: .2 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x223441, metalness: .1, roughness: .05, clearcoat: 1, transparent: true, opacity: .78 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141619, roughness: .9 });
  const canvasTop = new THREE.MeshStandardMaterial({ color: 0x3a2c21, roughness: .95 });
  const seat = new THREE.MeshStandardMaterial({ color: 0xcdb892, roughness: .8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: .7 });
  const ivory = new THREE.MeshStandardMaterial({ color: 0xece6d6, roughness: .6 });
  const lens = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff1c4, emissiveIntensity: .45, roughness: .1 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xffa21a, emissive: 0xff8a00, emissiveIntensity: .4, roughness: .3 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x8a0f0f, emissive: 0xff2010, emissiveIntensity: .6, roughness: .3 });
  const segments = detail ? 32 : 18;

  function mesh(geometry, material, pos = [0, 0, 0], parent = group) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(...pos); m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const box = (w, h, d, material, pos, parent) => mesh(new THREE.BoxGeometry(w, h, d), material, pos, parent);
  function rod(a, b, r, material, parent = group) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), v = end.clone().sub(start);
    const m = mesh(new THREE.CylinderGeometry(r, r, v.length(), 10), material, start.add(end).multiplyScalar(.5).toArray(), parent);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
    return m;
  }

  mesh(extrudeAcross(bodyOutline(), BODY_WIDTH, BODY_BEVEL), paint).name = 'cityBody';
  mesh(extrudeAcross(cabinOutline(), .98, .06), glass).name = 'cityGlass';
  mesh(extrudeAcross(roofOutline(), 1.02, .05), paint).name = 'roof';
  box(.7, .02, .72, canvasTop, [0, 1.36, -.2]).name = 'roofCanvas';

  const sideX = BODY_WIDTH / 2 + BODY_BEVEL;
  for (const side of [-1, 1]) {
    // Painted pillars over the glass edges.
    rod([side * .55, .84, .6], [side * .52, 1.27, .24], .035, paint);
    rod([side * .56, .84, -.3], [side * .54, 1.3, -.3], .03, paint);
    rod([side * .56, .84, -.93], [side * .53, 1.24, -.7], .04, paint);
    // Belt-line chrome strip, door handle, round mirror on a stalk.
    rod([side * (sideX + .005), .8, -1.0], [side * (sideX + .005), .8, .62], .012, chrome);
    box(.03, .03, .12, chrome, [side * (sideX + .01), .7, -.15]).name = 'doorHandle';
    const mirror = mesh(new THREE.SphereGeometry(.06, 12, 8), chrome, [side * .74, .92, .52]);
    mirror.scale.set(1, .75, .55);
    rod([side * .63, .85, .55], [side * .72, .92, .52], .012, chrome);
    // Round headlamps in chrome bezels, amber indicators below.
    const bezel = mesh(new THREE.CylinderGeometry(.115, .125, .1, segments), chrome, [side * .42, .58, 1.36]);
    bezel.rotation.x = Math.PI / 2;
    const lamp = mesh(new THREE.SphereGeometry(.1, segments, 10, 0, Math.PI * 2, 0, Math.PI / 2), lens, [side * .42, .58, 1.41]);
    lamp.rotation.x = Math.PI / 2;
    lamp.scale.set(1, .5, 1);
    const indicator = mesh(new THREE.SphereGeometry(.04, 10, 8), amber, [side * .44, .4, 1.41]);
    indicator.scale.set(1.5, .8, .6);
    // Chrome "moustache" on the nose, rear lamps.
    rod([side * .05, .5, 1.44], [side * .3, .54, 1.41], .014, chrome).name = 'frontMoustache';
    box(.07, .15, .04, tail, [side * .5, .56, -1.41]).name = 'tailLamp';
  }
  const badge = mesh(new THREE.CylinderGeometry(.05, .05, .02, segments), chrome, [0, .49, 1.445]);
  badge.rotation.x = Math.PI / 2;
  // Slim bumpers wrapping round the corners.
  for (const z of [1.47, -1.47]) {
    rod([-.55, .3, z], [.55, .3, z], .028, chrome);
    for (const side of [-1, 1]) rod([side * .55, .3, z], [side * .66, .3, z - Math.sign(z) * .16], .026, chrome);
  }
  // Rear engine lid with cooling slats, small exhaust.
  for (let i = 0; i < 5; i++) box(.42, .014, .02, dark, [0, .55 + i * .035, -1.42 + i * .004]).name = 'engineSlat';
  const exhaust = mesh(new THREE.CylinderGeometry(.035, .035, .16, 10), chrome, [.3, .24, -1.38]);
  exhaust.rotation.x = Math.PI / 2;

  // Interior for the cockpit view: dashboard, thin wheel, two seats. The
  // wheel sits on the centreline in front of the cockpit eye (race-camera.js).
  box(1.1, .1, .18, paint, [0, .84, .5]).name = 'dashboard';
  box(.5, .05, .1, dark, [0, .9, .48]).name = 'dashboardBinnacle';
  const driverSteeringWheel = new THREE.Group();
  driverSteeringWheel.name = 'cityCarSteeringWheel';
  driverSteeringWheel.position.set(0, .86, .3);
  driverSteeringWheel.rotation.x = -.45;
  group.add(driverSteeringWheel);
  const rim = mesh(new THREE.TorusGeometry(.16, .014, 8, segments), rubber, [0, 0, 0], driverSteeringWheel);
  rim.rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
    rod([0, 0, 0], [Math.cos(a) * .15, 0, Math.sin(a) * .15], .008, chrome, driverSteeringWheel);
  }
  rod([0, .82, .32], [0, .7, .55], .016, dark);
  for (const side of [-1, 1]) {
    box(.4, .1, .42, seat, [side * .28, .45, -.2]).name = 'seat';
    const back = box(.4, .5, .08, seat, [side * .28, .72, -.43]);
    back.name = 'seatBack';
    back.rotation.x = -.15;
  }

  // Wheels: small tyres, chrome hubcaps, ivory sidewall ring.
  const steeringPivots = [];
  const wheels = [[WHEEL_X, WHEEL_Z], [-WHEEL_X, WHEEL_Z], [WHEEL_X, -WHEEL_Z], [-WHEEL_X, -WHEEL_Z]].map(([x, z], index) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_RADIUS, z);
    group.add(pivot);
    const wheel = new THREE.Group();
    pivot.add(wheel);
    if (index < 2) steeringPivots.push(pivot);
    const tyre = mesh(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, .17, segments), rubber, [0, 0, 0], wheel);
    tyre.rotation.z = Math.PI / 2;
    const side = Math.sign(x);
    const cap = mesh(new THREE.SphereGeometry(.17, segments, 10, 0, Math.PI * 2, 0, Math.PI / 2), chrome, [side * .085, 0, 0], wheel);
    cap.rotation.z = -side * Math.PI / 2;
    cap.scale.set(1, .28, 1);
    const wall = mesh(new THREE.TorusGeometry(.23, .018, 6, segments), ivory, [side * .087, 0, 0], wheel);
    wall.rotation.y = Math.PI / 2;
    return wheel;
  });

  group.scale.setScalar(scale);
  return { group, wheels, steeringPivots, driverSteeringWheel, wheelRadius: WHEEL_RADIUS * scale };
}
