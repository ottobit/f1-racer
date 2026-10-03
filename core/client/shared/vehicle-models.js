import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// Road cars (#311, #313, #315): round period road cars, not F1 cars.
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

// Rounds an extruded body, which is otherwise flat-sided: narrows it towards
// nose and tail in plan view (`pinch`, by (z/halfLength)^4), pulls the sides
// in above `shoulder` up to `top` (`tumble`, tumblehome) and tucks the sill
// below `sill`. Returns the same x mapping so trim can sit on the surface.
function bodyShaper({ halfLength, pinch = 0, shoulder = .5, top = .9, tumble = 0, sill = .4, tuck = 0 }) {
  const factor = (y, z) => {
    const zn = Math.min(Math.abs(z) / halfLength, 1);
    let f = 1 - pinch * zn ** 4;
    if (y > shoulder) f *= 1 - tumble * Math.min((y - shoulder) / (top - shoulder), 1);
    if (y < sill) f *= 1 - tuck * Math.min((sill - y) / .15, 1);
    return f;
  };
  return {
    x: (x, y, z) => x * factor(y, z),
    apply(geometry) {
      const pos = geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * factor(pos.getY(i), pos.getZ(i)));
      pos.needsUpdate = true;
      geometry.computeVertexNormals();
      return geometry;
    },
  };
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
  // With detail the tyre is a lathed profile (rounded shoulders, a rim
  // inside) and 'wire' hubs get their spokes; without, plain cylinders.
  function tyreGeometry(radius, width) {
    if (!detail) return new THREE.CylinderGeometry(radius, radius, width, segments);
    const hw = width / 2, rim = radius * .64;
    const profile = [
      [rim, -hw * .86], [radius * .84, -hw], [radius * .96, -hw * .9], [radius, -hw * .62],
      [radius, hw * .62], [radius * .96, hw * .9], [radius * .84, hw], [rim, hw * .86],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(profile, segments);
  }
  function wheels({ x, front, rear, radius, width = .17, hub = 'cap', hubMaterial = mats.chrome, whitewall = false }) {
    const steeringPivots = [];
    const list = [[x, front], [-x, front], [x, rear], [-x, rear]].map(([px, pz], index) => {
      const pivot = new THREE.Group();
      pivot.position.set(px, radius, pz);
      group.add(pivot);
      const wheel = new THREE.Group();
      pivot.add(wheel);
      if (index < 2) steeringPivots.push(pivot);
      const tyre = mesh(tyreGeometry(radius, width), mats.rubber, [0, 0, 0], wheel);
      tyre.rotation.z = Math.PI / 2;
      const side = Math.sign(px);
      const face = side * width / 2;
      if (detail) {
        const rim = mesh(new THREE.CylinderGeometry(radius * .65, radius * .65, width * .84, segments), hub === 'wire' ? mats.dark : hubMaterial, [0, 0, 0], wheel);
        rim.rotation.z = Math.PI / 2;
        rim.name = 'rim';
      }
      if (hub === 'wire' && detail) {
        // Wire wheel: chrome rim band, laced spokes, a two-eared knock-off.
        const band = mesh(new THREE.TorusGeometry(radius * .62, .016, 6, segments), mats.chrome, [face * .96, 0, 0], wheel);
        band.rotation.y = Math.PI / 2;
        for (let i = 0; i < 16; i++) {
          const a = i / 16 * Math.PI * 2, inner = i % 2 ? .3 : -.3;
          rod([face * inner, Math.cos(a + .2) * .035, Math.sin(a + .2) * .035], [face * .95, Math.cos(a) * radius * .6, Math.sin(a) * radius * .6], .005, mats.chrome, wheel);
        }
        const nut = mesh(new THREE.CylinderGeometry(.035, .045, .05, 8), mats.chrome, [face + side * .02, 0, 0], wheel);
        nut.rotation.z = Math.PI / 2;
        box(.025, .15, .03, mats.chrome, [face + side * .04, 0, 0], wheel).name = 'knockOff';
      } else {
        const cap = mesh(new THREE.SphereGeometry(radius * .57, segments, 10, 0, Math.PI * 2, 0, Math.PI / 2), hub === 'wire' ? mats.chrome : hubMaterial, [face, 0, 0], wheel);
        cap.rotation.z = -side * Math.PI / 2;
        cap.scale.set(1, hub === 'flat' ? .12 : .28, 1);
      }
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
  // Detail-only trim (player car, cockpit, showroom; not the AI field):
  // a dark panel gap along points, a wiper from base to tip, a blank plate
  // facing +z (dir 1) or -z (dir -1).
  function seam(points, r = .006) {
    if (!detail) return;
    for (let n = 1; n < points.length; n++) rod(points[n - 1], points[n], r, mats.dark).name = 'seam';
  }
  function wiper(base, tip) {
    if (!detail) return;
    rod(base, tip, .008, mats.dark).name = 'wiper';
  }
  function plate(y, z, dir = 1, w = .36) {
    if (!detail) return;
    box(w + .03, .13, .012, mats.dark, [0, y, z]).name = 'plateFrame';
    box(w, .1, .012, mats.ivory, [0, y, z + dir * .004]).name = 'plate';
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
  return { group, segments, detail, mats, mesh, box, rod, roundLamp, wheels, seam, wiper, plate, steeringWheel, finish };
}

// Cinquino (#311, #315): round 1960s city car, rear engine, canvas roof
// rolled back. The shaper gives it the bubble plan and tumblehome; trim is
// placed through shape.x() so it sits on the curved sides.
function buildCinquino({ primary = 0x5c371f } = {}, { scale = 1, detail = false } = {}) {
  const k = createKit(detail);
  const { mats, mesh, box, rod } = k;
  const paint = paintMaterial(primary, 'primary');
  const R = .27, BEVEL = .08, WIDTH = 1.18;
  const shape = bodyShaper({ halfLength: 1.46, pinch: .3, shoulder: .5, top: .86, tumble: .1, sill: .42, tuck: .08 });
  const glassShape = bodyShaper({ halfLength: 1.0, pinch: .12, shoulder: .8, top: 1.3, tumble: .14 });
  mesh(shape.apply(extrudeAcross(outline([-1.24, .26], [
    [-1.38, .27, -1.37, .48], [-1.35, .74, -1.0, .78], [.5, .78],
    [.96, .77, 1.22, .62], [1.38, .52, 1.36, .38], [1.33, .26, 1.2, .26],
  ], { bottom: .26, axles: [.88, -.88], wheelRadius: R, radius: .39 }), WIDTH, BEVEL)), paint).name = 'cityBody';
  mesh(glassShape.apply(extrudeAcross(outline([-.93, .79], [[-.74, 1.2], [-.68, 1.29, -.5, 1.3], [.08, 1.31], [.22, 1.31, .28, 1.2], [.56, .79]]), .98, .06)), mats.glass).name = 'cityGlass';
  mesh(glassShape.apply(extrudeAcross(outline([-.74, 1.18], [[-.68, 1.3], [-.6, 1.36, -.46, 1.36], [.1, 1.37], [.24, 1.35, .29, 1.18]]), 1.0, .05)), paint).name = 'roof';
  // Canvas sunroof, rolled back in a bundle over the rear seats.
  box(.62, .015, .56, new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: .95 }), [0, 1.415, -.12]).name = 'roofOpening';
  const roll = mesh(new THREE.CylinderGeometry(.055, .055, .66, k.segments), new THREE.MeshStandardMaterial({ color: 0x3a2c21, roughness: .95 }), [0, 1.44, -.43]);
  roll.name = 'roofCanvas';
  roll.rotation.z = Math.PI / 2;

  const sideAt = (y, z) => shape.x(WIDTH / 2 + BEVEL, y, z);
  for (const side of [-1, 1]) {
    rod([side * glassShape.x(.55, .84, .6), .84, .6], [side * glassShape.x(.55, 1.29, .25), 1.29, .25], .035, paint);
    rod([side * glassShape.x(.56, .84, -.3), .84, -.3], [side * glassShape.x(.56, 1.33, -.3), 1.33, -.3], .03, paint);
    rod([side * glassShape.x(.56, .84, -.93), .84, -.93], [side * glassShape.x(.56, 1.25, -.72), 1.25, -.72], .04, paint);
    // Chrome belt line and door handle on the curved flank.
    const belt = [];
    for (let z = -1.0; z <= .62; z += .18) belt.push([side * (sideAt(.78, z) + .006), .78, z]);
    for (let n = 1; n < belt.length; n++) rod(belt[n - 1], belt[n], .011, mats.chrome);
    box(.03, .03, .12, mats.chrome, [side * (sideAt(.68, -.15) + .01), .68, -.15]).name = 'doorHandle';
    const mirror = mesh(new THREE.SphereGeometry(.055, 12, 8), mats.chrome, [side * .7, .93, .5]);
    mirror.scale.set(1, .75, .55);
    rod([side * (sideAt(.84, .52) - .02), .84, .53], [side * .69, .93, .5], .011, mats.chrome);
    // Big round headlamps standing proud on the front wings.
    k.roundLamp(side * .4, .6, 1.33, .12);
    const indicator = mesh(new THREE.SphereGeometry(.035, 10, 8), mats.amber, [side * .36, .42, 1.42]);
    indicator.scale.set(1.5, .8, .6);
    // The chrome "moustache": two swept whiskers from the nose badge.
    rod([side * .05, .5, 1.45], [side * .2, .55, 1.43], .016, mats.chrome).name = 'frontMoustache';
    rod([side * .2, .55, 1.43], [side * .3, .52, 1.4], .014, mats.chrome).name = 'frontMoustache';
    box(.06, .14, .04, mats.tail, [side * .38, .56, -1.43]).name = 'tailLamp';
  }
  const badge = mesh(new THREE.CylinderGeometry(.05, .05, .02, k.segments), mats.chrome, [0, .5, 1.455]);
  badge.rotation.x = Math.PI / 2;
  // Slim bumpers hugging the narrow nose and tail.
  for (const z of [1.5, -1.5]) {
    rod([-.42, .3, z], [.42, .3, z], .026, mats.chrome);
    for (const side of [-1, 1]) rod([side * .42, .3, z], [side * .52, .3, z - Math.sign(z) * .14], .024, mats.chrome);
  }
  for (let i = 0; i < 6; i++) box(.4, .012, .02, mats.dark, [0, .52 + i * .032, -1.44 + i * .003]).name = 'engineSlat';
  const exhaust = mesh(new THREE.CylinderGeometry(.03, .03, .14, 10), mats.chrome, [.26, .22, -1.4]);
  exhaust.rotation.x = Math.PI / 2;

  // The body is solid up to the belt line (y ~.86): dashboard and wheel sit
  // above it, on the centreline in front of the default cockpit eye.
  box(.96, .06, .1, paint, [0, .89, .52]).name = 'dashboard';
  box(.22, .05, .06, mats.dark, [0, .94, .49]).name = 'dashboardBinnacle';
  const driverSteeringWheel = k.steeringWheel({ pos: [0, .91, .42], tilt: -.6, rim: mats.ivory, column: [[0, .88, .44], [0, .83, .55]] });
  for (const side of [-1, 1]) {
    box(.4, .1, .42, mats.seat, [side * .27, .45, -.2]).name = 'seat';
    const back = box(.38, .5, .08, mats.seat, [side * .27, .74, -.43]);
    back.name = 'seatBack';
    back.rotation.x = -.15;
  }
  const parts = k.wheels({ x: .56, front: .88, rear: -.88, radius: R, width: .15, whitewall: true });
  return k.finish({ ...parts, driverSteeringWheel }, scale, R);
}

// Pandina (#315): boxy early-1980s city car. Flat panels, tall glasshouse,
// grey plastic bumpers and side strips, square lamps, upright tail.
function buildPandina({ primary = 0xf1f1ee } = {}, { scale = 1, detail = false } = {}) {
  const k = createKit(detail);
  const { mats, mesh, box, rod } = k;
  const paint = paintMaterial(primary, 'primary');
  const plastic = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: .85 });
  const R = .29, BEVEL = .05, WIDTH = 1.36;
  const shape = bodyShaper({ halfLength: 1.7, pinch: .04 });
  mesh(shape.apply(extrudeAcross(outline([-1.6, .27], [
    [-1.65, .28, -1.65, .4], [-1.65, .84], [.7, .84], [1.55, .74], [1.66, .72, 1.66, .6],
    [1.66, .36], [1.66, .27, 1.56, .27],
  ], { bottom: .27, axles: [1.05, -1.0], wheelRadius: R, radius: .4 }), WIDTH, BEVEL)), paint).name = 'pandinaBody';
  mesh(extrudeAcross(outline([-1.62, .86], [[-1.6, 1.36], [.35, 1.38], [.78, .86]]), 1.28, .05), mats.glass).name = 'pandinaGlass';
  mesh(extrudeAcross(outline([-1.62, 1.32], [[-1.62, 1.42], [.36, 1.44], [.42, 1.34]]), 1.32, .05), paint).name = 'roof';
  const sideX = WIDTH / 2 + BEVEL;
  for (const side of [-1, 1]) {
    rod([side * .68, .88, .76], [side * .67, 1.38, .37], .045, paint);
    rod([side * .69, .88, -.15], [side * .68, 1.4, -.15], .04, paint);
    box(.04, .5, .32, paint, [side * .68, 1.13, -1.42]).name = 'cPillar';
    box(.035, .15, 2.7, plastic, [side * (sideX + .012), .4, .03]).name = 'sideStrip';
    box(.03, .04, .14, plastic, [side * (sideX + .01), .74, -.2]).name = 'doorHandle';
    const mirror = box(.05, .1, .12, plastic, [side * .78, .98, .66]);
    mirror.name = 'mirror';
    // Square headlamps and vertical rear lamp clusters.
    box(.26, .13, .03, mats.lens, [side * .48, .62, 1.7]).name = 'headLamp';
    box(.08, .1, .03, mats.amber, [side * .69, .62, 1.69]).name = 'indicator';
    box(.12, .24, .04, mats.tail, [side * .58, .62, -1.69]).name = 'tailLamp';
  }
  // Grey grille between the lamps, wraparound plastic bumpers.
  box(.58, .13, .025, plastic, [0, .62, 1.7]).name = 'grille';
  for (let i = 0; i < 4; i++) box(.54, .012, .03, mats.dark, [0, .575 + i * .03, 1.71]).name = 'grilleSlat';
  box(1.5, .18, .12, plastic, [0, .36, 1.68]).name = 'bumper';
  box(1.5, .18, .12, plastic, [0, .36, -1.68]).name = 'bumper';
  box(.3, .08, .02, mats.dark, [0, .5, -1.7]).name = 'plateRecess';
  // Shelf dashboard, upright wheel; the eye sits higher in the tall cabin.
  box(1.24, .07, .2, plastic, [0, .96, .62]).name = 'dashboard';
  const driverSteeringWheel = k.steeringWheel({ pos: [0, 1.0, .4], tilt: -.5, radius: .15, column: [[0, .97, .42], [0, .92, .58]] });
  for (const side of [-1, 1]) {
    const back = box(.42, .48, .08, mats.seat, [side * .32, .98, -.45]);
    back.name = 'seatBack';
    back.rotation.x = -.15;
  }
  const parts = k.wheels({ x: .64, front: 1.05, rear: -1.0, radius: R, hubMaterial: plastic });
  return k.finish({ ...parts, driverSteeringWheel }, scale, R, [0, 1.12, -.1]);
}

