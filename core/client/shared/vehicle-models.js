import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// Free-drive vehicles (#311, #313): round period road cars, not F1 cars.
// Every builder returns buildCar()'s contract (car-model.js) — {group,
// wheels, steeringPivots, driverSteeringWheel, wheelRadius} — plus an
// optional cockpitEye (model units) for race-camera.js, so applyCarToMesh()
// and the cockpit view drive them unchanged. +Z is forward, +X the car's
// left, y = 0 the road. Generic shapes only: no badges or lettering.
//
// Bodies are side profiles in (z, y) extruded across the width. The bevel
// grows a shape outwards, so outlines sit one bevel inside the real
// surface and wheel arches use the tyre radius + clearance + bevel.

function extrudeAcross(shape, width, bevel) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: 4, curveSegments: 20,
  });
  // Shape x -> car z, shape y -> y, extrusion -> car x, centred.
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(width / 2, 0, 0);
  return geometry;
}

// Path commands: [x, y] is lineTo, [cx, cy, x, y] is quadraticCurveTo.
function outline(start, path, arches = null) {
  const s = new THREE.Shape();
  s.moveTo(...start);
  for (const p of path) {
    if (p.length === 4) s.quadraticCurveTo(...p);
    else s.lineTo(...p);
  }
  if (arches) {
    // Back along the bottom from the nose, with an arch over each axle.
    const { bottom, axles, wheelRadius, radius } = arches;
    const start = Math.asin((bottom - wheelRadius) / radius);
    for (const z of axles) {
      s.lineTo(z + radius * Math.cos(start), bottom);
      s.absarc(z, wheelRadius, radius, start, Math.PI - start, false);
    }
  }
  s.closePath();
  return s;
}

function paintMaterial(color, role) {
  const material = new THREE.MeshPhysicalMaterial({ color, metalness: .3, roughness: .3, clearcoat: 1, clearcoatRoughness: .12 });
  material.userData.carPaintRole = role;
  return material;
}

