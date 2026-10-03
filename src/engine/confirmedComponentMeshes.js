import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import fontData from 'three/examples/fonts/helvetiker_regular.typeface.json';
import { confirmedSpec, confirmedColor, legoStudHeight } from './componentPack.js';
import { insetScrewMeshes } from './insetPanelMeshes.js';
import { COLOR_HEX } from './colors.js';
import { confirmedFrame, curvePoint, worldToLocal, rungPositions } from './confirmedComponentModel.js';
const font=new FontLoader().parse(fontData);
const colors=['#e64343','#ffcf3d','#f09cbc','#74b166','#318dde','#9c75cb'];
const vec=p=>new THREE.Vector3(...p);
const resolveColor=color=>COLOR_HEX[color] || color;

function organicShape(rx,ry,phase=0) {
  const points=Array.from({length:48},(_,i)=>{const a=i*Math.PI/24,r=1+0.14*Math.sin(3*a+phase)+0.10*Math.cos(5*a-phase);return new THREE.Vector3(Math.cos(a)*rx*r,Math.sin(a)*ry*r,0);});
  const smooth=new THREE.CatmullRomCurve3(points,true).getPoints(160),shape=new THREE.Shape();
  smooth.forEach((p,i)=>i?shape.lineTo(p.x,p.y):shape.moveTo(p.x,p.y));shape.closePath();return shape;
}
const extruded=(shape,depth=0.35,bevel=0.12)=>new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:4,curveSegments:24});
function gripGeometry(index) {
  const s=new THREE.Shape();s.moveTo(-4.2,-1.1);s.bezierCurveTo(-4.8,-3.5,-2.2,-3.7,-0.3,-2.7);s.bezierCurveTo(2,-3.5,4.3,-2.5,4.6,-0.4);s.bezierCurveTo(5,2.3,2.2,3.1,0.5,2.2);s.bezierCurveTo(-1.5,3.1,-4.1,2.6,-4.2,-1.1);s.closePath();
  const g=extruded(s,1.55,0.42);g.scale(index===1?0.94:1,index===1?1.03:0.98,1);return g;
}

function feltBump(scene) {
  if(scene._confirmedFiberBump)return scene._confirmedFiberBump;
  const size=128,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const n=Math.sin(x*17.13+y*29.37)*43758.5,value=115+Math.round((n-Math.floor(n))*100)+(x%4===0?12:0);
    const index=(y*size+x)*4;data[index]=data[index+1]=data[index+2]=value;data[index+3]=255;
  }
  const map=new THREE.DataTexture(data,size,size);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(12,12);map.needsUpdate=true;
  scene._confirmedFiberBump=map;return map;
}
function componentEnvironment(scene) {
  if(!scene.renderer?.isWebGLRenderer)return null;
  if(scene._confirmedEnvironmentRenderer!==scene.renderer){
    scene._confirmedEnvironmentTarget?.dispose();
    const generator=new THREE.PMREMGenerator(scene.renderer),room=new RoomEnvironment();
    try{scene._confirmedEnvironmentTarget=generator.fromScene(room,0.04);scene._confirmedEnvironmentRenderer=scene.renderer;}
    finally{room.dispose();generator.dispose();}
  }
  return scene._confirmedEnvironmentTarget.texture;
}

