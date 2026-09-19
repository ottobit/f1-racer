import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GARAGE_PARTS, loadGarageSetup, saveGarageSetup, setupEffects } from "./garage-setup.js";
let setup=loadGarageSetup();
const host=document.getElementById("garage-canvas"), scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(38,1,0.1,100); camera.position.set(5.8,3.2,7.2); camera.lookAt(0,.45,0);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); host.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff,0x151820,2.2)); const key=new THREE.DirectionalLight(0xffffff,2.5); key.position.set(4,6,5); scene.add(key);
const car=new THREE.Group(); scene.add(car);
const red=new THREE.MeshStandardMaterial({color:0xe10600,metalness:.35,roughness:.35}), dark=new THREE.MeshStandardMaterial({color:0x111318,metalness:.2,roughness:.55}), carbon=new THREE.MeshStandardMaterial({color:0x25272b,metalness:.25,roughness:.5});
function box(w,h,d,mat,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);car.add(m);return m}
box(1.15,.42,2.8,red,0,.48,0); box(.42,.25,2.1,red,0,.43,2.15); box(1.7,.22,1.15,red,0,.5,-.3);
const frontWing=box(2.8,.09,.55,carbon,0,.22,3.05), rearWing=box(2.35,.12,.45,carbon,0,1.08,-1.75);
box(.75,.28,1.25,red,0,.82,-.65); const halo=new THREE.Mesh(new THREE.TorusGeometry(.38,.045,8,24,Math.PI),carbon);halo.rotation.x=Math.PI/2;halo.position.set(0,1.02,.05);car.add(halo);
for(const x of [-.95,.95])for(const z of [-1.15,1.55]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,.34,18),dark);wheel.rotation.z=Math.PI/2;wheel.position.set(x,.43,z);car.add(wheel)}
function applyVisual(){frontWing.scale.z=setup.frontWing==="high"?1.35:setup.frontWing==="low"?.72:1;rearWing.position.y=setup.rearWing==="high"?1.28:setup.rearWing==="low"?.92:1.08;rearWing.rotation.x=setup.rearWing==="high"?-.18:setup.rearWing==="low"?.08:-.05}
function renderUI(){const effects=setupEffects(setup), base={speed:50,downforce:50,braking:50,stability:50,traction:50};document.getElementById("garage-stats").innerHTML=Object.entries(base).map(([k,v])=>`<div><span>${({speed:"Velocità",downforce:"Carico",braking:"Frenata",stability:"Stabilità",traction:"Trazione"})[k]}</span><div><i style="width:${Math.max(10,Math.min(90,v+(effects[k]||0)*7))}%"></i></div></div>`).join("");document.getElementById("garage-parts").innerHTML=Object.entries(GARAGE_PARTS).map(([part,data])=>`<section class="garage-part"><h2>${data.label}</h2><div>${Object.entries(data.variants).map(([id,v])=>`<button draggable="true" data-part="${part}" data-id="${id}" class="${setup[part]===id?"active":""}">${v.label}</button>`).join("")}</div></section>`).join("");applyVisual()}
function mount(part,id){if(!GARAGE_PARTS[part]?.variants[id])return;setup[part]=id;saveGarageSetup(setup);renderUI()}
document.getElementById("garage-parts").addEventListener("dragstart",e=>{const b=e.target.closest("[data-part]");if(b)e.dataTransfer.setData("text/plain",JSON.stringify({part:b.dataset.part,id:b.dataset.id}))});
document.getElementById("garage-parts").addEventListener("click",e=>{const b=e.target.closest("[data-part]");if(b)mount(b.dataset.part,b.dataset.id)});
const drop=document.getElementById("garage-drop");drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("over")});drop.addEventListener("dragleave",()=>drop.classList.remove("over"));drop.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("over");try{const d=JSON.parse(e.dataTransfer.getData("text/plain"));mount(d.part,d.id)}catch(_){}});
let dragging=false,lastX=0;renderer.domElement.addEventListener("pointerdown",e=>{dragging=true;lastX=e.clientX;renderer.domElement.setPointerCapture(e.pointerId)});renderer.domElement.addEventListener("pointermove",e=>{if(dragging){car.rotation.y+=(e.clientX-lastX)*.012;lastX=e.clientX}});renderer.domElement.addEventListener("pointerup",()=>dragging=false);
function resize(){const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}addEventListener("resize",resize);resize();renderUI();(function loop(){renderer.render(scene,camera);requestAnimationFrame(loop)})();