function createKit(detail) {
  const group = new THREE.Group();
  const segments = detail ? 32 : 18;
  const mats = {
    // Bright enough to read as chrome without an environment map too.
    chrome: new THREE.MeshStandardMaterial({ color: 0xe8ecef, metalness: .75, roughness: .2 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x223441, metalness: .1, roughness: .05, clearcoat: 1, transparent: true, opacity: .78 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141619, roughness: .9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: .7 }),
    seat: new THREE.MeshStandardMaterial({ color: 0xcdb892, roughness: .8 }),
    ivory: new THREE.MeshStandardMaterial({ color: 0xece6d6, roughness: .6 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff1c4, emissiveIntensity: .45, roughness: .1 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffa21a, emissive: 0xff8a00, emissiveIntensity: .4, roughness: .3 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x8a0f0f, emissive: 0xff2010, emissiveIntensity: .6, roughness: .3 }),
  };
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
  // Round headlamp facing +z: chrome bezel at z, lens dome just ahead.
  function roundLamp(x, y, z, r = .1) {
    const bezel = mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.25, .1, segments), mats.chrome, [x, y, z]);
    bezel.rotation.x = Math.PI / 2;
    const lamp = mesh(new THREE.SphereGeometry(r, segments, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.lens, [x, y, z + .05]);
    lamp.rotation.x = Math.PI / 2;
    lamp.scale.set(1, .5, 1);
  }
  // Wheels: index 0-1 front (steering pivots), 2-3 rear, as in car-model.js.
  function wheels({ x, front, rear, radius, width = .17, hub = 'cap', hubMaterial = mats.chrome, whitewall = false }) {
    const steeringPivots = [];
    const list = [[x, front], [-x, front], [x, rear], [-x, rear]].map(([px, pz], index) => {
      const pivot = new THREE.Group();
      pivot.position.set(px, radius, pz);
      group.add(pivot);
      const wheel = new THREE.Group();
      pivot.add(wheel);
      if (index < 2) steeringPivots.push(pivot);
      const tyre = mesh(new THREE.CylinderGeometry(radius, radius, width, segments), mats.rubber, [0, 0, 0], wheel);
      tyre.rotation.z = Math.PI / 2;
      const side = Math.sign(px);
      const face = side * width / 2;
      const cap = mesh(new THREE.SphereGeometry(radius * .57, segments, 10, 0, Math.PI * 2, 0, Math.PI / 2), hubMaterial, [face, 0, 0], wheel);
      cap.rotation.z = -side * Math.PI / 2;
      cap.scale.set(1, .28, 1);
      if (hub === 'spinner') box(.03, .16, .03, mats.chrome, [face + side * .05, 0, 0], wheel).name = 'knockOff';
      if (hub === 'mag') {
        for (let i = 0; i < 5; i++) {
          const a = i / 5 * Math.PI * 2;
          rod([face + side * .01, Math.cos(a) * .06, Math.sin(a) * .06], [face + side * .01, Math.cos(a) * radius * .72, Math.sin(a) * radius * .72], .022, mats.chrome, wheel);
        }
      }
      if (whitewall) {
        const wall = mesh(new THREE.TorusGeometry(radius * .77, .018, 6, segments), mats.ivory, [face + side * .002, 0, 0], wheel);
        wall.rotation.y = Math.PI / 2;
      }
      return wheel;
    });
    return { wheels: list, steeringPivots };
  }
  // Thin period steering wheel with three spokes; returns the turning group.
  function steeringWheel({ pos, tilt, radius = .14, rim = mats.rubber, column }) {
    const wheel = new THREE.Group();
    wheel.name = 'roadCarSteeringWheel';
    wheel.position.set(...pos);
    wheel.rotation.x = tilt;
    group.add(wheel);
    const ring = mesh(new THREE.TorusGeometry(radius, .012, 8, segments), rim, [0, 0, 0], wheel);
    ring.rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + i * Math.PI * 2 / 3;
      rod([0, 0, 0], [Math.cos(a) * radius * .93, 0, Math.sin(a) * radius * .93], .007, mats.chrome, wheel);
    }
    if (column) rod(column[0], column[1], .014, mats.dark);
    return wheel;
  }
  function finish(parts, scale, wheelRadius, cockpitEye = null) {
    group.scale.setScalar(scale);
    return {
      group, wheels: parts.wheels, steeringPivots: parts.steeringPivots,
      driverSteeringWheel: parts.driverSteeringWheel, wheelRadius: wheelRadius * scale,
      ...(cockpitEye ? { cockpitEye: new THREE.Vector3(...cockpitEye) } : {}),
    };
  }
  return { group, segments, mats, mesh, box, rod, roundLamp, wheels, steeringWheel, finish };
}