function factory(scene,frame) {
  const meshes=[],q=new THREE.Quaternion(...frame.quat),origin=vec(frame.pos);
  function material(color,type='plastic') {
    color=resolveColor(color);
    const key=`confirmed:${type}:${color}`;
    if(!scene._materials[key]){
      const glass=type==='glass' || type==='glass-edge' || type==='glass-inner';
      scene._materials[key]=glass ? new THREE.MeshPhysicalMaterial({color,roughness:type==='glass-edge'?0.12:0.055,metalness:0,transparent:true,opacity:type==='glass-edge'?0.76:type==='glass-inner'?0.10:0.72,transmission:type==='glass-edge'?0.12:0.94,thickness:type==='glass-edge'?0.18:0.12,ior:1.45,clearcoat:0.45,clearcoatRoughness:0.07,side:THREE.DoubleSide,depthWrite:false})
        : type==='gel-cover' ? new THREE.MeshPhysicalMaterial({color,roughness:0.58,metalness:0,clearcoat:0,ior:1.38,thickness:0.035,transmission:0.88,opacity:1,transparent:false,side:THREE.FrontSide,depthWrite:false})
        : type==='gel-seam' ? new THREE.MeshPhysicalMaterial({color,roughness:0.48,metalness:0,clearcoat:0,ior:1.38,thickness:0.02,transmission:0.65,transparent:true,opacity:0.65,side:THREE.FrontSide,depthWrite:false})
        : type==='gel-bubble' ? new THREE.MeshPhysicalMaterial({color,roughness:0.025,metalness:0,clearcoat:1,clearcoatRoughness:0.012,ior:1.33,thickness:0.015,transparent:true,opacity:0.68,side:THREE.DoubleSide,depthWrite:false})
        : type==='gel-liquid' ? new THREE.MeshPhysicalMaterial({color,roughness:0.045,metalness:0,clearcoat:1,clearcoatRoughness:0.018,ior:1.43,thickness:0.12,side:THREE.DoubleSide})
        : new THREE.MeshPhysicalMaterial({color,roughness:type==='cloth'?0.96:type==='metal'?0.29:type==='coated-metal'?0.50:0.34,metalness:type==='metal'?0.75:type==='coated-metal'?0.10:0,clearcoat:type==='cloth'?0:0.3,clearcoatRoughness:0.2,emissive:color,emissiveIntensity:type==='coated-metal'?0.07:type==='cloth'?0.025:0.045,side:THREE.DoubleSide,...(type==='cloth'?{bumpMap:feltBump(scene),bumpScale:0.07}:{} )});
    }
    const reflective=type.startsWith('glass') || type==='gel-liquid' || type==='gel-bubble' || type==='metal' || type==='coated-metal';
    const environment=reflective?componentEnvironment(scene):null;
    if(environment) {scene._materials[key].envMap=environment;scene._materials[key].envMapIntensity=type==='gel-liquid'?0.12:type==='gel-bubble'?0.38:type==='coated-metal'?0.10:type==='metal'?0.30:0.16;scene._materials[key].userData.confirmedEnvironment='room';}
    return scene._materials[key];
  }
  function add(key,make,color,pos=[0,0,0],rotation=null,type='plastic') {
    const geo=scene._cachedGeo(`confirmed:${key}`,make),mesh=new THREE.Mesh(geo,material(color,type));
    mesh.position.copy(vec(pos).applyQuaternion(q).add(origin));mesh.quaternion.copy(q);if(rotation)mesh.quaternion.multiply(rotation);
    mesh.castShadow=!type.startsWith('glass') && type!=='gel-cover';mesh.receiveShadow=!type.startsWith('glass');mesh.name=key;meshes.push(mesh);return mesh;
  }
  const box=(key,size,color,pos,r=0.2,type='plastic')=>add(key+':'+size.join(','),()=>new RoundedBoxGeometry(...size,2,r),color,pos,null,type);
  const ball=(key,r,color,pos,type='plastic')=>add(`${key}:${r}`,()=>new THREE.SphereGeometry(r,20,12),color,pos,null,type);
  const tube=(key,points,r,color,type='rope')=>add(`${key}:${r}:${JSON.stringify(points)}`,()=>new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(vec)),Math.max(8,points.length*5),r,8,false),color,[0,0,0],null,type);
  const torus=(key,r,th,color,pos,rotation=null,type='plastic')=>add(`${key}:${r}:${th}`,()=>new THREE.TorusGeometry(r,th,10,56),color,pos,rotation,type);
  const text=(value,size,color,pos,type='plastic')=>add(`text:${value}:${size}`,()=>new TextGeometry(String(value),{font,size,depth:0.25,curveSegments:4,bevelEnabled:false}),color,pos,null,type);
  return {meshes,add,box,ball,tube,torus,text};
}

