import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GARAGE_PARTS, loadGarageSetup, saveGarageSetup, setupEffects } from "./garage-setup.js";
const GARAGE_CAR_SCALE = 1.15;
function taperEnds(geometry, { frontW = 1, frontH = 1, rearW = 1, rearH = 1 } = {}) {
  const pos = geometry.attributes.position;
  let maxZ = 0;
  let minZ = 0;
  for (let i = 0; i < pos.count; i++) {
    maxZ = Math.max(maxZ, pos.getZ(i));
    minZ = Math.min(minZ, pos.getZ(i));
  }
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z > 0 && maxZ > 0) {
      const t = z / maxZ;
      pos.setX(i, pos.getX(i) * (1 - t * (1 - frontW)));
      pos.setY(i, pos.getY(i) * (1 - t * (1 - frontH)));
    } else if (z < 0 && minZ < 0) {
      const t = z / minZ;
      pos.setX(i, pos.getX(i) * (1 - t * (1 - rearW)));
      pos.setY(i, pos.getY(i) * (1 - t * (1 - rearH)));
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// Stylised open-wheel race car (own silhouette, not a licensed vehicle):
// tapered tub, nose cone, front/rear wings, side pods, four rolling wheels.
// Local +Z is "front" throughout, matching the heading convention above.
function buildCar(paintColor) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color: paintColor,
    roughness: 0.35,
    metalness: 0.15,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xcfcfcf,
    roughness: 0.3,
    metalness: 0.7,
  });

  const tub = new THREE.Mesh(
    // Tapers narrower and lower toward the nose (meets the cone below
    // without a hard step) and, more subtly, toward the tail too, instead
    // of staying a flat-sided slab along its whole length.
    taperEnds(new THREE.BoxGeometry(1.7, 0.5, 3, 4, 2, 8), {
      frontW: 0.4,
      frontH: 0.55,
      rearW: 0.8,
      rearH: 0.85,
    }),
    paint
  );
  tub.position.y = 0.42;
  group.add(tub);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 8), paint);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.38, 2.0);
  group.add(nose);

  const cockpit = new THREE.Mesh(
    // Canopy taper toward the front (like a windscreen sloping back) rather
    // than a plain rectangular block dropped onto the tub.
    taperEnds(new THREE.BoxGeometry(0.7, 0.32, 0.9, 2, 2, 4), { frontW: 0.65, frontH: 0.7 }),
    dark
  );
  cockpit.position.set(0, 0.78, 0.1);
  group.add(cockpit);

  for (const side of [1, -1]) {
    const pod = new THREE.Mesh(
      // Pinched in at both the inlet (front) and outlet (rear) ends —
      // widest at the middle — for the teardrop side-pod profile real F1
      // cars have, instead of a plain rectangular box.
      taperEnds(new THREE.BoxGeometry(0.4, 0.34, 1.3, 2, 2, 6), {
        frontW: 0.55,
        frontH: 0.65,
        rearW: 0.35,
        rearH: 0.5,
      }),
      paint
    );
    pod.position.set(0.68 * side, 0.4, -0.4);
    group.add(pod);
  }

  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.06, 0.4), accent);
  frontWing.position.set(0, 0.2, 2.35);
  frontWing.name = "frontWing";
  group.add(frontWing);
  // Endplates: the single detail that reads as "real wing" instead of "flat
  // slab" at a glance, closing off each end of the wing.
  for (const side of [1, -1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.42), accent);
    plate.position.set(0.925 * side, 0.22, 2.35);
    group.add(plate);
  }

  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.07, 0.45), dark);
  rearWing.position.set(0, 0.95, -1.55);
  rearWing.name = "rearWing";
  group.add(rearWing);
  for (const side of [1, -1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), dark);
    strut.position.set(0.65 * side, 0.72, -1.55);
    group.add(strut);

    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.47), dark);
    plate.position.set(0.86 * side, 0.95, -1.55);
    group.add(plate);
  }

  // Lightweight open-wheel details: enough silhouette/depth to read clearly
  // from the chase camera without importing a heavy external model.
  const carbon = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.5, metalness: 0.25 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x737982, roughness: 0.28, metalness: 0.8 });

  // Halo: three slim structural members around the cockpit.
  const haloTop = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.055, 6, 18, Math.PI), carbon);
  haloTop.rotation.x = Math.PI / 2;
  haloTop.rotation.z = Math.PI;
  haloTop.position.set(0, 1.02, 0.12);
  group.add(haloTop);
  const haloPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.55, 8), carbon);
  haloPillar.position.set(0, 0.83, 0.5);
  haloPillar.rotation.x = -0.18;
  group.add(haloPillar);

  // Engine cover / shark-fin profile gives the rear body a stronger silhouette.
  const engineCover = new THREE.Mesh(
    taperEnds(new THREE.BoxGeometry(0.38, 0.62, 1.55, 2, 3, 6), { frontW: 0.8, frontH: 0.8, rearW: 0.22, rearH: 0.35 }),
    paint
  );
  engineCover.position.set(0, 0.72, -0.72);
  group.add(engineCover);

  // Suspension wishbones are deliberately simple cylinders: visually rich,
  // cheap to render and independent from the gameplay collision model.
  function addSuspension(x, z, rear = false) {
    const innerZ = z + (rear ? 0.24 : -0.24);
    for (const y of [0.28, 0.52]) {
      const start = new THREE.Vector3(0.48 * Math.sign(x), y, innerZ);
      const end = new THREE.Vector3(x * 0.9, y - 0.04, z);
      const delta = end.clone().sub(start);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, delta.length(), 6), carbon);
      arm.position.copy(start).add(end).multiplyScalar(0.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
      group.add(arm);
    }
  }
  addSuspension(0.82, 1.05);
  addSuspension(-0.82, 1.05);
  addSuspension(0.82, -1.05, true);
  addSuspension(-0.82, -1.05, true);

  // Rear crash structure / exhaust detail, most visible in chase view.
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.34, 10), metal);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0, 0.55, -1.7);
  group.add(exhaust);

  // Second wing planes create depth without materially increasing footprint.
  const frontFlap = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.045, 0.22), accent);
  frontFlap.position.set(0, 0.27, 2.22);
  frontFlap.rotation.x = -0.12;
  group.add(frontFlap);
  const rearFlap = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.06, 0.25), dark);
  rearFlap.position.set(0, 1.08, -1.48);
  rearFlap.rotation.x = 0.12;
  group.add(rearFlap);

  // Driver helmet and aerodynamic floor details make the silhouette read as
  // a modern open-wheel car while staying lightweight enough for mobile.
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), accent);
  helmet.scale.set(1, 0.82, 1);
  helmet.position.set(0, 0.91, 0.05);
  group.add(helmet);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.055, 2.65), carbon);
  floor.position.set(0, 0.16, -0.08);
  group.add(floor);
  for (const side of [1, -1]) {
    const floorEdge = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 2.15), carbon);
    floorEdge.position.set(0.82 * side, 0.2, -0.12);
    group.add(floorEdge);
  }

  const wheelRadius = 0.4;
  const wheelPositions = [
    [0.82, wheelRadius, 1.05],
    [-0.82, wheelRadius, 1.05],
    [0.82, wheelRadius, -1.05],
    [-0.82, wheelRadius, -1.05],
  ];
  const wheels = wheelPositions.map(([x, y, z]) => {
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.3, 16),
      tireMat
    );
    tire.rotation.z = Math.PI / 2;
    wheel.add(tire);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.32, 10),
      rimMat
    );
    rim.rotation.z = Math.PI / 2;
    wheel.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.35, 10), dark);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    wheel.position.set(x, y, z);
    group.add(wheel);
    return wheel;
  });

  // Extra modern F1 cues: airbox, mirrors, diffuser and nose pylons. These are
  // visual only; collision/physics stay deliberately independent.
  const airbox = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 0.42, 10), paint);
  airbox.position.set(0, 1.08, -0.42); group.add(airbox);
  for (const side of [1, -1]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.11, 0.13), paint);
    mirror.position.set(0.58 * side, 0.86, 0.18); group.add(mirror);
    const mirrorStem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 6), carbon);
    mirrorStem.rotation.z = Math.PI / 2; mirrorStem.position.set(0.45 * side, 0.82, 0.18); group.add(mirrorStem);
    const nosePylon = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.38), carbon);
    nosePylon.position.set(0.25 * side, 0.25, 2.2); group.add(nosePylon);
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.65), carbon);
    diffuser.position.set(0.52 * side, 0.26, -1.42); diffuser.rotation.x = -0.18; group.add(diffuser);
  }

  group.scale.setScalar(GARAGE_CAR_SCALE);
  return { group, wheels, wheelRadius: wheelRadius * GARAGE_CAR_SCALE };
}
let setup=loadGarageSetup();
const host=document.getElementById("garage-canvas"), scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(36,1,0.1,100); camera.position.set(5.5,3.0,7.0); camera.lookAt(0,.55,0);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); host.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x151820,2.2)); const key=new THREE.DirectionalLight(0xffffff,2.5); key.position.set(4,6,5); scene.add(key);
const built=buildCar(0xe10600), car=built.group; scene.add(car);
function applyVisual(){const fw=car.getObjectByName("frontWing"),rw=car.getObjectByName("rearWing");if(fw)fw.rotation.x=setup.frontWing==="high"?-.16:setup.frontWing==="low"?.08:-.05;if(rw){rw.position.y=setup.rearWing==="high"?1.08:setup.rearWing==="low"?.86:.95;rw.rotation.x=setup.rearWing==="high"?-.18:setup.rearWing==="low"?.08:0}}
const labels={speed:"Velocità",downforce:"Carico",braking:"Frenata",stability:"Stabilità",traction:"Trazione"};
function renderUI(){const effects=setupEffects(setup),base={speed:50,downforce:50,braking:50,stability:50,traction:50};document.getElementById("garage-stats").innerHTML=Object.entries(base).map(([k,v])=>`<div><span>${labels[k]}</span><div><i style="width:${Math.max(10,Math.min(90,v+(effects[k]||0)*7))}%"></i></div></div>`).join("");document.getElementById("garage-parts").innerHTML=Object.entries(GARAGE_PARTS).map(([part,data])=>`<section class="garage-part"><h2>${data.label}</h2><div>${Object.entries(data.variants).map(([id,v])=>`<button draggable="true" data-part="${part}" data-id="${id}" class="${setup[part]===id?"active":""}">${v.label}</button>`).join("")}</div></section>`).join("");document.querySelectorAll(".garage-mount").forEach(z=>z.classList.toggle("installed",!!setup[z.dataset.part]));applyVisual()}
function mount(part,id){if(!GARAGE_PARTS[part]?.variants[id])return;setup[part]=id;saveGarageSetup(setup);renderUI();const z=document.querySelector(`.garage-mount[data-part="${part}"]`);if(z){z.classList.add("just-mounted");setTimeout(()=>z.classList.remove("just-mounted"),650)}document.getElementById("garage-status").textContent=`${GARAGE_PARTS[part].label}: ${GARAGE_PARTS[part].variants[id].label} montato.`}
document.getElementById("garage-parts").addEventListener("dragstart",e=>{const b=e.target.closest("[data-part]");if(!b)return;e.dataTransfer.setData("text/plain",JSON.stringify({part:b.dataset.part,id:b.dataset.id}));document.body.dataset.dragPart=b.dataset.part;document.getElementById("garage-status").textContent=`Trascina ${GARAGE_PARTS[b.dataset.part].label} sulla zona evidenziata della monoposto.`});
document.getElementById("garage-parts").addEventListener("dragend",()=>{delete document.body.dataset.dragPart});
document.getElementById("garage-parts").addEventListener("click",e=>{const b=e.target.closest("[data-part]");if(b)mount(b.dataset.part,b.dataset.id)});
document.querySelectorAll(".garage-mount").forEach(zone=>{zone.addEventListener("dragover",e=>{e.preventDefault();if(document.body.dataset.dragPart===zone.dataset.part)zone.classList.add("over")});zone.addEventListener("dragleave",()=>zone.classList.remove("over"));zone.addEventListener("drop",e=>{e.preventDefault();zone.classList.remove("over");try{const d=JSON.parse(e.dataTransfer.getData("text/plain"));if(d.part===zone.dataset.part)mount(d.part,d.id);else document.getElementById("garage-status").textContent="Questo componente va montato sulla zona con lo stesso nome."}catch(_){}})});
let dragging=false,lastX=0;renderer.domElement.addEventListener("pointerdown",e=>{dragging=true;lastX=e.clientX;renderer.domElement.setPointerCapture(e.pointerId)});renderer.domElement.addEventListener("pointermove",e=>{if(dragging){car.rotation.y+=(e.clientX-lastX)*.012;lastX=e.clientX}});renderer.domElement.addEventListener("pointerup",()=>dragging=false);
function resize(){const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}addEventListener("resize",resize);resize();renderUI();(function loop(){renderer.render(scene,camera);requestAnimationFrame(loop)})();