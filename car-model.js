import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// Shared visual model. +Z is forward; wheel order/radius remain compatible
// with the race simulation. Geometry never participates in collisions.
export function buildCar(color, { scale = 1, detail = false } = {}) {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: .48, roughness: .24, clearcoat: 1, clearcoatRoughness: .12 });
  const carbon = new THREE.MeshStandardMaterial({color: 0x111820, metalness: .45, roughness: .4});
  const black = new THREE.MeshStandardMaterial({color: 0x06090e, roughness: .82});
  const alloy = new THREE.MeshStandardMaterial({color: 0x8896a5, metalness: .92, roughness: .26});
  const stripe = new THREE.MeshStandardMaterial({color: 0xe9eeec, metalness: .3, roughness: .3});
  const gold = new THREE.MeshStandardMaterial({color: 0xd7b264, metalness: .7, roughness: .32});
  if (detail) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#30343a'; ctx.fillRect(0,0,64,64);
    for(let y=0;y<8;y++) for(let x=0;x<8;x++) {
      ctx.fillStyle=(x+y)%2 ? '#13171d':'#484c52'; ctx.fillRect(x*8,y*8,7,7);
    }
    const map = new THREE.CanvasTexture(canvas); map.wrapS=map.wrapT=THREE.RepeatWrapping; map.repeat.set(9,9);
    carbon.bumpMap=map; carbon.bumpScale=.012; carbon.roughnessMap=map;
  }
  function mesh(geometry, material, pos=[0,0,0], parent=group) {
    const m=new THREE.Mesh(geometry,material); m.position.set(...pos); m.castShadow=true; m.receiveShadow=true; parent.add(m); return m;
  }
  const box=(w,h,d,mat,pos,parent)=>mesh(new THREE.BoxGeometry(w,h,d),mat,pos,parent);
  function rod(a,b,r=.022,mat=carbon,parent=group){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),v=end.clone().sub(start);const m=mesh(new THREE.CylinderGeometry(r,r,v.length(),detail?10:6),mat,start.add(end).multiplyScalar(.5).toArray(),parent);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());return m;}
  // Elliptical cross-sections yield continuous, sculpted bodywork instead of boxes.
  function shell(stations,mat,x=0){
    const vertices=[],indices=[],n=detail?32:16;
    stations.forEach(([z,w,y,h])=>{for(let j=0;j<n;j++){const a=j/n*Math.PI*2;vertices.push(x+Math.cos(a)*w,y+Math.sin(a)*h,z);}});
    for(let i=0;i<stations.length-1;i++)for(let j=0;j<n;j++){const a=i*n+j,b=i*n+(j+1)%n,c=a+n,d=b+n;indices.push(a,b,c,b,d,c);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return mesh(g,mat);
  }
  shell([[-1.75,.02,.4,.02],[-1.4,.25,.48,.16],[-.9,.43,.52,.26],[0,.43,.52,.25],[.55,.32,.49,.2],[1.2,.23,.43,.14],[1.9,.13,.32,.09],[2.35,.08,.29,.055],[2.43,.005,.29,.01]],paint);
  shell([[-1.65,.01,.53,.01],[-1.25,.13,.63,.17],[-.8,.23,.78,.34],[-.42,.22,.85,.39],[-.27,.05,.79,.2]],paint);
  box(1.66,.055,2.75,carbon,[0,.16,-.15]).name = "floorPanel";
  for(const side of [-1,1]){
    shell([[-1.45,.015,.31,.01],[-1.1,.19,.38,.14],[-.5,.31,.44,.22],[.1,.32,.48,.2],[.45,.24,.48,.14],[.48,.20,.48,.1]],paint,side*.55);
    const inlet=mesh(new THREE.SphereGeometry(.2,16,8),black,[side*.55,.5,.475]);inlet.scale.set(1,.5,.15);
    box(.035,.1,2.5,carbon,[side*.84,.22,-.15]);
    box(.028,.022,1.15,stripe,[side*.85,.29,-.38]);
    const mirror=mesh(new THREE.SphereGeometry(.12,12,8),paint,[side*.58,.86,.32]);mirror.scale.set(1.4,.5,.65);
    rod([side*.3,.65,.32],[side*.56,.84,.32],.017);
    for(const z of [1.05,-1.05])for(const y of [.28,.53])for(const dz of [-.32,.32])rod([side*.34,y,z+dz],[side*.88,.38,z]);
    rod([side*.38,.65,.7],[side*.88,.35,1.05],.026,alloy);
    if (detail) {
      const coil=[]; for(let i=0;i<=80;i++){const t=i/80;coil.push(new THREE.Vector3(Math.cos(t*Math.PI*12)*.055,t*.3-.15,Math.sin(t*Math.PI*12)*.055));}
      const spring=mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil),80,.009,5,false),gold,[side*.48,.47,.83]);spring.name='setupSpring';spring.rotation.z=side*.35;
    }
    for(let j=0;j<5;j++){const fin=box(.03,.14,.46,carbon,[side*(.18+j*.13),.24,-1.5]);fin.rotation.x=-.18;fin.name="diffuserFin";}
    if(detail)for(let j=0;j<7;j++)box(.2,.015,.035,carbon,[side*.61,.635,-.45-j*.075]).rotation.z=side*-.2;
  }
  const cockpit=mesh(new THREE.SphereGeometry(.35,20,12),black,[0,.72,.04]);cockpit.scale.set(1,.45,1.5);
  const helmet=mesh(new THREE.SphereGeometry(.19,20,12),stripe,[0,.88,.04]);helmet.scale.y=.9;
  const visor=mesh(new THREE.SphereGeometry(.195,20,10,0,Math.PI*2,.95,.65),new THREE.MeshPhysicalMaterial({color:0x263e52,metalness:1,roughness:.1}),[0,.88,.04]);
  const haloCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.36,.95,-.27),new THREE.Vector3(-.4,1.07,.17),new THREE.Vector3(0,1.07,.57),new THREE.Vector3(.4,1.07,.17),new THREE.Vector3(.36,.95,-.27)]);
  mesh(new THREE.TubeGeometry(haloCurve,detail?40:20,.038,8,false),carbon);
  rod([0,.62,.56],[0,1.07,.57],.032);
  const intake=mesh(new THREE.SphereGeometry(.145,16,12),black,[0,1.12,-.33]);intake.scale.set(.8,.7,.5);
  function wing(name,z,y,width){const wing=new THREE.Group();wing.name=name;wing.position.set(0,y,z);group.add(wing);for(let i=0;i<3;i++){const blade=box(width-i*.08,.035,.16,i===2?paint:carbon,[0,i*.06,-i*.13],wing);blade.rotation.x=-.12;}for(const s of [-1,1]){box(.035,.28,.5,paint,[s*width/2,.07,-.1],wing);box(.03,.024,.46,stripe,[s*(width/2+.02),.19,-.1],wing);}return wing;}
  wing('frontWing',2.22,.21,1.94);wing('rearWing',-1.62,.95,1.72);
  for(const s of [-1,1]){rod([s*.3,.4,-1.4],[s*.3,.96,-1.62],.035);rod([s*.13,.35,2.05],[s*.25,.2,2.2],.025);}
  const exhaust=mesh(new THREE.CylinderGeometry(.085,.1,.25,12,1,true),alloy,[0,.51,-1.76]);exhaust.rotation.x=Math.PI/2;
  box(.13,.08,.025,new THREE.MeshStandardMaterial({color:0xff220a,emissive:0xff1600,emissiveIntensity:2}),[0,.3,-1.78]);
  const steeringPivots=[];
  const wheels=[[.94,.4,1.05],[-.94,.4,1.05],[.94,.4,-1.05],[-.94,.4,-1.05]].map(([x,y,z],index)=>{
    const pivot=new THREE.Group();pivot.position.set(x,y,z);group.add(pivot);
    const wheel=new THREE.Group();pivot.add(wheel);
    if(index<2)steeringPivots.push(pivot);
    if(detail){const caliper=box(.085,.22,.11,new THREE.MeshStandardMaterial({color:0xb69050,metalness:.65,roughness:.35}),[x-Math.sign(x)*.18,y,z+.14]);caliper.name='setupCaliper';}
    const tire=mesh(new THREE.CylinderGeometry(.4,.4,.32,detail?48:20),black,[0,0,0],wheel);tire.rotation.z=Math.PI/2;
    for(const s of [-1,1]){
      const ring=mesh(new THREE.TorusGeometry(.31,.065,8,detail?48:20),black,[s*.145,0,0],wheel);ring.rotation.y=Math.PI/2;
      const rim=mesh(new THREE.CylinderGeometry(.23,.23,.025,detail?32:16),carbon,[s*.17,0,0],wheel);rim.rotation.z=Math.PI/2;
      const lip=mesh(new THREE.TorusGeometry(.225,.012,6,detail?32:16),alloy,[s*.19,0,0],wheel);lip.rotation.y=Math.PI/2;
      const marking=mesh(new THREE.TorusGeometry(.335,.007,4,detail?48:20),gold,[s*.19,0,0],wheel);marking.rotation.y=Math.PI/2;
      if(detail)for(let j=0;j<10;j++){const a=j/10*Math.PI*2;rod([s*.195,Math.cos(a)*.07,Math.sin(a)*.07],[s*.195,Math.cos(a+.12)*.215,Math.sin(a+.12)*.215],.013,alloy,wheel);}
    }
    const hub=mesh(new THREE.CylinderGeometry(.065,.065,.42,10),gold,[0,0,0],wheel);hub.rotation.z=Math.PI/2;
    return wheel;
  });
  // Batch static parts by material for the ten-car race grid. Wheels stay
  // separate groups so the existing rolling animation remains intact.
  if (!detail) {
    function batch(parent) {
      const buckets = new Map();
      parent.children.filter(o => o.isMesh).forEach(o => {
        o.updateMatrix();
        const geometry = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
        geometry.applyMatrix4(o.matrix);
        if (!buckets.has(o.material)) buckets.set(o.material, []);
        buckets.get(o.material).push(geometry);
        parent.remove(o); o.geometry.dispose();
      });
      for (const [material, geometries] of buckets) {
        const merged = new THREE.BufferGeometry();
        for (const key of ['position', 'normal', 'uv']) {
          // Procedural shells have no UVs; supply zero UVs for solid paint.
          const size = key === 'uv' ? 2 : 3;
          const length = geometries.reduce((n,g) => n + g.attributes.position.count * size, 0);
          const array = new Float32Array(length); let offset = 0;
          for (const g of geometries) { const a = g.attributes[key]; if (a) array.set(a.array, offset); offset += g.attributes.position.count * size; }
          merged.setAttribute(key, new THREE.BufferAttribute(array, size));
        }
        mesh(merged, material, [0,0,0], parent);
        geometries.forEach(g => g.dispose());
      }
    }
    batch(group); wheels.forEach(batch);
    batch(group.getObjectByName('frontWing')); batch(group.getObjectByName('rearWing'));
  }
  group.scale.setScalar(scale);
  return {group,wheels,steeringPivots,wheelRadius:.4*scale};
}

// A PMREM-filtered studio environment makes physical paint reflect actual
// light cards, without a network HDR asset or per-frame cube captures.
export function createStudioEnvironment(renderer){
  const studio=new THREE.Scene();studio.background=new THREE.Color(0x141c29);
  for(const [x,y,z,w,h,intensity] of [[-4,4,0,2,9,8],[4,3,1,1,8,5],[0,6,-2,7,3,7],[0,2,-6,5,1,3]]){
    const card=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(intensity,intensity,intensity),side:THREE.DoubleSide}));card.position.set(x,y,z);card.lookAt(0,0,0);studio.add(card);
  }
  const pmrem=new THREE.PMREMGenerator(renderer);const target=pmrem.fromScene(studio,.04, .1,50);pmrem.dispose();studio.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});return target;
}
