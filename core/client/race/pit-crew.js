import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { PIT_LANE, pitLanePose } from "../shared/pit-lane.js?v=3";

// Pit crew: removers and fitters handle two distinct wheel sets. The used
// set stays in the garage after the fresh set is attached to the car.
// Positions live in the selected team's box frame, centred where the car
// stops on the apron (+z along the lane, +x away from the track for side +1).
// Crews sit in their garage watching the race; the player's crew stands up
// and carries the tyres out when the box is called (#258).

const smooth = (t) => { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); };

// Shared low-poly parts: rounded capsules instead of stacked boxes, so the
// crew reads as people in race suits. Each mechanic is a hip pivot (torso,
// arms, helmet) over two swinging legs.
const parts = {
  leg: new THREE.CapsuleGeometry(0.075, 0.34, 4, 8),
  torso: new THREE.CapsuleGeometry(0.15, 0.26, 4, 10),
  arm: new THREE.CapsuleGeometry(0.055, 0.28, 4, 8),
  head: new THREE.SphereGeometry(0.13, 14, 10),
  visor: new THREE.SphereGeometry(0.132, 14, 8, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.32, Math.PI * 0.26),
  boot: new THREE.BoxGeometry(0.12, 0.07, 0.2),
  gun: new THREE.CylinderGeometry(0.045, 0.045, 0.26, 10),
  jack: new THREE.BoxGeometry(0.06, 0.06, 0.9),
  tyre: new THREE.CylinderGeometry(0.34, 0.34, 0.36, 18),
  rim: new THREE.CylinderGeometry(0.2, 0.2, 0.37, 12),
  stool: new THREE.CylinderGeometry(0.16, 0.16, 0.38, 10),
};
const shared = {
  dark: new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.7 }),
  helmet: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.35 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x0c1116, roughness: 0.15, metalness: 0.4 }),
  tool: new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.4, metalness: 0.6 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
};

function mechanic(suit, tool, shadows = true) {
  const group = new THREE.Group();
  group.scale.setScalar(0.88); // about as tall as the old block figures
  const add = (parent, geometry, material, x, y, z, rx = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.castShadow = shadows;
    parent.add(mesh);
    return mesh;
  };
  const legs = [-0.09, 0.09].map((x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.52, 0);
    group.add(pivot);
    add(pivot, parts.leg, suit, 0, -0.24, 0);
    add(pivot, parts.boot, shared.dark, 0, -0.49, 0.03);
    return pivot;
  });
  const hips = new THREE.Group();
  hips.position.y = 0.52;
  group.add(hips);
  add(hips, parts.torso, suit, 0, 0.26, 0);
  const helmet = add(hips, parts.head, shared.helmet, 0, 0.66, 0.01);
  add(helmet, parts.visor, shared.visor, 0, 0, 0);
  // Arms reach forward, as if holding the tool.
  for (const x of [-0.2, 0.2]) add(hips, parts.arm, suit, x, 0.3, 0.12, -1.1);
  if (tool === "gun") add(hips, parts.gun, shared.tool, 0, 0.22, 0.34, Math.PI / 2).name = "wheelGun";
  if (tool === "jack") add(hips, parts.jack, shared.tool, 0, 0.12, 0.5, 0.35);
  return { group, legs, hips };
}

// Seated (sit = 1), crouched at the wheel, or walking (swing).
function pose(member, sit, crouch = 0, swing = 0) {
  const y = 0.52 - 0.2 * crouch - 0.08 * sit;
  member.hips.position.y = y;
  member.hips.rotation.x = 0.45 * crouch;
  member.legs[0].position.y = member.legs[1].position.y = y;
  member.legs[0].rotation.x = swing - 0.9 * crouch - 1.25 * sit;
  member.legs[1].rotation.x = -swing + 0.3 * crouch - 1.25 * sit;
}

