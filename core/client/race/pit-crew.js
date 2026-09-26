import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { PIT_LANE } from "../shared/pit-lane.js?v=1";

// Pit crew (#147): six low-poly mechanics wait in the garage and,
// while the player is in the box, run out, jack the car and swap all four
// wheels over the service time. Positions live in the box's local frame
// (+z along the lane, +x away from the track for side +1).

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
};
const shared = {
  dark: new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.7 }),
  helmet: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.35 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x0c1116, roughness: 0.15, metalness: 0.4 }),
  tool: new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.4, metalness: 0.6 }),
};

function mechanic(suit, tool) {
  const group = new THREE.Group();
  group.scale.setScalar(0.88); // about as tall as the old block figures
  const add = (parent, geometry, material, x, y, z, rx = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.castShadow = true;
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
  if (tool === "gun") add(hips, parts.gun, shared.tool, 0, 0.22, 0.34, Math.PI / 2);
  if (tool === "jack") add(hips, parts.jack, shared.tool, 0, 0.12, 0.5, 0.35);
  return { group, legs, hips };
}

export function setupPitCrew({ scene, pitLane, playerCar, suitColor, serviceMs }) {
  const w = PIT_LANE.halfWidth, out = pitLane.side;
  const box = pitLane.path[pitLane.boxIndex];
  const frame = new THREE.Group();
  frame.position.set(box.x, 0, box.z);
  frame.rotation.y = box.heading;
  scene.add(frame);

  // Wheel gunners at each corner, then the front and rear jack men.
  const work = [
    [1.3, 0.72], [-1.3, 0.72], [1.3, -0.72], [-1.3, -0.72], [0, 2.3], [0, -2.3],
  ];
  const suit = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.75 });
  const crew = work.map(([x, z], index) => {
    const body = mechanic(suit, index < 4 ? "gun" : "jack");
    const idle = new THREE.Vector3(out * (w + 1.5), 0, -2.5 + index);
    const target = new THREE.Vector3(x, 0, z);
    body.group.position.copy(idle);
    body.group.rotation.y = -out * Math.PI / 2;
    frame.add(body.group);
    return { ...body, idle, target, facing: Math.atan2(-x, -z), stride: 0, last: idle.clone() };
  });

  const wheelSide = playerCar.wheels.map((wheel) => Math.sign(wheel.parent.position.x) || 1);
  frame.updateMatrixWorld(true);
  const tvCamera = frame.localToWorld(new THREE.Vector3(-out * (w + 1.6), 3.2, 5.5));
  const tvTarget = new THREE.Vector3(box.x, 0.5, box.z);

  // Called after applyCarToMesh, which resets the car's pose every frame.
  function update(state, now) {
    const servicing = state.pitState === "servicing";
    const t = servicing ? 1 - (state.pitServiceEndTime - now) / serviceMs : 0;
    const reach = servicing ? smooth(t / 0.15) * (1 - smooth((t - 0.85) / 0.15)) : 0;
    for (const member of crew) {
      const body = member.group;
      body.position.lerpVectors(member.idle, member.target, reach);
      // Walk: legs swing with the distance covered, then settle.
      const moved = body.position.distanceTo(member.last);
      member.last.copy(body.position);
      member.stride = moved > 1e-4 ? member.stride + moved * 9 : member.stride * 0.8;
      const swing = moved > 1e-4 ? Math.sin(member.stride) * 0.55 : 0;
      // Turn smoothly towards the car on the way in, back to the lane after.
      const heading = reach > 0.5 ? member.facing : -out * Math.PI / 2;
      let turn = heading - body.rotation.y;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      body.rotation.y += turn * 0.25;
      // Crouch at the wheel: hips drop, torso leans in, knees forward.
      const crouch = smooth((reach - 0.8) / 0.2);
      member.hips.position.y = 0.52 - 0.2 * crouch;
      member.hips.rotation.x = 0.45 * crouch;
      member.legs[0].position.y = member.legs[1].position.y = 0.52 - 0.2 * crouch;
      member.legs[0].rotation.x = swing - 0.9 * crouch;
      member.legs[1].rotation.x = -swing + 0.3 * crouch;
    }
    const lift = servicing ? smooth((t - 0.15) / 0.08) * (1 - smooth((t - 0.78) / 0.07)) : 0;
    playerCar.group.position.y += 0.12 * lift;
    // Old wheels off, new wheels on.
    const off = servicing ? smooth((t - 0.25) / 0.12) * (1 - smooth((t - 0.5) / 0.15)) : 0;
    playerCar.wheels.forEach((wheel, index) => { wheel.position.x = wheelSide[index] * 0.55 * off; });
  }

  return { update, tvCamera, tvTarget };
}