// Familiare (#315): 1960s estate with wood side panels and a roof rack.
function buildFamiliare({ primary = 0x2f6b4a } = {}, { scale = 1, detail = false } = {}) {
  const k = createKit(detail);
  const { mats, mesh, box, rod } = k;
  const paint = paintMaterial(primary, 'primary');
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: .6 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xe6d6b0, roughness: .5 });
  const R = .3, BEVEL = .07, WIDTH = 1.3;
  const shape = bodyShaper({ halfLength: 1.92, pinch: .1, shoulder: .55, top: .89, tumble: .05 });
  mesh(shape.apply(extrudeAcross(outline([-1.75, .28], [
    [-1.85, .3, -1.85, .48], [-1.83, .78], [-1.7, .82], [.6, .82], [1.2, .78],
    [1.7, .7, 1.82, .52], [1.86, .36, 1.76, .28],
  ], { bottom: .28, axles: [1.15, -1.05], wheelRadius: R, radius: .42 }), WIDTH, BEVEL)), paint).name = 'familiareBody';
  mesh(extrudeAcross(outline([-1.8, .84], [[-1.78, 1.3], [.2, 1.32], [.68, .84]]), 1.2, .05), mats.glass).name = 'familiareGlass';
  mesh(extrudeAcross(outline([-1.8, 1.27], [[-1.8, 1.36], [.2, 1.39], [.28, 1.28]]), 1.26, .05), paint).name = 'roof';
  const sideAt = (y, z) => shape.x(WIDTH / 2 + BEVEL, y, z);
  for (const side of [-1, 1]) {
    for (const [z0, z1, top] of [[.66, .22, 1.31], [-.3, -.3, 1.37], [-1.0, -1.0, 1.37], [-1.76, -1.76, 1.36]]) {
      rod([side * .64, .86, z0], [side * .62, top, z1], .04, paint);
    }
    // Wood panel framed in cream along each flank.
    box(.02, .26, 2.9, wood, [side * (sideAt(.6, -.2) + .012), .6, -.2]).name = 'woodPanel';
    for (const y of [.46, .74]) box(.026, .03, 2.92, trim, [side * (sideAt(y, -.2) + .016), y, -.2]).name = 'woodFrame';
    k.roundLamp(side * .5, .58, 1.82, .1);
    box(.06, .14, .04, mats.tail, [side * .58, .64, -1.91]).name = 'tailLamp';
    const mirror = mesh(new THREE.SphereGeometry(.055, 12, 8), mats.chrome, [side * .74, .92, .6]);
    mirror.scale.set(1, .75, .55);
    // Roof rack rails.
    rod([side * .5, 1.47, -1.6], [side * .5, 1.47, .0], .018, mats.chrome);
    for (const z of [-1.6, 0]) rod([side * .5, 1.42, z], [side * .5, 1.47, z], .015, mats.chrome);
  }
  for (const z of [-1.3, -.8, -.3]) rod([-.5, 1.47, z], [.5, 1.47, z], .015, mats.chrome);
  for (let i = 0; i < 3; i++) rod([-.36, .38 + i * .05, 1.88], [.36, .38 + i * .05, 1.88], .012, mats.chrome);
  for (const z of [1.94, -1.93]) rod([-.66, .3, z], [.66, .3, z], .028, mats.chrome);
  box(.96, .06, .1, paint, [0, .89, .55]).name = 'dashboard';
  const driverSteeringWheel = k.steeringWheel({ pos: [0, .93, .42], tilt: -.6, radius: .15, column: [[0, .9, .45], [0, .85, .56]] });
  for (const side of [-1, 1]) {
    const back = box(.42, .46, .08, mats.seat, [side * .3, .95, -.45]);
    back.name = 'seatBack';
    back.rotation.x = -.15;
  }
  box(1.1, .42, .08, mats.seat, [0, .95, -1.1]).name = 'bench';
  const parts = k.wheels({ x: .63, front: 1.15, rear: -1.05, radius: R, whitewall: true });
  return k.finish({ ...parts, driverSteeringWheel }, scale, R);
}