// Other teams' crews sit on stools in their garage watching the race, with
// two stacks of fresh tyres by the garage mouth.
function waitingCrews(scene, pitLane, faceX) {
  const out = pitLane.side;
  const group = new THREE.Group();
  group.name = "waitingPitCrews";
  scene.add(group);
  const stools = [], tyres = [];
  const slot = new THREE.Object3D();
  for (const box of pitLane.boxes) {
    if (box.index === pitLane.boxIndex) continue;
    const suit = new THREE.MeshStandardMaterial({ color: box.team.primary, roughness: 0.75 });
    const bay = new THREE.Group();
    bay.position.set(
      box.x + Math.cos(box.heading) * PIT_LANE.bay * out, 0,
      box.z - Math.sin(box.heading) * PIT_LANE.bay * out,
    );
    bay.rotation.y = box.heading;
    group.add(bay);
    bay.add(slot);
    for (let index = 0; index < 7; index++) {
      const member = mechanic(suit, null, false);
      member.group.position.set(out * (faceX + 2.4), 0, (index - 3) * 0.95);
      member.group.rotation.y = -out * Math.PI / 2;
      pose(member, 1);
      bay.add(member.group);
      slot.position.set(out * (faceX + 2.4), 0.19, (index - 3) * 0.95);
      slot.updateMatrixWorld(true);
      stools.push(slot.matrixWorld.clone());
    }
    for (const z of [-3.1, 3.1]) {
      for (let k = 0; k < 4; k++) {
        slot.position.set(out * (faceX + 1.2), 0.18 + k * 0.36, z);
        slot.updateMatrixWorld(true);
        tyres.push(slot.matrixWorld.clone());
      }
    }
    bay.remove(slot);
  }
  for (const [geometry, material, matrices] of [[parts.stool, shared.dark, stools], [parts.tyre, shared.rubber, tyres]]) {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((matrix, k) => mesh.setMatrixAt(k, matrix));
    group.add(mesh);
  }
}