// Cinquino (#311): round 1960s city car, rear engine, canvas sunroof.
function buildCinquino({ primary = 0x5c371f } = {}, { scale = 1, detail = false } = {}) {
  const k = createKit(detail);
  const { mats, mesh, box, rod } = k;
  const paint = paintMaterial(primary, 'primary');
  const R = .3, BEVEL = .08, WIDTH = 1.15;
  mesh(extrudeAcross(outline([-1.26, .28], [
    [-1.36, .3, -1.35, .5], [-1.33, .74, -1.05, .77], [.55, .77],
    [.98, .76, 1.22, .6], [1.36, .5, 1.34, .38], [1.32, .28, 1.22, .28],
  ], { bottom: .28, axles: [.88, -.88], wheelRadius: R, radius: .42 }), WIDTH, BEVEL), paint).name = 'cityBody';
  mesh(extrudeAcross(outline([-.93, .78], [[-.72, 1.2], [-.66, 1.27, -.5, 1.27], [.1, 1.28], [.2, 1.28, .26, 1.2], [.56, .78]]), .98, .06), mats.glass).name = 'cityGlass';
  mesh(extrudeAcross(outline([-.72, 1.17], [[-.66, 1.27], [-.6, 1.31, -.48, 1.31], [.1, 1.32], [.22, 1.31, .27, 1.17]]), 1.02, .05), paint).name = 'roof';
  box(.7, .02, .72, new THREE.MeshStandardMaterial({ color: 0x3a2c21, roughness: .95 }), [0, 1.36, -.2]).name = 'roofCanvas';

  const sideX = WIDTH / 2 + BEVEL;
  for (const side of [-1, 1]) {
    rod([side * .55, .84, .6], [side * .52, 1.27, .24], .035, paint);
    rod([side * .56, .84, -.3], [side * .54, 1.3, -.3], .03, paint);
    rod([side * .56, .84, -.93], [side * .53, 1.24, -.7], .04, paint);
    rod([side * (sideX + .005), .8, -1.0], [side * (sideX + .005), .8, .62], .012, mats.chrome);
    box(.03, .03, .12, mats.chrome, [side * (sideX + .01), .7, -.15]).name = 'doorHandle';
    const mirror = mesh(new THREE.SphereGeometry(.06, 12, 8), mats.chrome, [side * .74, .92, .52]);
    mirror.scale.set(1, .75, .55);
    rod([side * .63, .85, .55], [side * .72, .92, .52], .012, mats.chrome);
    k.roundLamp(side * .42, .58, 1.36);
    const indicator = mesh(new THREE.SphereGeometry(.04, 10, 8), mats.amber, [side * .44, .4, 1.41]);
    indicator.scale.set(1.5, .8, .6);
    rod([side * .05, .5, 1.44], [side * .3, .54, 1.41], .014, mats.chrome).name = 'frontMoustache';
    box(.07, .15, .04, mats.tail, [side * .5, .56, -1.41]).name = 'tailLamp';
  }
  const badge = mesh(new THREE.CylinderGeometry(.05, .05, .02, k.segments), mats.chrome, [0, .49, 1.445]);
  badge.rotation.x = Math.PI / 2;
  for (const z of [1.47, -1.47]) {
    rod([-.55, .3, z], [.55, .3, z], .028, mats.chrome);
    for (const side of [-1, 1]) rod([side * .55, .3, z], [side * .66, .3, z - Math.sign(z) * .16], .026, mats.chrome);
  }
  for (let i = 0; i < 5; i++) box(.42, .014, .02, mats.dark, [0, .55 + i * .035, -1.42 + i * .004]).name = 'engineSlat';
  const exhaust = mesh(new THREE.CylinderGeometry(.035, .035, .16, 10), mats.chrome, [.3, .24, -1.38]);
  exhaust.rotation.x = Math.PI / 2;

  // The body is solid up to the belt line (y ~.85): dashboard and wheel sit
  // above it, on the centreline in front of the default cockpit eye.
  box(1.0, .06, .1, paint, [0, .88, .52]).name = 'dashboard';
  box(.26, .05, .06, mats.dark, [0, .93, .49]).name = 'dashboardBinnacle';
  const driverSteeringWheel = k.steeringWheel({ pos: [0, .9, .42], tilt: -.6, column: [[0, .87, .44], [0, .82, .55]] });
  for (const side of [-1, 1]) {
    box(.4, .1, .42, mats.seat, [side * .28, .45, -.2]).name = 'seat';
    const back = box(.4, .5, .08, mats.seat, [side * .28, .72, -.43]);
    back.name = 'seatBack';
    back.rotation.x = -.15;
  }
  const parts = k.wheels({ x: .6, front: .88, rear: -.88, radius: R, whitewall: true });
  return k.finish({ ...parts, driverSteeringWheel }, scale, R);
}

