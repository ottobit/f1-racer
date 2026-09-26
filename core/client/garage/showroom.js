import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { buildCar, createStudioEnvironment } from '../shared/car-model.js?v=31';
import { createFrameLimiter } from '../shared/graphics-profiles.js?v=4';

const SHOWROOM_VIEWS={
  hero:[.72,.34,10.4],
  side:[Math.PI/2,.18,10.4],
  // Keep the camera inside the back wall at z=-8. The old 10.4-unit orbit
  // placed it behind the wall, so the solid backdrop hid the entire car.
  rear:[Math.PI,.3,6.8],
  cockpit:[.2,.72,4.8],
};

// graphicsProfile: the same {dprCap, shadowsEnabled, shadowMapSize} object
// main.js applies to the race renderer (see graphics-profiles.js, #2) — a
// device that's set to "basso" for the race gets the same treatment here,
// instead of the showroom silently ignoring it and always paying full DPR
// and a 2048 shadow map. Falls back to the old viewport-only heuristic if a
// caller doesn't pass one, so this stays a strict addition.
export function createShowroom(host, { livery, graphicsProfile, onFrame } = {}) {
  const compact=matchMedia('(max-width: 760px)').matches;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const profile=graphicsProfile || { dprCap: compact?1.5:2, shadowsEnabled: true, shadowMapSize: compact?1024:2048 };
  const renderer=new THREE.WebGLRenderer({antialias:profile.antialias!==false,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,profile.dprCap));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  renderer.shadowMap.enabled=profile.shadowsEnabled;renderer.shadowMap.type=profile.softShadows===false?THREE.PCFShadowMap:THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const frameGate=createFrameLimiter(profile.frameCapFps);
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x080d14);scene.fog=new THREE.FogExp2(0x080d14,.035);
  const camera=new THREE.PerspectiveCamera(36,1,.1,80);
  const env=createStudioEnvironment(renderer);scene.environment=env.texture;
  const car=buildCar(livery || 0xbd1024,{detail:true,showDriver:false,scale:1.15}).group;car.position.y=.13;scene.add(car);
  scene.add(new THREE.HemisphereLight(0xbfd6ff,0x10151d,1.4));
  const key=new THREE.SpotLight(0xe8f2ff,110,25,.65,.65,1.5);key.position.set(2,7,4);key.castShadow=profile.shadowsEnabled;key.shadow.mapSize.set(profile.shadowMapSize,profile.shadowMapSize);key.shadow.bias=-.0003;key.shadow.normalBias=.025;scene.add(key);
  const rim=new THREE.PointLight(0x679dff,28,14,2);rim.position.set(-4,3,-3);scene.add(rim);
  const warm=new THREE.PointLight(0xff5b3e,18,12,2);warm.position.set(4,2,-2);scene.add(warm);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:0x101822,metalness:.6,roughness:.32}));floor.rotation.x=-Math.PI/2;floor.position.y=-.08;floor.receiveShadow=true;scene.add(floor);
  const plinth=new THREE.Mesh(new THREE.CylinderGeometry(3.65,3.72,.18,96),new THREE.MeshStandardMaterial({color:0x222b35,metalness:.72,roughness:.28}));plinth.position.y=.025;plinth.receiveShadow=true;scene.add(plinth);
  function ring(radius,y,color){const r=new THREE.Mesh(new THREE.TorusGeometry(radius,.012,8,128),new THREE.MeshBasicMaterial({color}));r.rotation.x=-Math.PI/2;r.position.y=y;scene.add(r);}
  ring(3.64,.12,0xb8d9ee);ring(3.72,-.015,0x456988);
  // Architectural ribs and light strips define a real studio around the car.
  const dark=new THREE.MeshStandardMaterial({color:0x1a2330,metalness:.65,roughness:.4});
  function beam(w,h,d,x,y,z,material=dark){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);scene.add(m);return m;}
  const luminous=new THREE.MeshBasicMaterial({color:new THREE.Color(2.2,2.6,3)});
  for(const z of [-7,-4,0,4]){
    for(const x of [-6,6]){beam(.15,6,.18,x,2.9,z);beam(.025,4.8,.03,x*.99,2.9,z+.11,luminous);}
    beam(12,.15,.18,0,5.9,z);beam(9,.025,.09,0,5.8,z,luminous);
  }
  beam(16,7,.2,0,3,-8);
  for(let x=-7;x<=7;x+=.7)beam(.018,5,.025,x,2.6,-7.85);
  const signCanvas=document.createElement('canvas');signCanvas.width=1024;signCanvas.height=256;
  const ctx=signCanvas.getContext('2d');ctx.fillStyle='#111923';ctx.fillRect(0,0,1024,256);ctx.textAlign='center';ctx.fillStyle='#bcc9d6';ctx.font='600 94px sans-serif';ctx.fillText('O T T O B I T',512,132);ctx.fillStyle='#648097';ctx.font='24px monospace';ctx.fillText('R A C I N G   D I V I S I O N',512,195);
  const signMap=new THREE.CanvasTexture(signCanvas);signMap.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(7,1.75),new THREE.MeshBasicMaterial({map:signMap}));sign.position.set(0,3,-7.72);scene.add(sign);
  let azimuth=.72,elevation=.34,distance=10.4,auto=false,pointer=null,lastX=0,lastY=0;
  function updateCamera(){const d=distance*(Math.max(1, .95 / camera.aspect));camera.position.set(Math.sin(azimuth)*Math.cos(elevation)*d,.6+Math.sin(elevation)*d,Math.cos(azimuth)*Math.cos(elevation)*d);camera.lookAt(0,.65,0);}
  const canvas=renderer.domElement;canvas.setAttribute('aria-label','Monoposto 3D: trascina per orbitare, usa i pulsanti per cambiare vista');
  canvas.addEventListener('pointerdown',e=>{if(pointer!==null)return;pointer=e.pointerId;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(pointer);});
  canvas.addEventListener('pointermove',e=>{if(e.pointerId!==pointer)return;azimuth-=(e.clientX-lastX)*.008;elevation=THREE.MathUtils.clamp(elevation+(e.clientY-lastY)*.004,.1,1.15);lastX=e.clientX;lastY=e.clientY;});
  const release=e=>{if(e.pointerId===pointer)pointer=null;};canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('lostpointercapture',release);
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{[azimuth,elevation,distance]=SHOWROOM_VIEWS[b.dataset.view];document.querySelectorAll('[data-view]').forEach(v=>v.setAttribute('aria-pressed',String(v===b)));}));
  document.getElementById('garage-orbit').addEventListener('click',e=>{auto=!auto;e.currentTarget.setAttribute('aria-pressed',String(auto));});
  const observer=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();});observer.observe(host);
  let previous=0;
  renderer.setAnimationLoop(time=>{if(!frameGate(time))return;const dt=Math.min((time-previous)/1000,.05);previous=time;if(document.hidden)return;if(auto&&pointer===null&&!reduced.matches)azimuth+=dt*.18;updateCamera();renderer.render(scene,camera);if(onFrame)onFrame(dt);});
  function focusPart(part) {
    const views={frontWing:[.48,.36,8.8],rearWing:[Math.PI,.34,6.65],floor:[2.4,.22,7.4],brakes:[1.25,.28,8.6],suspension:[.6,.62,8.6]};
    [azimuth,elevation,distance]=views[part];auto=false;
    document.getElementById('garage-orbit').setAttribute('aria-pressed','false');
    document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));
  }
  return {car,renderer,focusPart};
}