export function setupPitCrew({ scene, pitLane, playerCar, suitColor, serviceMs }) {
  const w = PIT_LANE.halfWidth, out = pitLane.side;
  const box = pitLanePose(pitLane, pitLane.boxDist);
  // Garage face, measured from the car's stop position on the apron.
  const faceX = w + PIT_LANE.apron - PIT_LANE.bay;
  waitingCrews(scene, pitLane, faceX);
  const frame = new THREE.Group();
  frame.position.set(box.x, 0, box.z);
  frame.rotation.y = box.heading;
  scene.add(frame);

  const scale = playerCar.group.scale.x;
  const suit = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.75 });
  const crew = [];
  function addMember(x, z, role, index) {
    const body = mechanic(suit, role === "jack" ? "jack" : "gun");
    // Ready spot at the garage mouth, and a stool further in.
    const idle = new THREE.Vector3(out * (faceX + (role === "fitter" ? 1.1 : 0.4)), 0, -2.3 + index * 0.5);
    const seat = new THREE.Vector3(out * (faceX + 2.4), 0, (index - 4.5) * 0.95);
    const target = new THREE.Vector3(x, 0, z);
    body.group.position.copy(seat);
    body.group.rotation.y = -out * Math.PI / 2;
    frame.add(body.group);
    const stool = new THREE.Mesh(parts.stool, shared.dark);
    stool.position.set(seat.x, 0.19, seat.z);
    frame.add(stool);
    const member = { ...body, role, idle, seat, from: seat.clone(), target, stride: 0, last: seat.clone(), lastX: seat.x, lastZ: seat.z };
    crew.push(member);
    return member;
  }

  const compoundColors = { soft: 0xf04439, medium: 0xffcf32, hard: 0xf5f5f5 };
  const ringGeometry = new THREE.TorusGeometry(0.345, 0.012, 4, 24);
  function prepareWheel(wheel) {
    const material = new THREE.MeshStandardMaterial({ color: compoundColors.medium, roughness: 0.8 });
    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(ringGeometry, material);
      ring.rotation.y = Math.PI / 2;
      ring.position.x = side * 0.195;
      wheel.add(ring);
    }
    wheel.userData.pitCompoundMaterial = material;
  }
  function colorWheel(wheel, compound) {
    wheel.userData.pitCompoundMaterial.color.set(compoundColors[compound] || compoundColors.medium);
  }

  const stations = playerCar.wheels.map((wheel, index) => {
    const pivot = wheel.parent;
    const hub = pivot.position.clone().multiplyScalar(scale);
    const side = Math.sign(hub.x);
    // Clone before adding the sidewall rings so the two sets have independent
    // compound materials. Geometry is shared, never rebuilt during a stop.
    const spare = wheel.clone(true);
    prepareWheel(wheel);
    prepareWheel(spare);
    const remover = addMember(hub.x + side * 0.38, hub.z, "remover", index);
    const fitter = addMember(hub.x + side * 0.38, hub.z, "fitter", index + 4);
    frame.add(spare);
    spare.scale.setScalar(scale);
    // The spare set rests on the floor behind its fitter's stool.
    const rest = fitter.seat.clone().add(new THREE.Vector3(out * 0.6, 0.35 * scale, 0));
    spare.position.copy(rest);
    return { pivot, hub, side, spare, rest, holder: fitter, old: wheel, fresh: spare, remover, fitter, removed: false, fitted: false };
  });
  addMember(0, 1.65, "jack", 8);
  addMember(0, -1.6, "jack", 9);

  // Reach the far side around the nose/tail instead of walking through the car.
  function route(member, reach) {
    const { from: idle, target } = member;
    if (target.x * out >= 0.1) return member.group.position.lerpVectors(idle, target, reach);
    const end = Math.sign(target.z || 1) * 1.95;
    const a = new THREE.Vector3(idle.x, 0, end);
    const b = new THREE.Vector3(target.x, 0, end);
    if (reach < 0.25) return member.group.position.lerpVectors(idle, a, reach * 4);
    if (reach < 0.7) return member.group.position.lerpVectors(a, b, (reach - 0.25) / 0.45);
    return member.group.position.lerpVectors(b, target, (reach - 0.7) / 0.3);
  }

  const carried = new THREE.Vector3();
  function handPosition(member, side) {
    carried.copy(member.group.position);
    carried.x -= side * 0.16;
    carried.y = 0.52;
    return carried;
  }
  function fitWheel(station, index) {
    station.pivot.add(station.fresh);
    station.fresh.position.set(0, 0, 0);
    station.fresh.rotation.set(0, 0, 0);
    station.fresh.scale.setScalar(1);
    playerCar.wheels[index] = station.fresh;
    station.fitted = true;
    station.spare = station.old;
    station.holder = station.remover;
  }

  frame.updateMatrixWorld(true);
  const tvCamera = frame.localToWorld(new THREE.Vector3(-out * (w + 1.6 + PIT_LANE.bay), 3.2, 5.5));
  const tvTarget = new THREE.Vector3(box.x, 0.5, box.z);

  let active = false;
  let mountedCompound = "medium";
  // 0 = seated watching the race, 1 = standing ready at the garage mouth.
  let ready = 0, lastNow = null;
  // Called after applyCarToMesh, which resets the car's pose every frame.
  function update(state, now) {
    const servicing = state.pitState === "servicing";
    const dt = lastNow === null ? 0 : Math.min(Math.max((now - lastNow) / 1000, 0), 0.25);
    lastNow = now;
    const wanted = servicing || state.pitRequested || state.pitState === "entering";
    ready = wanted ? Math.min(1, ready + dt / 3) : Math.max(0, ready - dt / 4);
    const stand = smooth(ready / 0.3), walk = smooth((ready - 0.3) / 0.7);
    if (servicing && !active) {
      active = true;
      stations.forEach((station, index) => {
        station.old = playerCar.wheels[index];
        station.fresh = station.spare;
        station.removed = station.fitted = false;
        colorWheel(station.old, mountedCompound);
      });
    }
    // Complete even when a slow/background frame skips the mounting phase.
    const t = servicing ? Math.min(1, Math.max(0, 1 - (state.pitServiceEndTime - now) / serviceMs)) : active ? 1 : 0;
    const lift = active ? smooth((t - 0.12) / 0.08) * (1 - smooth((t - 0.83) / 0.07)) : 0;
    playerCar.group.position.y += 0.12 * lift;
    for (const member of crew) {
      const body = member.group;
      const reach = !active ? 0 : member.role === "remover"
        ? smooth(t / 0.18) * (1 - smooth((t - 0.36) / 0.25))
        : member.role === "fitter"
          ? smooth((t - 0.38) / 0.22) * (1 - smooth((t - 0.8) / 0.17))
          : smooth(t / 0.12) * (1 - smooth((t - 0.9) / 0.1));
      member.from.lerpVectors(member.seat, member.idle, walk);
      route(member, reach);
      // Walk: legs swing with the distance covered, then settle.
      const moved = body.position.distanceTo(member.last);
      member.last.copy(body.position);
      member.stride = moved > 1e-4 ? member.stride + moved * 9 : member.stride * 0.8;
      const swing = moved > 1e-4 ? Math.sin(member.stride) * 0.55 : 0;
      // Turn smoothly towards the car on the way in, back to the lane after.
      const heading = moved > 1e-4 && reach < 0.95
        ? Math.atan2(body.position.x - member.lastX, body.position.z - member.lastZ)
        : active ? Math.atan2(-member.target.x, 0) : -out * Math.PI / 2;
      member.lastX = body.position.x;
      member.lastZ = body.position.z;
      let turn = heading - body.rotation.y;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      body.rotation.y += turn * 0.25;
      // Crouch at the wheel: hips drop, torso leans in, knees forward.
      const crouch = member.role === "jack" ? 0.3 * reach : smooth((reach - 0.8) / 0.2);
      pose(member, 1 - stand, crouch, swing);
      const gun = body.getObjectByName("wheelGun");
      const tightening = active && (member.role === "remover" ? t >= 0.18 && t < 0.25 : t >= 0.74 && t < 0.8);
      if (gun) gun.rotation.y = tightening ? Math.sin(now * 0.08) * 0.15 : 0;
    }
    stations.forEach((station, index) => {
      if (!active) {
        colorWheel(playerCar.wheels[index], state.tyreCompound);
        // Carried out when the box is called, put down again once seated.
        if (stand < 0.01) station.holder = station.fitter;
        station.spare.rotation.set(0, 0, 0);
        station.spare.position.lerpVectors(station.rest, handPosition(station.holder, station.side), stand);
        return;
      }
      const { old, fresh, hub, side, remover, fitter } = station;
      colorWheel(fresh, state.tyreCompound);
      if (t >= 0.25 && !station.removed) {
        frame.add(old);
        old.rotation.set(0, 0, 0);
        old.scale.setScalar(scale);
        station.removed = true;
      }
      if (station.removed) {
        old.position.copy(hub); old.position.y += 0.12 * lift;
        old.position.lerp(handPosition(remover, side), smooth((t - 0.25) / 0.1));
      }
      if (!station.fitted) {
        fresh.rotation.set(0, 0, 0);
        fresh.scale.setScalar(scale);
        fresh.position.copy(handPosition(fitter, side));
        const install = smooth((t - 0.62) / 0.12);
        const raisedHub = hub.clone(); raisedHub.y += 0.12 * lift;
        fresh.position.lerp(raisedHub, install);
        if (t >= 0.74) fitWheel(station, index);
      }
    });
    if (!servicing) {
      mountedCompound = state.tyreCompound;
      active = false;
    }
  }

  return { update, tvCamera, tvTarget };
}