// Spider: open two-seat 1960s roadster, long bonnet, roll hoop.
function buildSpider({ primary = 0xb3121b } = {}, { scale = 1, detail = false } = {}) {
  const k = createKit(detail);
  const { mats, mesh, box, rod } = k;
  const paint = paintMaterial(primary, 'primary');
  const leather = new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: .75 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: .5 });
  const R = .31, BEVEL = .07, WIDTH = 1.3;
  mesh(extrudeAcross(outline([-1.8, .27], [
    [-1.95, .29, -1.93, .47], [-1.9, .66, -1.6, .68], [.4, .68], [1.0, .66],
    [1.75, .62, 1.9, .46], [1.98, .34, 1.86, .27],
  ], { bottom: .27, axles: [1.2, -1.15], wheelRadius: R, radius: .43 }), WIDTH, BEVEL), paint).name = 'spiderBody';
  // Open cockpit: leather tub over the solid body, two seat backs.
  box(1.1, .03, 1.15, leather, [0, .765, -.3]).name = 'cockpitTub';
  for (const side of [-1, 1]) {
    const back = box(.42, .36, .08, leather, [side * .3, .92, -.74]);
    back.name = 'seatBack';
    back.rotation.x = -.2;
  }
  // Raked windscreen in a chrome frame (centre (0,.9,.45), tilted back).
  const screen = box(1.18, .3, .015, mats.glass, [0, .9, .45]);
  screen.name = 'windscreen';
  screen.rotation.x = -.5;
  rod([-.59, 1.032, .378], [.59, 1.032, .378], .015, mats.chrome);
  for (const side of [-1, 1]) rod([side * .59, .768, .522], [side * .59, 1.032, .378], .015, mats.chrome);
  // Roll hoop behind the seats.
  for (const side of [-1, 1]) rod([side * .42, .75, -.86], [side * .42, 1.12, -.9], .03, mats.chrome);
  rod([-.42, 1.12, -.9], [.42, 1.12, -.9], .03, mats.chrome);
  // Faired round headlamps, oval grille, slim bumpers, round tail lamps.
  for (const side of [-1, 1]) {
    k.roundLamp(side * .55, .6, 1.77);
    const tail = mesh(new THREE.SphereGeometry(.055, 10, 8), mats.tail, [side * .52, .55, -1.97]);
    tail.scale.set(1, 1, .5);
    const mirror = mesh(new THREE.SphereGeometry(.05, 12, 8), mats.chrome, [side * .62, .82, .32]);
    mirror.scale.set(1, .75, .55);
    rod([side * .9, .3, 1.85], [side * .62, .3, 2.03], .022, mats.chrome);
  }
  const grille = mesh(new THREE.CylinderGeometry(.18, .18, .04, k.segments), mats.dark, [0, .42, 1.97]);
  grille.rotation.x = Math.PI / 2;
  grille.scale.set(1.5, 1, .65);
  const surround = mesh(new THREE.TorusGeometry(.18, .014, 6, k.segments), mats.chrome, [0, .42, 1.99]);
  surround.scale.set(1.5, .65, 1);
  rod([-.62, .3, 2.03], [.62, .3, 2.03], .022, mats.chrome);
  rod([-.6, .3, -2.0], [.6, .3, -2.0], .022, mats.chrome);
  for (const side of [-1, 1]) {
    const pipe = mesh(new THREE.CylinderGeometry(.03, .03, .16, 10), mats.chrome, [side * .2, .24, -1.95]);
    pipe.rotation.x = Math.PI / 2;
  }
  // Wood-rimmed wheel and a painted dash under the screen.
  box(1.15, .06, .1, paint, [0, .79, .42]).name = 'dashboard';
  const driverSteeringWheel = k.steeringWheel({ pos: [0, .87, .12], tilt: -.7, radius: .15, rim: wood, column: [[0, .84, .15], [0, .79, .38]] });
  const parts = k.wheels({ x: .66, front: 1.2, rear: -1.15, radius: R, hub: 'spinner' });
  return k.finish({ ...parts, driverSteeringWheel }, scale, R, [0, 1.0, -.45]);
}

