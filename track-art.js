import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { offsetEdge } from './track-geometry.js?v=39';

function random(seed=17){return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
export function surfaceTexture(kind,renderer){
  const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d'),rand=random();
  const data=ctx.createImageData(256,256);
  for(let i=0;i<data.data.length;i+=4){const grain=rand()*24;const grass=kind==='grass',sand=kind==='sand';data.data[i]=(grass?88:sand?174:49)+grain;data.data[i+1]=(grass?108:sand?160:51)+grain;data.data[i+2]=(grass?66:sand?120:55)+grain;data.data[i+3]=255;}
  ctx.putImageData(data,0,0);
  if(kind==='asphalt'){
    // Feathered longitudinal rubber deposits; no random allocations at runtime.
    const g=ctx.createLinearGradient(0,0,256,0);g.addColorStop(0,'#0000');g.addColorStop(.2,'#0000');g.addColorStop(.38,'#0005');g.addColorStop(.62,'#0005');g.addColorStop(.8,'#0000');g.addColorStop(1,'#0000');ctx.fillStyle=g;ctx.fillRect(0,0,256,256);
    for(let i=0;i<60;i++){ctx.fillStyle=`rgba(7,10,14,${rand()*.12})`;ctx.fillRect(60+rand()*136,rand()*256,.4+rand(),15+rand()*60);}
  }
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  if(kind==='grass'||kind==='sand')texture.repeat.set(180,180);
  texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return texture;
}

const normal=p=>({x:p.tz,z:-p.tx});

function kerbPaintMaterial(renderer){
  const c=document.createElement('canvas');c.width=32;c.height=64;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#c64037';ctx.fillRect(0,0,32,32);
  ctx.fillStyle='#ebe7d9';ctx.fillRect(0,32,32,32);
  const texture=new THREE.CanvasTexture(c);
  texture.colorSpace=THREE.SRGBColorSpace;texture.wrapT=THREE.RepeatWrapping;
  texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  return new THREE.MeshStandardMaterial({map:texture,roughness:.88});
}

// Independent tangent-aligned boxes leave wedges and X-crossings at corners.
// Sweep one welded ribbon per side through the SAME cross-sections as the
// road; paint alternation lives in UVs, not in disconnected geometry.
// profile: [lateral offset from the asphalt edge, height] pairs, inner first.
function weldedKerb(scene,points,half,side,profile,stripePair,mat,name){
  const N=points.length,stride=profile.length;
  const u0=profile[0][0],uSpan=profile[stride-1][0]-u0;
  const vertices=[],uvs=[],indices=[],edgeDistances=[0];
  for(let i=0;i<N;i++){
    const p=points[i],q=points[(i+1)%N],n=normal(p),m=normal(q);
    edgeDistances.push(edgeDistances[i]+Math.hypot(
      q.x+m.x*half*side-p.x-n.x*half*side,
      q.z+m.z*half*side-p.z-n.z*half*side));
  }
  // An integer repeat count closes the paint seamlessly at the line.
  const repeats=Math.max(1,Math.round(edgeDistances[N]/stripePair));
  const edges=profile.map(([offset])=>offsetEdge(points,(half+offset)*side));
  for(let i=0;i<=N;i++){
    profile.forEach(([offset,height],j)=>{
      const e=edges[j][i%N];
      vertices.push(e.x,height,e.z);
      uvs.push((offset-u0)/uSpan,edgeDistances[i]/edgeDistances[N]*repeats);
    });
  }
  for(let i=0;i<N;i++)for(let j=0;j<stride-1;j++){
    const a=i*stride+j,b=a+1,c=a+stride,d=c+1;
    if(side>0)indices.push(a,c,b,b,c,d);
    else indices.push(a,b,c,b,d,c);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  // UV seam duplicates the first section: share its averaged lighting.
  const normals=geometry.attributes.normal;
  for(let j=0;j<stride;j++){
    const k=N*stride+j;
    const n=new THREE.Vector3(normals.getX(j)+normals.getX(k),normals.getY(j)+normals.getY(k),normals.getZ(j)+normals.getZ(k)).normalize();
    normals.setXYZ(j,n.x,n.y,n.z);normals.setXYZ(k,n.x,n.y,n.z);
  }
  const kerb=new THREE.Mesh(geometry,mat);
  kerb.name=name;kerb.receiveShadow=true;scene.add(kerb);
}

// Guardrail swept as continuous rectangular-section runs, one per stretch of
// consecutive samples where `railClear` accepts the rail position. Emitting
// each face quad with its own vertices keeps the corners crisp instead of
// letting smoothed normals round the rail into a tube.
function sweptRails(points,offset,railClear,mat){
  const N=points.length,P=[],NR=[],I=[];
  const y0=.33,y1=1.03,w=.125;
  const at=(i,side,d,y)=>{const p=points[i],n=normal(p);return [p.x+n.x*d*side,y,p.z+n.z*d*side];};
  function quad(a,b,c,d,na,nb){
    const base=P.length/3;P.push(...a,...b,...c,...d);NR.push(...na,...na,...nb,...nb);
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const gx=uy*vz-uz*vy,gy=uz*vx-ux*vz,gz=ux*vy-uy*vx;
    const wantX=na[0]+nb[0],wantY=na[1]+nb[1],wantZ=na[2]+nb[2];
    if(gx*wantX+gy*wantY+gz*wantZ>=0)I.push(base,base+1,base+2,base+1,base+3,base+2);
    else I.push(base,base+2,base+1,base+1,base+2,base+3);
  }
  for(const side of [-1,1]){
    const clear=points.map(p=>railClear(p,side));
    const runs=[],first=clear.indexOf(false);
    // Stubs shorter than a few samples read as debris, not a barrier.
    if(first<0)runs.push([...Array(N+1).keys()].map(i=>i%N));
    else{let run=[];for(let k=1;k<=N;k++){const i=(first+k)%N;if(clear[i])run.push(i);else{if(run.length>=6)runs.push(run);run=[];}}}
    for(const run of runs){
      for(let k=0;k<run.length-1;k++){
        const i=run[k],j=run[k+1],ni=normal(points[i]),nj=normal(points[j]);
        const inI=[-ni.x*side,0,-ni.z*side],inJ=[-nj.x*side,0,-nj.z*side];
        const outI=[ni.x*side,0,ni.z*side],outJ=[nj.x*side,0,nj.z*side],up=[0,1,0];
        quad(at(i,side,offset-w,y0),at(i,side,offset-w,y1),at(j,side,offset-w,y0),at(j,side,offset-w,y1),inI,inJ);
        quad(at(i,side,offset-w,y1),at(i,side,offset+w,y1),at(j,side,offset-w,y1),at(j,side,offset+w,y1),up,up);
        quad(at(i,side,offset+w,y1),at(i,side,offset+w,y0),at(j,side,offset+w,y1),at(j,side,offset+w,y0),outI,outJ);
      }
      if(run[0]===run[run.length-1])continue;
      for(const [i,sign] of [[run[0],-1],[run[run.length-1],1]]){
        const p=points[i],cap=[p.tx*sign,0,p.tz*sign];
        quad(at(i,side,offset-w,y0),at(i,side,offset-w,y1),at(i,side,offset+w,y0),at(i,side,offset+w,y1),cap,cap);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(NR,3));
  geometry.setIndex(I);geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,mat);mesh.name='guardrail';mesh.receiveShadow=true;return mesh;
}

// `points` places scenery (its spacing is tuned per sample); `detail` is a
// denser sampling of the same curve for the road-hugging strips, so tight
// hairpins render smooth instead of faceted.
export function dressCircuit(scene,points,width,renderer,wet,theme,detail=points){
  const half=width/2, N=points.length, D=detail.length;
  const coastal=theme==='marzamemi';
  const material=(color,roughness=.8)=>new THREE.MeshStandardMaterial({color,roughness});
  const kerbMaterial=kerbPaintMaterial(renderer);
  function ribbon(offset,band,y,mat){
    const vertices=[],indices=[];
    const lo=offsetEdge(detail,offset-band/2),hi=offsetEdge(detail,offset+band/2);
    for(let i=0;i<=D;i++)for(const e of [lo[i%D],hi[i%D]])vertices.push(e.x,y,e.z);
    // Edges are emitted in increasing offset along the normal, the opposite
    // order to the road's, so this winding is what makes the strip face up
    // instead of being back-face culled.
    for(let i=0;i<D;i++){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();
    const mesh=new THREE.Mesh(g,mat);mesh.receiveShadow=true;scene.add(mesh);
  }
  const white=material(0xebe7d9),runoff=material(wet?0x315452:coastal?0xb9aa82:0x467f72);
  for(const side of [-1,1]){
    ribbon(side*(half+(coastal?1.1:1.65)),coastal?2.1:2.8,.006,runoff);
    // Track-limit line sits just inboard of the kerb toe, where it's visible.
    if(!coastal){ribbon(side*(half-.42),.14,.025,white);ribbon(side*(half+3.02),.13,.014,white);}
  }
  const temp=new THREE.Object3D();
  function instances(geo,mat,transforms){const mesh=new THREE.InstancedMesh(geo,mat,transforms.length);transforms.forEach((t,i)=>{temp.position.set(...t.p);temp.rotation.set(0,t.r||0,0);temp.scale.set(...(t.s||[1,1,1]));temp.updateMatrix();mesh.setMatrixAt(i,temp.matrix);});mesh.receiveShadow=true;mesh.computeBoundingSphere();scene.add(mesh);return mesh;}
  if(coastal){
    // Slightly overlap asphalt at the inner toe; taper into the shoulder.
    const profile=[[-.25,.024],[0,.065],[.35,.075],[.70,.016]];
    for(const side of [-1,1])weldedKerb(scene,detail,half,side,profile,6,kerbMaterial,`marzamemi-kerb-${side}`);
    // Viale degli Oleandri / Fondo Morte: a deliberately low-draw-call
    // reconstruction from the supplied route and street video. Repeated
    // villas, walls, palms and flowering hedges are instanced for phones.
    const sand=material(0xc8b98e,1),stucco=material(0xf0ead9,.9),warm=material(0xd8c7aa,.92);
    const roof=material(0xd9a56f,.85),stone=material(0xa89d86,1),iron=material(0x3d4b4c,.55);
    const palmGreen=material(0x355f42,.9),flower=material(0xc83f83,.9),oleander=material(0x53784c,.95);
    const sea=new THREE.Mesh(new THREE.PlaneGeometry(620,190),new THREE.MeshStandardMaterial({color:0x45afd0,roughness:.3,metalness:.08}));
    sea.rotation.x=-Math.PI/2;sea.rotation.z=Math.PI/2;sea.position.set(500,.001,0);sea.receiveShadow=true;scene.add(sea);
    const beach=new THREE.Mesh(new THREE.PlaneGeometry(32,620),sand);beach.rotation.x=-Math.PI/2;beach.position.set(396,.002,0);scene.add(beach);

    const walls=[],gates=[],homes=[],warmHomes=[],roofs=[],windows=[],trunks=[],crowns=[],flowers=[],shrubs=[],poles=[];
    const wirePositions=[],occupied=[];
    for(let i=0;i<N;i+=12){
      const p=points[i],n=normal(p),r=Math.atan2(p.tx,p.tz);
      for(const side of [-1,1]){
        const wallDistance=half+4.8,x=p.x+n.x*wallDistance*side,z=p.z+n.z*wallDistance*side;
        const safe=points.every((q,j)=>Math.abs(j-i)<8||Math.abs(j-i)>N-8||Math.hypot(q.x-x,q.z-z)>half+2.4);
        if(safe){
          walls.push({p:[x,.48,z],r,s:[1,1,1]});
          if(i%36===0)gates.push({p:[x,.78,z],r});
        }
      }
    }
    for(let i=6;i<N;i+=24){
      const p=points[i],n=normal(p),r=Math.atan2(p.tx,p.tz),side=(Math.floor(i/24)%2?1:-1);
      const distance=half+12.5,x=p.x+n.x*distance*side,z=p.z+n.z*distance*side;
      const safe=points.every((q,j)=>Math.abs(j-i)<10||Math.abs(j-i)>N-10||Math.hypot(q.x-x,q.z-z)>half+7);
      if(!safe||occupied.some(([ox,oz])=>Math.hypot(ox-x,oz-z)<13))continue;
      occupied.push([x,z]);
      const h=2.8+(i%48===0?1.2:0);
      (i%48===0?warmHomes:homes).push({p:[x,h/2,z],r,s:[7.5,h,6]});
      roofs.push({p:[x,h+.16,z],r,s:[8,.3,6.5]});
      windows.push({p:[x-n.x*side*3.03,1.65,z-n.z*side*3.03],r});
      const plantX=x+n.x*side*4.5,plantZ=z+n.z*side*4.5;
      (i%72===0?flowers:shrubs).push({p:[plantX,1.25,plantZ],s:[2.2,2.4,2.2],r:i});
    }
    for(let i=0;i<N;i+=30){
      const p=points[i],n=normal(p),r=Math.atan2(p.tx,p.tz),side=i%60===0?1:-1;
      const d=half+7.5,x=p.x+n.x*d*side,z=p.z+n.z*d*side;
      trunks.push({p:[x,2.6,z],s:[.28,5.2,.28]});crowns.push({p:[x,5.5,z],s:[2.6,.75,2.6],r:i});
      poles.push({p:[p.x-n.x*(half+5.7),3.1,p.z-n.z*(half+5.7)],s:[.16,6.2,.16]});
      const next=points[(i+30)%N],nn=normal(next);
      wirePositions.push(p.x-n.x*(half+5.7),6.05,p.z-n.z*(half+5.7),next.x-nn.x*(half+5.7),6.05,next.z-nn.z*(half+5.7));
    }
    instances(new THREE.BoxGeometry(8,.95,.22),stone,walls);
    instances(new THREE.BoxGeometry(.18,1.55,4.2),iron,gates);
    instances(new THREE.BoxGeometry(1,1,1),stucco,homes);
    instances(new THREE.BoxGeometry(1,1,1),warm,warmHomes);
    instances(new THREE.BoxGeometry(1,1,1),roof,roofs);
    instances(new THREE.BoxGeometry(.12,1.05,3.6),new THREE.MeshStandardMaterial({color:0x7196a5,metalness:.15,roughness:.35}),windows);
    instances(new THREE.CylinderGeometry(.5,.72,1,7),material(0x7a6545,1),trunks);
    instances(new THREE.SphereGeometry(1,7,5),palmGreen,crowns);
    instances(new THREE.SphereGeometry(1,7,5),flower,flowers);
    instances(new THREE.SphereGeometry(1,7,5),oleander,shrubs);
    instances(new THREE.CylinderGeometry(.5,.65,1,7),material(0x77756c,.8),poles);
    const wires=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(wirePositions,3)),new THREE.LineBasicMaterial({color:0x30383b,transparent:true,opacity:.72}));scene.add(wires);

    const start=points[0],heading=Math.atan2(start.tx,start.tz),gantry=new THREE.Group();gantry.position.set(start.x,0,start.z);gantry.rotation.y=heading;scene.add(gantry);
    for(const side of [-1,1]){const post=new THREE.Mesh(new THREE.BoxGeometry(.25,5,.25),iron);post.position.set(side*(half+1.2),2.5,5);gantry.add(post);}
    const signCanvas=document.createElement('canvas');signCanvas.width=768;signCanvas.height=96;const signCtx=signCanvas.getContext('2d');signCtx.fillStyle='#f4ead1';signCtx.fillRect(0,0,768,96);signCtx.fillStyle='#16475b';signCtx.font='bold 42px sans-serif';signCtx.textAlign='center';signCtx.fillText('MARZAMEMI  ·  VIALE DEGLI OLEANDRI',384,63);const signTexture=new THREE.CanvasTexture(signCanvas);signTexture.colorSpace=THREE.SRGBColorSpace;
    const sign=new THREE.Mesh(new THREE.BoxGeometry(width+3,.85,.25),new THREE.MeshBasicMaterial({map:signTexture}));sign.position.set(0,4.7,5);gantry.add(sign);
    return;
  }
  // Wider than Marzamemi's street kerb, with shorter stripes like a
  // permanent circuit's; the toe still overlaps the asphalt edge.
  const kerbProfile=[[-.3,.024],[0,.07],[.55,.08],[.95,.016]];
  for(const side of [-1,1])weldedKerb(scene,detail,half,side,kerbProfile,4,kerbMaterial,`kerb-${side}`);
  // A rail is kept only where its own stretch of track is the closest one:
  // anywhere nearer to another leg it would sit inside that leg's runoff
  // and cross that leg's own rail. This also drops the inside of bends
  // tighter than the rail offset, where the swept section would fold.
  const railOffset=half+8.5;
  const railClear=(p,side)=>{const n=normal(p),x=p.x+n.x*railOffset*side,z=p.z+n.z*railOffset*side;return points.every(q=>Math.hypot(q.x-x,q.z-z)>railOffset-.6);};
  scene.add(sweptRails(detail,railOffset,railClear,material(0xb4bfc0,.48)));
  const posts=[];
  for(let i=0;i<N;i+=12)for(const side of [-1,1]){
    if(!railClear(points[i],side))continue;
    const p=points[i],n=normal(p);
    posts.push({p:[p.x+n.x*railOffset*side,1.1,p.z+n.z*railOffset*side],r:Math.atan2(p.tx,p.tz)});
  }
  instances(new THREE.BoxGeometry(.12,2.2,.12),material(0x65747d,.5),posts);
  // Forest clusters and low mountains give a horizon without per-tree draws.
  const rand=random(82),trunks=[],crowns=[];
  for(let i=0;i<350;i++){
    const x=(rand()-.5)*760,z=(rand()-.5)*760;
    if(points.some(p=>Math.hypot(p.x-x,p.z-z)<half+18))continue;
    const h=3+rand()*6;trunks.push({p:[x,h*.2,z],s:[.35,h*.4,.35]});crowns.push({p:[x,h*.75,z],s:[h*.42,h,h*.42],r:rand()*6});
  }
  instances(new THREE.CylinderGeometry(.5,.7,1,5),material(0x514c3d),trunks);
  instances(new THREE.ConeGeometry(1,1,7),material(wet?0x293e39:0x3a5944),crowns);
  const hills=[];for(let i=0;i<28;i++){const a=i/28*Math.PI*2,r=460+rand()*90;hills.push({p:[Math.cos(a)*r,-12,Math.sin(a)*r],s:[100+rand()*80,30+rand()*45,90+rand()*70],r:a});}
  instances(new THREE.SphereGeometry(1,16,10),material(0x6b7b6a),hills);
  // Pit straight architecture, positioned along the local tangent.
  function structure(index,side){const p=points[index%N],n=normal(p),offset=half+17;
    const x=p.x+n.x*offset*side,z=p.z+n.z*offset*side;
    if(points.some(q=>Math.hypot(q.x-x,q.z-z)<half+10))return;
    const group=new THREE.Group();group.position.set(x,0,z);group.rotation.y=Math.atan2(p.tx,p.tz);scene.add(group);
    function box(w,h,d,y,mat,dx=0,dz=0){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(dx,y,dz);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;}
    const dark=material(0x182837,.5),silver=material(0xaab4b9,.5);
    box(9,4,28,2,dark);box(10,.3,30,4.2,silver);
    for(let j=-3;j<=3;j++){box(.08,1.8,3,1.5,material(0x698396,.3),-side*4.55,j*3.7);box(.12,.12,3,2.7,white,-side*4.6,j*3.7);}
    box(9,.25,28,5.4,dark);
    for(const dx of [-4,4])for(const dz of [-13,13])box(.15,1.2,.15,4.8,silver,dx,dz);
  }
  structure(0,1);structure(Math.floor(N*.38),-1);
  // Start gantry and braking boards are visual only, never collision objects.
  const p=points[0],n=normal(p),heading=Math.atan2(p.tx,p.tz),gantry=new THREE.Group();gantry.position.set(p.x,0,p.z);gantry.rotation.y=heading;scene.add(gantry);
  const gantryMat=material(0x243645,.5);
  for(const side of [-1,1]){const m=new THREE.Mesh(new THREE.BoxGeometry(.35,6,.45),gantryMat);m.position.set(side*(half+2),3,5);gantry.add(m);}
  const c=document.createElement('canvas');c.width=1024;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle='#142333';ctx.fillRect(0,0,1024,128);ctx.fillStyle='#deeee9';ctx.font='bold 48px sans-serif';ctx.textAlign='center';ctx.fillText('OTTOBIT   /   RACING',512,80);const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
  const banner=new THREE.Mesh(new THREE.BoxGeometry(width+4,1,.35),new THREE.MeshBasicMaterial({map:texture}));banner.position.set(0,5.5,5);gantry.add(banner);
}