function outline(w,h,feature) {
  const shape=new THREE.Shape(),x=w/2,y=h/2,n=2.7;
  if(feature==='sector') {shape.moveTo(0,0);shape.lineTo(40,0);shape.absarc(0,0,40,0,Math.PI/2,false);shape.lineTo(0,0);return shape;}
  shape.moveTo(-x+n,-y);shape.lineTo(x-n,-y);shape.absarc(x,-y,n,Math.PI,Math.PI/2,true);
  shape.lineTo(x,y-n);shape.absarc(x,y,n,-Math.PI/2,-Math.PI,true);
  if(feature==='castle') {
    for(let i=0;i<8;i++){const xx=x-n-(w-2*n)*(i+0.5)/8;shape.lineTo(xx,y);shape.lineTo(xx,y-(i%2?0:4));shape.lineTo(xx-(w-2*n)/16,y-(i%2?0:4));shape.lineTo(xx-(w-2*n)/16,y);}
  }
  shape.lineTo(-x+n,y);shape.absarc(-x,y,n,0,-Math.PI/2,true);shape.lineTo(-x,-y+n);shape.absarc(-x,-y,n,Math.PI/2,0,true);shape.closePath();return shape;
}
function plateGeometry(w,h,feature,depth=1.2) {
  const shape=outline(w,h,feature);
  if(feature==='holes' || feature==='acrylic_holes')for(const x of [-w*0.28,0,w*0.28])for(const y of [-h*0.28,0,h*0.28])shape.holes.push(new THREE.Path().absarc(x,y,3.2,0,Math.PI*2,true));
  if(feature==='honeycomb')for(let row=-7;row<=7;row++)for(let col=-7;col<=7;col++) {
    const x=col*2.65+(Math.abs(row%2)?1.325:0),y=row*2.65*Math.sqrt(3)/2;if(Math.abs(x)>w/2-2.3 || Math.abs(y)>h/2-2.3)continue;
    const p=new THREE.Path();for(let i=0;i<6;i++){const a=i*Math.PI/3+Math.PI/6,px=x+Math.cos(a)*1.25,py=y+Math.sin(a)*1.25;if(!i)p.moveTo(px,py);else p.lineTo(px,py);}p.closePath();shape.holes.push(p);
  }
  if(feature==='magnet')for(let x=-14;x<=14;x+=2.8)for(let y=-14;y<=14;y+=3.5) {
    const p=new THREE.Path();p.moveTo(x-0.32,y-0.6);p.lineTo(x-0.32,y+0.6);p.absarc(x,y+0.6,0.32,Math.PI,0,true);p.lineTo(x+0.32,y-0.6);p.absarc(x,y-0.6,0.32,0,-Math.PI,true);p.closePath();shape.holes.push(p);
  }
  if(feature==='castle'){const p=new THREE.Path();p.moveTo(-12,-3);p.lineTo(-12,0);p.lineTo(12,0);p.lineTo(12,-3);p.closePath();shape.holes.push(p);}
  return new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:feature!=='acrylic',bevelThickness:feature==='honeycomb'?0.06:0.12,bevelSize:feature==='honeycomb'?0.06:0.12,bevelSegments:2,curveSegments:16});
}
function clips(f,model,part,color='#343a3e') {
  const frame=confirmedFrame(model,part);
  for(const mount of part.mounts||[]) {
    if(!mount)continue;const p=curvePoint(model,mount.tube,mount.t);if(!p)continue;
    const local=worldToLocal(frame,p);
    const before=curvePoint(model,mount.tube,Math.max(0,mount.t-0.01)),after=curvePoint(model,mount.tube,Math.min(1,mount.t+0.01));
    const tangent=vec(after).sub(vec(before)).normalize(),front=vec(frame.axes[2]),across=tangent.clone().cross(front).normalize();
    // 包管弧位于外径之外，扣体和螺丝伸出前方，不能埋在管轴内。
    const wrap=Array.from({length:33},(_,k)=>worldToLocal(frame,vec(p).addScaledVector(front,Math.cos(k*Math.PI/16)*2.8).addScaledVector(across,Math.sin(k*Math.PI/16)*2.8).toArray()));
    f.tube('actual-retainer-wrap:'+mount.tube+':'+mount.t,wrap,0.48,color,'plastic');
    f.box('actual-retainer',[3,3,1.4],color,[local[0],local[1],local[2]+3],0.3);
    f.ball('retainer-screw',0.42,'#c7c9cc',[local[0],local[1],local[2]+3.85],'metal');
  }
}
function panelMeshes(scene,model,part,spec,frame) {
  const f=factory(scene,frame),w=spec.width-3,h=spec.height-3,feature=spec.feature;
  const color=confirmedColor(part)||'#398ddb';
  const clear=['acrylic','acrylic_holes','capsule'].includes(feature);
  if(feature!=='basin' && feature!=='grid' && feature!=='sensory')f.add(`plate:${w}:${h}:${feature}`,()=>plateGeometry(w,h,feature,clear?0.45:1.2),clear?'#eaf7fa':color,[0,0,1.8],null,clear?'glass':feature==='magnet'?'coated-metal':feature==='felt'?'cloth':'plastic');
  if(feature==='plain')for(const x of [-w/2+1,w/2-1])f.box('plain-edge-lip',[1,h-4,0.8],color,[x,0,1.5]);
  if(clear)f.meshes.push(...insetScrewMeshes(scene,model,part,frame));
  if(clear){
    const points=outline(w,h,feature).getPoints(64).map(p=>[p.x,p.y,2.2]);
    f.tube('acrylic-polished-edge',points,0.065,'#bdcdd1','glass-edge');
    if(feature==='acrylic_holes')for(const x of [-w*.28,0,w*.28])for(const y of [-h*.28,0,h*.28])f.torus('acrylic-hole-edge',3.2,0.06,'#beced3',[x,y,2.2],null,'glass-edge');
  }
  if(feature==='capsule') {
    f.add('capsule-hemisphere-r16',()=>{const g=new THREE.SphereGeometry(16,56,36,0,Math.PI*2,0,Math.PI/2);g.rotateX(Math.PI/2);return g;},'#e6f5fa',[0,0,2.3],null,'glass');
    f.add('capsule-inner-shell-r15.65',()=>{const g=new THREE.SphereGeometry(15.65,56,36,0,Math.PI*2,0,Math.PI/2);g.rotateX(Math.PI/2);return g;},'#e4eef0',[0,0,2.3],null,'glass-inner');
    f.torus('capsule-equator',15.82,0.18,'#a9bdc4',[0,0,2.3],null,'glass-edge');
  }
  if(feature==='lego') {
    const height=legoStudHeight(part),z=height===0.7?3.2:3.025+height/2;
    for(let x=-16;x<=16;x+=2.6)for(let y=-16;y<=16;y+=2.6)f.add('lego-stud:'+height,()=>{const g=new THREE.CylinderGeometry(0.78,0.78,height,12);g.rotateX(Math.PI/2);return g;},color,[x,y,z]);
  }
  if(feature==='climbing') {
    const n=spec.height===40?3:spec.height===30?2:1,positions=n===3?[[-9,8],[9,2],[-3,-10]]:n===2?[[0,8],[0,-8]]:[[0,0]];
    positions.forEach(([x,y],i)=>{
      const gripColor=(n===1?['#4ba86a']:['#ed5743','#f3c83f','#4ba86a'])[i];
      f.add(`rounded-grip:${i}`,()=>gripGeometry(i),gripColor,[x,y,3.25]);
      for(const dx of [-1.6,1.6]){
        f.torus('grip-screw-washer',0.62,0.11,'#a0a5a8',[x+dx,y,5.28],null,'metal');
        f.add('grip-screw-face',()=>{const g=new THREE.CylinderGeometry(0.48,0.48,0.22,20);g.rotateX(Math.PI/2);return g;},'#e3e5e5',[x+dx,y,5.37],null,'metal');
        for(const vertical of [true,false])f.tube('grip-screw-cross:'+vertical,vertical?[[x+dx,y-.25,5.50],[x+dx,y+.25,5.50]]:[[x+dx-.25,y,5.50],[x+dx+.25,y,5.50]],0.055,'#4b5053');
      }
    });
  }
  if(feature==='clock') {
    f.add('clock-face',()=>{const g=new THREE.CylinderGeometry(12,12,0.4,56);g.rotateX(Math.PI/2);return g;},'#f4f5ef',[0,0,3]);
    f.torus('clock-marble-track',15.5,0.3,'#eef5f5',[0,0,3.8],null,'glass');
    for(let n=1;n<=12;n++){const a=n*Math.PI/6;f.text(n,1.6,'#1268b0',[Math.sin(a)*9.3-0.8,Math.cos(a)*9.3-0.7,3.5]);f.ball('clock-marble',1,colors[n%6],[Math.sin(a)*14,Math.cos(a)*14,4]);}
    f.tube('clock-hour',[[0,0,4.2],[-4,4,4.2]],0.7,'#ec4f3d','plastic');f.tube('clock-minute',[[0,0,4.4],[7,3,4.4]],0.55,'#237dc8','plastic');f.ball('clock-pivot',1.2,'#257cbf',[0,0,4.6]);
    f.add('clock-clear-cover',()=>{const g=new THREE.CylinderGeometry(16.1,16.1,0.25,56);g.rotateX(Math.PI/2);return g;},'#e8f8ff',[0,0,5.3],null,'glass');
    for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5])f.ball('clock-cover-screw',0.45,'#b7bcc2',[Math.cos(a)*16,Math.sin(a)*16,5.7],'metal');
  }
  if(feature==='maze') {
    const routes=[[[-14,12],[-4,12],[-4,5],[8,5],[8,13],[14,13]], [[-14,1],[-8,1],[-8,-6],[2,-6],[2,0],[14,0]], [[-14,-13],[-2,-13],[-2,-9],[11,-9],[11,-15]]];
    routes.forEach((points,i)=>f.tube('maze-wall:'+i,points.map(([x,y])=>[x,y,3]),0.65,'#dcdfb7','plastic'));
    for(let i=0;i<5;i++){const x=[-12,0,9,-9,0][i],y=[9,5,0,-5,-13][i];f.text(i+1,5,colors[i],[x,y,2.8]);}
    [[-5,12],[10,9],[-11,0],[0,-6],[13,-8],[-6,-13]].forEach(([x,y],i)=>f.ball('maze-bead',0.95,colors[i%6],[x,y,3.7]));
    f.box('maze-acrylic-cover',[33,33,0.35],'#eaf6f9',[0,0,5],1,'glass');for(const x of [-15,15])for(const y of [-15,15])f.ball('maze-screw',0.45,'#aeb6be',[x,y,5.4],'metal');
  }
  if(feature==='magnet') {
    f.box('magnet-square',[5.3,5.3,0.65],'#f4c332',[-5.5,-6,3.42],0.42);
    f.add('magnet-round-disc',()=>extruded(new THREE.Shape().absarc(0,0,3.1,0,Math.PI*2,false),0.55,0.14),'#349edc',[7,5,3.13]);
    for(const [x,y,c] of [[-8,6,'#e65b49'],[9,-7,'#48a467']])f.add('magnet-rounded-triangle',()=>{const s=new THREE.Shape();s.moveTo(0,3.3);s.lineTo(-3,-2.3);s.lineTo(3,-2.3);s.closePath();return extruded(s,0.6,0.24);},c,[x,y,3.13]);
  }
  if(feature==='basketball') {
    for(const x of [-9,9])f.box('basket-target-vertical',[0.8,15,0.2],'#f6f4e9',[x,3,3.1]);for(const y of [-4.5,10.5])f.box('basket-target-horizontal',[18,0.8,0.2],'#f6f4e9',[0,y,3.1]);
    f.box('basket-mount-base',[8,6,1.4],'#efece1',[0,-4,4],0.45);for(const x of [-2.5,2.5])for(const y of [-2,-6])f.ball('basket-base-screw',0.45,'#b4bac0',[x,y,5],'metal');
    f.box('basket-neck',[2,1.8,8],'#f88722',[0,-4,8.5]);f.torus('basket-orange-ring',8,0.75,'#ff8524',[0,-4,16],new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2));
    for(let i=0;i<16;i++)for(const direction of [-1,1]){const points=[];for(let k=0;k<=6;k++){const a=i*Math.PI/8+direction*(k%2?Math.PI/8:0),r=8-k*0.55;points.push([Math.cos(a)*r,-4-k*3.1,16+Math.sin(a)*r]);}f.tube('basket-net:'+i+':'+direction,points,0.13,'#efe6cd');}
    clips(f,model,part,'#929b9f');
  }
  if(feature==='basin') {
    const shape=new THREE.Shape();shape.moveTo(-17,-17);shape.lineTo(17,-17);shape.lineTo(17,17);shape.lineTo(-17,17);shape.closePath();
    f.add('basin-rounded-wall',()=>new ParametricGeometry((u,v,p)=>{const a=u*Math.PI*2,r=17-2.3*v,x=Math.sign(Math.cos(a))*Math.pow(Math.abs(Math.cos(a)),0.28)*r,y=Math.sign(Math.sin(a))*Math.pow(Math.abs(Math.sin(a)),0.28)*r;p.set(x,y,1.5-8*v);},80,18),'#a9acb0');
    f.box('basin-bottom',[29.5,29.5,0.8],'#9a9ea4',[0,0,-6.3],1.8);for(const x of [-19,19])f.box('basin-lip-x',[3,30,0.9],'#b9bdc1',[x,0,1.8],0.45);for(const y of [-19,19])f.box('basin-lip-y',[30,3,0.9],'#b9bdc1',[0,y,1.8],0.45);
  }
  if(feature==='sensory') {
    f.box('gel-welded-white-border',[37,37,0.65],'#f5f3e9',[0,0,2.2],1.8);f.box('gel-liquid-base',[33,33,0.30],'#ffd55b',[0,0,2.55],1.1,'gel-liquid');
    const regions=[[-7,6,7.2,6.9,.35],[5.7,5,8.2,7.6,1],[-3.5,-7,9.2,6.6,2.1],[9,-8,4.8,5.4,2.8]];
    regions.forEach(([x,y,rx,ry,phase],i)=>f.add('gel-fluid-region:'+i,()=>extruded(organicShape(rx,ry,phase),.065,.025),'#ed8b24',[x,y,2.84+i*.012],null,'gel-liquid'));
    f.add('gel-connecting-channel',()=>extruded(organicShape(3.2,1.35,1.6),.045,.02),'#ed8b24',[-.5,6,2.83],null,'gel-liquid');
    for(let i=0;i<14;i++){
      const x=Math.sin(i*6.3)*14,y=Math.cos(i*8.9)*14,rx=.2+(i%4)*.18;
      f.add('gel-liquid-droplet:'+i,()=>extruded(organicShape(rx,rx*.82,i),.03,.015),'#ed8b24',[x,y,2.94],null,'gel-liquid');
    }
    for(let i=0;i<50;i++){
      const x=Math.sin(i*17.1)*14.3,y=Math.cos(i*23.7)*14.3,r=.10+(i%5)*.045;
      f.add('gel-micro-bubble:'+i,()=>{const g=new THREE.SphereGeometry(r,16,10);g.scale(1,1,.14);return g;},'#fff8df',[x,y,3.025],null,'gel-bubble');
      if(i%4===0)f.torus('gel-bubble-meniscus:'+i,r*.9,.018,'#fffdf1',[x,y,3.052],null,'gel-bubble');
    }
    f.add('gel-clear-envelope-micro-crown',()=>{
      const g=new THREE.BoxGeometry(34,34,0.12,32,32,1),p=g.attributes.position;
      for(let i=0;i<p.count;i++)if(p.getZ(i)>0){
        const x=p.getX(i),y=p.getY(i),edge=Math.max(0,Math.min(1,(17-Math.max(Math.abs(x),Math.abs(y)))/1.4));
        // 袋膜仅有亚毫米微鼓与细皱，仍在原有 3.16cm 前缘以内。
        p.setZ(i,.035+edge*(.011*Math.sin(x*.95+y*.32)*Math.cos(y*.8)+.01*Math.cos(x*.25)*Math.cos(y*.21)));
      }
      p.needsUpdate=true;g.computeVertexNormals();return g;
    },'#ffffff',[0,0,3.10],null,'gel-cover');
    const weld=new THREE.Shape();weld.moveTo(-15.3,-16.7);weld.lineTo(15.3,-16.7);weld.quadraticCurveTo(16.7,-16.7,16.7,-15.3);weld.lineTo(16.7,15.3);weld.quadraticCurveTo(16.7,16.7,15.3,16.7);weld.lineTo(-15.3,16.7);weld.quadraticCurveTo(-16.7,16.7,-16.7,15.3);weld.lineTo(-16.7,-15.3);weld.quadraticCurveTo(-16.7,-16.7,-15.3,-16.7);
    f.tube('gel-envelope-weld',weld.getPoints(80).map(p=>[p.x,p.y,3.075]),.045,'#faf5dd','gel-seam');
  }
  if(feature==='felt') {
    for(let i=1;i<=3;i++)f.text(i,5.3,['#dc5544','#298fbf','#399763'][i-1],[-4+(i-1)*7,6,3.2],'cloth');
    const patch=(key,r,c,p)=>f.add(key,()=>{const g=new THREE.SphereGeometry(r,24,12);g.scale(1,1,0.035);return g;},c,p,null,'cloth');
    patch('felt-bear-head',4.5,'#a8754f',[-10.8,7.6,3.2]);for(const x of [-14.1,-7.5])patch('felt-bear-ear',1.65,'#946540',[x,10.7,3.16]);patch('felt-bear-muzzle',2.05,'#ecddbd',[-10.8,6.1,3.4]);for(const x of [-12.3,-9.3])patch('felt-bear-eye',0.32,'#30251e',[x,8.2,3.45]);patch('felt-bear-nose',.48,'#35281f',[-10.8,6.8,3.5]);
    f.tube('felt-bear-mouth',[[-11.5,5.7,3.50],[-10.8,5.3,3.50],[-10.1,5.7,3.50]],.08,'#6c4a32','cloth');f.tube('felt-bear-nose-line',[[-10.8,6.7,3.5],[-10.8,5.35,3.5]],.07,'#6c4a32','cloth');
    f.add('felt-filled-heart',()=>{const s=new THREE.Shape();s.moveTo(0,-3.4);s.bezierCurveTo(-1.3,-2,-4,0.2,-3,2.2);s.bezierCurveTo(-2.3,3.5,-.8,3.5,0,1.8);s.bezierCurveTo(.8,3.5,2.3,3.5,3,2.2);s.bezierCurveTo(4,.2,1.3,-2,0,-3.4);return extruded(s,.20,.10);},'#d85142',[-10,-5.7,3.2],null,'cloth');
    patch('felt-circle',3.2,'#2f98c2',[0,-5.7,3.3]);f.add('felt-triangle',()=>{const s=new THREE.Shape();s.moveTo(0,3.7);s.lineTo(-3.2,-2.7);s.lineTo(3.2,-2.7);s.closePath();return extruded(s,.22,.10);},'#449868',[10,-5.7,3.2],null,'cloth');
    f.add('felt-star',()=>{const s=new THREE.Shape();for(let i=0;i<10;i++){const a=Math.PI/2+i*Math.PI/5,r=i%2?1.25:2.8;i?s.lineTo(Math.cos(a)*r,Math.sin(a)*r):s.moveTo(Math.cos(a)*r,Math.sin(a)*r);}s.closePath();return extruded(s,.18,.08);},'#ffe185',[0,-13,3.2],null,'cloth');
    const seam=outline(w-1.3,h-1.3,'felt').getPoints(80).map(p=>[p.x,p.y,3.08]);f.tube('felt-binding-seam',seam,.055,'#f6df85','cloth');
  }
  if(feature==='grid') {
    for(let x=-17;x<=17;x+=3.4)f.box('grid-vertical',[0.5,34,0.65],'#f6f2e7',[x,0,2]);for(let y=-17;y<=17;y+=3.4)f.box('grid-horizontal',[34,0.5,0.65],'#f6f2e7',[0,y,2]);f.meshes.push(...insetScrewMeshes(scene,model,part,frame));
  }
  return f.meshes;
}