// Pulmino: two-tone 1960s forward-control van, flat nose, big windows.
function buildPulmino({ primary = 0x7fb3d5, secondary = 0xf2efe6 } = {}, { scale = 1, detail = false } = {}) {
  const k = createKit(detail);
  const { mats, mesh, box, rod } = k;
  const paint = paintMaterial(primary, 'primary');
  const white = paintMaterial(secondary, 'secondary');
  const R = .3, BEVEL = .08, WIDTH = 1.42;
  mesh(extrudeAcross(outline([-1.55, .28], [
    [-1.64, .28, -1.64, .42], [-1.64, .86], [1.6, .86], [1.62, .42], [1.62, .28, 1.5, .28],
  ], { bottom: .28, axles: [1.05, -1.0], wheelRadius: R, radius: .43 }), WIDTH, BEVEL), paint).name = 'vanBody';
  mesh(extrudeAcross(outline([-1.62, .86], [[-1.6, 1.5], [1.48, 1.5], [1.6, .86]]), 1.36, .06), mats.glass).name = 'vanGlass';
  mesh(extrudeAcross(outline([-1.6, 1.46], [[-1.6, 1.6], [-1.58, 1.72, -1.4, 1.72], [1.25, 1.72], [1.46, 1.72, 1.48, 1.58], [1.49, 1.46]]), 1.42, .08), white).name = 'roof';
  // White window pillars and a white waist band: the two-tone look.
  for (const side of [-1, 1]) {
    const x = side * .74;
    rod([x, .9, 1.62], [side * .72, 1.5, 1.49], .04, white);
    for (const z of [.65, -.1, -.85, -1.6]) rod([x, .9, z], [x, 1.5, z], .045, white);
    rod([side * .79, .88, -1.62], [side * .79, .88, 1.62], .03, white);
    k.roundLamp(side * .55, .62, 1.69);
    const indicator = mesh(new THREE.SphereGeometry(.04, 10, 8), mats.amber, [side * .62, .44, 1.71]);
    indicator.scale.set(1.5, .8, .6);
    box(.08, .16, .04, mats.tail, [side * .62, .62, -1.73]).name = 'tailLamp';
    const mirror = mesh(new THREE.SphereGeometry(.07, 12, 8), mats.chrome, [side * .86, 1.1, 1.45]);
    mirror.scale.set(.6, 1, .5);
    rod([side * .75, 1.0, 1.5], [side * .85, 1.1, 1.45], .012, mats.chrome);
  }
  for (const z of [1.76, -1.76]) rod([-.72, .32, z], [.72, .32, z], .03, mats.chrome);
  // Cab: big flat wheel, white dash, front seats; benches behind.
  box(1.3, .08, .14, white, [0, .95, 1.42]).name = 'dashboard';
  const driverSteeringWheel = k.steeringWheel({ pos: [0, 1.1, 1.22], tilt: -1.05, radius: .17, column: [[0, 1.08, 1.25], [0, .95, 1.45]] });
  for (const side of [-1, 1]) box(.45, .5, .08, mats.seat, [side * .35, 1.12, .42]).name = 'seatBack';
  for (const z of [-.3, -1.0]) box(1.2, .4, .08, mats.seat, [0, 1.06, z]).name = 'bench';
  const parts = k.wheels({ x: .66, front: 1.05, rear: -1.0, radius: R, hubMaterial: white });
  return k.finish({ ...parts, driverSteeringWheel }, scale, R, [0, 1.42, .62]);
}

