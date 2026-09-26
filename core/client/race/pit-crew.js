import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { PIT_LANE } from "../shared/pit-lane.js?v=1";

// Pit crew (#147): six low-poly mechanics wait under the garage canopy and,
// while the player is in the box, run out, jack the car and swap all four
// wheels over the service time. Positions live in the box's local frame
// (+z along the lane, +x away from the track for side +1).

const smooth = (t) => { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); };

function mechanic(suitColor) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.8 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
  const parts = [
    [new THREE.BoxGeometry(0.34, 0.4, 0.22), dark, 0.2],
    [new THREE.BoxGeometry(0.42, 0.46, 0.26), suit, 0.62],
    [new THREE.SphereGeometry(0.14, 10, 8), helmet, 0.98],
  ];
  for (const [geometry, material, y] of parts) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
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
  const crew = work.map(([x, z], index) => {
    const body = mechanic(suitColor);
    const idle = new THREE.Vector3(out * (w + 1.5), 0, -2.5 + index);
    const target = new THREE.Vector3(x, 0, z);
    body.position.copy(idle);
    body.rotation.y = -out * Math.PI / 2;
    frame.add(body);
    return { body, idle, target, facing: Math.atan2(-x, -z) };
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
      member.body.position.lerpVectors(member.idle, member.target, reach);
      member.body.rotation.y = reach > 0.5 ? member.facing : -out * Math.PI / 2;
      // A crouch at the wheel once in place.
      member.body.scale.y = 1 - 0.25 * smooth((reach - 0.8) / 0.2);
    }
    const lift = servicing ? smooth((t - 0.15) / 0.08) * (1 - smooth((t - 0.78) / 0.07)) : 0;
    playerCar.group.position.y += 0.12 * lift;
    // Old wheels off, new wheels on.
    const off = servicing ? smooth((t - 0.25) / 0.12) * (1 - smooth((t - 0.5) / 0.15)) : 0;
    playerCar.wheels.forEach((wheel, index) => { wheel.position.x = wheelSide[index] * 0.55 * off; });
  }

  return { update, tvCamera, tvTarget };
}