// Spider (#325): open two-seat 1960s roadster. Rounded plan and flanks,
// crested wings over the wheels, faired headlamps, twin headrest humps
// behind the seats, wire wheels.
function buildSpider({ primary = 0xb3121b } = {}, { scale = 1, detail = false } = {}) {
  const k = createKit(detail);
  const { mats, mesh, box, rod } = k;
  const paint = paintMaterial(primary, 'primary');
  const leather = new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: .75 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: .5 });
  const R = .31, BEVEL = .07, WIDTH = 1.3;
  const shape = bodyShaper({ halfLength: 2.0, pinch: .22, shoulder: .45, top: .75, tumble: .08, sill: .4, tuck: .08 });
  mesh(shape.apply(extrudeAcross(outline([-1.8, .27], [
    [-1.95, .29, -1.93, .47], [-1.9, .66, -1.6, .68], [.4, .68], [1.0, .66],
    [1.75, .62, 1.9, .46], [1.98, .34, 1.86, .27],
  ], { bottom: .27, axles: [1.2, -1.15], wheelRadius: R, radius: .43 }), WIDTH, BEVEL)), paint).name = 'spiderBody';
  const sideAt = (y, z) => shape.x(WIDTH / 2 + BEVEL, y, z);
  // Wing crests over the front wheels and haunches over the rear ones (both
  // clear of the tyre tops at 2R), a low bulge on the bonnet: squashed
  // spheres sunk into the body.
  const bulge = (pos, size, name) => {
    const m = mesh(new THREE.SphereGeometry(1, k.segments, 12), paint, pos);
    m.scale.set(...size);
    m.name = name;
  };
  for (const side of [-1, 1]) {
    bulge([side * .5, .72, 1.22], [.2, .09, .62], 'wingCrest');
    bulge([side * .52, .72, -1.12], [.2, .09, .56], 'rearHaunch');
    // Headrest humps behind the seats, faired into the rear deck.
    bulge([side * .3, .74, -1.25], [.17, .15, .48], 'headrestHump');
  }
  bulge([0, .72, .95], [.22, .05, .42], 'bonnetBulge');
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
  // Faired round headlamps, oval grille, slim bumpers, round tail lamps.
  for (const side of [-1, 1]) {
    k.roundLamp(side * .52, .6, 1.74);
    if (detail) {
      const fairing = mesh(new THREE.SphereGeometry(.13, k.segments, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass, [side * .52, .6, 1.74]);
      fairing.rotation.x = Math.PI / 2;
      fairing.scale.set(1, 1.5, .8);
      fairing.name = 'lampFairing';
      // Three vents behind each front wheel.
      for (let i = 0; i < 3; i++) box(.012, .025, .16, mats.dark, [side * (sideAt(.5, .62) + .004), .44 + i * .05, .62]).name = 'sideVent';
    }
    const tail = mesh(new THREE.SphereGeometry(.055, 10, 8), mats.tail, [side * .44, .55, -1.97]);
    tail.scale.set(1, 1, .5);
    const mirror = mesh(new THREE.SphereGeometry(.05, 12, 8), mats.chrome, [side * .62, .82, .32]);
    mirror.scale.set(1, .75, .55);
    // Bumper ends wrapping round the pinched nose and tail.
    rod([side * .62, .3, 1.88], [side * .48, .3, 2.02], .022, mats.chrome);
    rod([side * .58, .3, -1.88], [side * .44, .3, -1.99], .022, mats.chrome);
    // Door shut lines and the wipers' arms.
    k.seam([[side * (sideAt(.34, .35) + .004), .34, .35], [side * (sideAt(.66, .35) + .002), .66, .35]]);
    k.seam([[side * (sideAt(.34, -.62) + .004), .34, -.62], [side * (sideAt(.66, -.62) + .002), .66, -.62]]);
    k.wiper([side * .32, .78, .525], [side * .32 + .22, .84, .49]);
  }
  k.seam([[-.5, .752, .58], [.5, .752, .58]]);
  const grille = mesh(new THREE.CylinderGeometry(.18, .18, .04, k.segments), mats.dark, [0, .42, 1.97]);
  grille.rotation.x = Math.PI / 2;
  grille.scale.set(1.5, 1, .65);
  const surround = mesh(new THREE.TorusGeometry(.18, .014, 6, k.segments), mats.chrome, [0, .42, 1.99]);
  surround.scale.set(1.5, .65, 1);
  rod([-.48, .3, 2.02], [.48, .3, 2.02], .022, mats.chrome);
  rod([-.44, .3, -1.99], [.44, .3, -1.99], .022, mats.chrome);
  for (const side of [-1, 1]) {
    const pipe = mesh(new THREE.CylinderGeometry(.03, .03, .16, 10), mats.chrome, [side * .2, .24, -1.95]);
    pipe.rotation.x = Math.PI / 2;
  }
  k.plate(.43, -2.0, -1, .32);
  // Wood-rimmed wheel and a painted dash under the screen.
  box(1.15, .06, .1, paint, [0, .79, .42]).name = 'dashboard';
  const driverSteeringWheel = k.steeringWheel({ pos: [0, .87, .12], tilt: -.7, radius: .15, rim: wood, column: [[0, .84, .15], [0, .79, .38]] });
  const parts = k.wheels({ x: .66, front: 1.2, rear: -1.15, radius: R, hub: 'wire' });
  return k.finish({ ...parts, driverSteeringWheel }, scale, R, [0, 1.0, -.45]);
}