export function confirmedComponentMeshes(scene,model,part) {
  const spec=confirmedSpec(part.panelId||part.kind||part.partId),frame=confirmedFrame(model,part);if(!spec || !frame)return [];
  if(spec.placement==='panel')return panelMeshes(scene,model,part,spec,frame);
  const f=factory(scene,frame);
  if(spec.feature==='sector') {f.add('sector-panel',()=>plateGeometry(40,40,'sector'),part.color||'#348ddd');clips(f,model,part);return f.meshes;}
  if(spec.feature==='roller') {
    const rail=model._rail(part.tube),length=rail.len-12,r=spec.radius;
    f.add(`roller:${length}:${r}`,()=>{const g=new THREE.CylinderGeometry(r,r,length,48);g.rotateZ(Math.PI/2);return g;},'#f0d33f',[0,0,0],null,'cloth');
    for(const side of [-1,1])f.torus('roller-end-seam',r-0.5,0.15,'#dcc032',[side*length/2,0,0],new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2),'cloth');
    return f.meshes;
  }
  if(spec.feature==='rope') {
    for(let strand=0;strand<3;strand++){const points=[];for(let i=0;i<=80;i++){const x=-part.ropeLength/2+i*part.ropeLength/80,a=i*1.4+strand*Math.PI*2/3;points.push([x,-Math.sin(i/80*Math.PI)*1.5+Math.cos(a)*0.2,Math.sin(a)*0.2]);}f.tube('braid:'+strand,points,0.18,'#f0e8d6');}
    for(const mount of part.mounts) {
      const p=worldToLocal(frame,curvePoint(model,mount.tube,mount.t));f.torus('rope-knot',0.7,0.3,'#e9dfc8',p);
      const points=[];const a=curvePoint(model,mount.tube,Math.max(0,mount.t-0.01)),b=curvePoint(model,mount.tube,Math.min(1,mount.t+0.01)),dir=vec(b).sub(vec(a)).normalize(),v=dir.clone().cross(new THREE.Vector3(0,1,0));if(v.length()<0.01)v.copy(dir).cross(new THREE.Vector3(1,0,0));v.normalize();const normal=dir.clone().cross(v).normalize();
      for(let k=0;k<=24;k++){const angle=k*Math.PI/12;points.push(worldToLocal(frame,vec(curvePoint(model,mount.tube,mount.t)).addScaledVector(v,Math.cos(angle)*2.8).addScaledVector(normal,Math.sin(angle)*2.8).toArray()));}f.tube('rope-tube-wrap:'+mount.tube+':'+mount.t,points,0.45,'#e9dfc8');
    }return f.meshes;
  }
  let cor=model.panelCorners(part);
  const curved=spec.mountType==='curved-frame';
  const surface=(u,v)=>curved ? (()=>{const a=curvePoint(model,part.a,v),b=curvePoint(model,part.b,part.curveReverse?1-v:v);return a.map((n,i)=>n+(b[i]-n)*u);})() : cor ? cor[0].map((n,i)=>n+(cor[1][i]-n)*u+(cor[3][i]-n)*v) : null;
  if(!surface(0,0))return [];
  const local=(u,v)=>worldToLocal(frame,surface(u,v));
  if(spec.feature==='cloth' || spec.feature==='cloth-fourway' || spec.feature==='trampoline') {
    const margin=spec.feature==='trampoline'?0.13:spec.feature==='cloth-fourway'?0.12:0.07;
    f.add(`fabric:${spec.id}:${JSON.stringify(part.supportTubes)}:${JSON.stringify(frame)}`,()=>new ParametricGeometry((u,v,p)=>p.fromArray(local(margin+u*(1-2*margin),margin+v*(1-2*margin))),32,36),spec.feature==='trampoline'?'#26292b':curved?'#58a677':'#f0d04a',[0,0,0],null,'cloth');
    for(const edge of [0,1]) {
      const points=Array.from({length:33},(_,i)=>local(edge?1-margin:margin,i/32));f.tube('fabric-edge-seam:'+edge,points,0.12,'#efe4c1','cloth');
    }
    if(spec.feature!=='trampoline')for(const edge of [0,1]) {
      f.add(`continuous-sleeve:${spec.id}:${edge}:${JSON.stringify(frame)}:${JSON.stringify(part.supportTubes)}`,()=>new ParametricGeometry((u,v,target)=>{
        const clearance=spec.feature==='cloth-fourway'?0.12:0.05,param=clearance+u*(1-2*clearance);
        const center=surface(curved?edge:param,curved?param:edge),before=surface(curved?edge:Math.max(0,param-0.01),curved?Math.max(0,param-0.01):edge),after=surface(curved?edge:Math.min(1,param+0.01),curved?Math.min(1,param+0.01):edge);
        const tangent=vec(after).sub(vec(before)).normalize(),cross=tangent.clone().cross(vec(frame.axes[2])).normalize(),normal=cross.clone().cross(tangent).normalize(),angle=v*Math.PI*2;
        target.fromArray(worldToLocal(frame,vec(center).addScaledVector(cross,Math.cos(angle)*2.62).addScaledVector(normal,Math.sin(angle)*2.62).toArray()));
      },36,20),curved?'#58a677':'#f0d04a',[0,0,0],null,'cloth');
    }
    if(spec.feature==='trampoline')for(const mount of part.mounts) {
      const tube=model.tubes.get(mount.tube),p=curvePoint(model,mount.tube,mount.t),ahead=curvePoint(model,mount.tube,Math.min(1,mount.t+0.01)),behind=curvePoint(model,mount.tube,Math.max(0,mount.t-0.01));
      const d=vec(ahead).sub(vec(behind)).normalize(),norm=vec(frame.axes[2]),cross=d.clone().cross(norm).normalize(),points=[];
      for(let i=0;i<=18;i++){const a=i*Math.PI*2/18,wp=vec(p).addScaledVector(norm,Math.cos(a)*2.7).addScaledVector(cross,Math.sin(a)*2.7);points.push(worldToLocal(frame,wp.toArray()));}
      f.tube('fabric-wrap:'+tube.id+':'+mount.t,points,spec.feature==='trampoline'?0.28:0.16,spec.feature==='trampoline'?'#242424':'#eed25d','cloth');
      const e=vec(cor[1]).sub(vec(cor[0])),v=vec(cor[3]).sub(vec(cor[0])),delta=vec(p).sub(vec(cor[0]));
      const u=delta.dot(e)/e.lengthSq(),w=delta.dot(v)/v.lengthSq(),target=vec(surface(Math.max(margin,Math.min(1-margin,u)),Math.max(margin,Math.min(1-margin,w))));
      const start=vec(p).addScaledVector(target.clone().sub(vec(p)).normalize(),2.7);
      f.tube('trampoline-elastic:'+tube.id+':'+mount.t,[worldToLocal(frame,start.toArray()),worldToLocal(frame,target.toArray())],.28,'#242424','cloth');
    }
    if(curved)for(let v=0.15;v<1-margin;v+=0.14)f.tube('curve-quilt:'+v,Array.from({length:16},(_,k)=>local(margin+k*(1-2*margin)/15,v)),0.06,'#d0d5ab','cloth');
  }
  if(spec.feature==='net') {
    for(let i=0;i<=4;i++)for(const along of [true,false]) {
      const pts=Array.from({length:25},(_,k)=>local(along?i/4:k/24,along?k/24:i/4));f.tube('net-strand:'+i+':'+along,pts,0.35,colors[(i+(along?0:2))%6]);
    }
    for(let i=0;i<=4;i++)for(let j=0;j<=4;j++){const p=local(i/4,j/4);f.torus('net-knot',0.6,0.2,colors[(i+j)%6],p);}
    for(const mount of part.mounts) {const p=worldToLocal(frame,curvePoint(model,mount.tube,mount.t));f.torus('net-lacing-loop',2.7,0.32,colors[Math.round(mount.t*8)%6],p,new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2));}
  }
  if(spec.feature==='bridge') {
    rungPositions(part.len).forEach((position,i)=>f.tube('soft-bridge-rung:'+i,[local(position/part.len,0.07),local(position/part.len,0.93)],3,colors[i%6],'cloth'));clips(f,model,part);
  }
  return f.meshes;
}