// Muscle: long-bonnet fastback coupé with stripes and a bonnet scoop.
function buildMuscle({ primary = 0xf2b705, secondary = 0x111111 } = {}, { scale = 1, detail = false } = {}) {
  const k = createKit(detail);
  const { mats, mesh, box, rod } = k;
  const paint = paintMaterial(primary, 'primary');
  const stripe = paintMaterial(secondary, 'secondary');
  const R = .34, BEVEL = .08, WIDTH = 1.5;
  mesh(extrudeAcross(outline([-2.05, .3], [
    [-2.15, .32, -2.13, .5], [-2.1, .74], [-1.5, .76], [.6, .76], [2.0, .72],
    [2.2, .71, 2.2, .5], [2.18, .3, 2.05, .3],
  ], { bottom: .3, axles: [1.45, -1.3], wheelRadius: R, radius: .47 }), WIDTH, BEVEL), paint).name = 'muscleBody';
  mesh(extrudeAcross(outline([-1.55, .78], [[-.55, 1.18], [.1, 1.2], [.62, .78]]), 1.26, .06), mats.glass).name = 'muscleGlass';
  mesh(extrudeAcross(outline([-.62, 1.14], [[-.5, 1.24], [.08, 1.26], [.18, 1.14]]), 1.28, .05), paint).name = 'roof';
  for (const side of [-1, 1]) {
    rod([side * .66, .82, .6], [side * .62, 1.22, .12], .04, paint);
    rod([side * .67, .82, -1.45], [side * .62, 1.2, -.6], .07, paint);
    // Twin stripes over bonnet, roof and deck.
    // Bonnet stripe follows the bonnet's slight fall to the nose.
    const bonnetStripe = box(.16, .012, 1.4, stripe, [side * .14, .848, 1.35]);
    bonnetStripe.name = 'stripe';
    bonnetStripe.rotation.x = .03;
    box(.16, .012, .62, stripe, [side * .14, 1.315, -.2]).name = 'stripe';
    box(.16, .012, .5, stripe, [side * .14, .85, -1.8]).name = 'stripe';
    k.roundLamp(side * .5, .54, 2.25, .085);
    const mirror = mesh(new THREE.SphereGeometry(.055, 12, 8), mats.chrome, [side * .78, .9, .5]);
    mirror.scale.set(1, .75, .55);
    const pipe = mesh(new THREE.CylinderGeometry(.045, .045, .18, 10), mats.chrome, [side * .5, .25, -2.2]);
    pipe.rotation.x = Math.PI / 2;
  }
  box(.36, .07, .5, paint, [0, .87, 1.05]).name = 'bonnetScoop';
  box(1.25, .18, .03, mats.dark, [0, .5, 2.27]).name = 'grille';
  rod([-.64, .6, 2.28], [.64, .6, 2.28], .012, mats.chrome);
  rod([-.64, .4, 2.28], [.64, .4, 2.28], .012, mats.chrome);
  box(1.2, .08, .03, mats.tail, [0, .62, -2.22]).name = 'tailLamp';
  for (const z of [2.33, -2.28]) rod([-.78, .33, z], [.78, .33, z], .032, mats.chrome);
  box(1.3, .07, .12, mats.dark, [0, .84, .52]).name = 'dashboard';
  const driverSteeringWheel = k.steeringWheel({ pos: [0, .9, .2], tilt: -.55, radius: .15, column: [[0, .87, .23], [0, .82, .48]] });
  for (const side of [-1, 1]) {
    const back = box(.42, .45, .08, mats.dark, [side * .32, .95, -.62]);
    back.name = 'seatBack';
    back.rotation.x = -.2;
  }
  const parts = k.wheels({ x: .74, front: 1.45, rear: -1.3, radius: R, width: .24, hub: 'mag', hubMaterial: new THREE.MeshStandardMaterial({ color: 0x5b626b, metalness: .7, roughness: .35 }) });
  return k.finish({ ...parts, driverSteeringWheel }, scale, R, [0, 1.0, -.3]);
}

const BUILDERS = { cinquino: buildCinquino, spider: buildSpider, pulmino: buildPulmino, muscle: buildMuscle };
export const ROAD_VEHICLE_IDS = Object.keys(BUILDERS);

// colors: { primary, secondary? }; opts: { scale, detail }.
export function buildRoadVehicle(id, colors = {}, opts = {}) {
  const build = BUILDERS[id];
  if (!build) throw new Error(`unknown vehicle ${id}`);
  return build(colors, opts);
}