// Pulmino (#321): the split-window 1960s rear-engined van — two-tone body,
// a big V on the nose, a plain round disc (no badge), split windscreen and
// engine louvres behind the rear wheels.
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
  // Nose: the V in the upper colour, the round disc at its point, and the
  // centre post of the split windscreen.
  const vee = new THREE.Shape();
  vee.moveTo(-.62, .86);
  vee.lineTo(-.44, .86);
  vee.lineTo(0, .6);
  vee.lineTo(.44, .86);
  vee.lineTo(.62, .86);
  vee.lineTo(0, .5);
  vee.closePath();
  mesh(new THREE.ShapeGeometry(vee), white, [0, 0, 1.645]).name = 'noseVee';
  const disc = mesh(new THREE.CylinderGeometry(.1, .1, .03, 24), mats.chrome, [0, .5, 1.65]);
  disc.rotation.x = Math.PI / 2;
  disc.name = 'noseDisc';
  rod([0, .9, 1.61], [0, 1.47, 1.5], .03, white);
  // Engine louvres behind the rear wheels, and the engine lid at the back.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      box(.02, .025, .3, mats.dark, [side * .715, .78 - i * .06, -1.38]).name = 'louvre';
    }
  }
  box(.9, .32, .02, paint, [0, .58, -1.66]).name = 'engineLid';
  rod([-.1, .6, -1.68], [.1, .6, -1.68], .015, mats.chrome);
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

const BUILDERS = { cinquino: buildCinquino, pandina: buildPandina, spider: buildSpider, pulmino: buildPulmino, muscle: buildMuscle, familiare: buildFamiliare };
export const ROAD_VEHICLE_IDS = Object.keys(BUILDERS);

// colors: { primary, secondary? }; opts: { scale, detail }.
export function buildRoadVehicle(id, colors = {}, opts = {}) {
  const build = BUILDERS[id];
  if (!build) throw new Error(`unknown vehicle ${id}`);
  return build(colors, opts);
}
