import { resolveNodeConnection } from './bom.js';
import { geometry } from './catalog.js';
import { nativeEnvelopes, surfaceTriangles, connectorTriangles, connectorMasks, accessoryTriangles } from './assemblyNativeEnvelopes.js';
import { componentVolumes } from './accessoryPack.js';
import { curvePoint } from './confirmedComponentModel.js';
import { xAxisOf, yAxisOf, zAxisOf, panelNormal, modelMiddle } from './util.js';

const xyz = p => [p.x, p.y, p.z];
const sub = (a,b) => a.map((v,i)=>v-b[i]);
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const unit = a => { const l=Math.hypot(...a)||1;return a.map(v=>v/l); };
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const axes = q => { if(!q)return [[1,0,0],[0,1,0],[0,0,1]];const length=Math.hypot(...q)||1,normal=q.map(v=>v/length);return [xAxisOf(normal),yAxisOf(normal),zAxisOf(normal)]; };
// Frozen conservative bounds measured from public/data/models/{slides,fittings}.json,
// in cm, in exactly the same local frame as the native render meshes.
const NATIVE = {
  slide2:[[-23.1,23.1],[-82.5,16.46],[-2.91,125.7]],'slide-new2':[[-24,24],[-2,98.5],[-123.25,16]],
  'curved-slide2':[[-22.8,66],[-82.5,17],[-2.9,83]],'slide-end2':[[-22.5,22.5],[-2.5,17],[-2.81,45.3]],roof2:[[-43,43],[-89.1,2.83],[-2.83,89.1]],
  'multi-wheel2':[[-2.5,5],[-15.1,15.1],[-15.1,15.1]],'floating-wheel2':[[-7.5,7.5],[-15.1,15.1],[-15.1,15.1]],
  'hub-cap2':[[-10,-2],[-5.5,5.5],[-5.5,5.5]],casters2:[[2.5,14],[-2.5,5],[-2.5,2.5]],
  'steering-lock2':[[2.7,7.9],[-3,3],[-3,3]],bearing2:[[2.5,7.5],[-2.5,2.5],[-2.5,2.5]],
  'bearing-connector4':[[-7.8,2.85],[-2.5,2.5],[-2.85,2.85]],adapter2:[[2.5,8],[-2.5,2.5],[-2.5,2.5]],
  'open-connector2':[[2.5,7.5],[-2.5,2.5],[-2.5,2.5]],'tube-cap2':[[-4.5,-2.1],[-2.5,2.5],[-2.5,2.5]],
  'textil-round2':[[-37,2.52],[-2.52,37],[-2.52,82.52]],'roof-large2':[[-43,123],[-93.34,2.83],[-2.83,93.34]],
  bag2:[[-22.52,22.52],[-20,2.52],[-2.52,42.52]],pool2:[[-62.52,62.52],[-40,2.52],[-2.52,162.52]],'pool-small2':[[-22.52,62.52],[-20,2.52],[-2.52,122.52]],
};
const cardinal=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const cubeBases=cardinal.flatMap(x=>cardinal.filter(y=>Math.abs(dot(x,y))<.01).map(y=>[x,y,cross(x,y)]));
function connectorBasis(resolved){const frame=resolved.frame||axes(resolved.quat),canonical=cardinal.filter((_,i)=>connectorMasks[resolved.type]&(1<<i));for(const rotation of cubeBases){const world=rotation.map(axis=>[0,1,2].map(i=>axis.reduce((sum,v,k)=>sum+v*frame[k][i],0)));const directions=canonical.map(axis=>[0,1,2].map(i=>axis.reduce((sum,v,k)=>sum+v*world[k][i],0)));if(directions.length===resolved.renderDirs.length&&directions.every(axis=>resolved.renderDirs.some(d=>dot(unit(d),axis)>.995)))return world;}return null;}
function nativeBox(p,limits) { const basis=axes(p.quat),middle=limits.map(([a,b])=>(a+b)/2);return {kind:'box',pos:xyz(p).map((v,i)=>v+basis.reduce((s,a,k)=>s+a[i]*middle[k],0)),axes:basis,half:limits.map(([a,b])=>(b-a)/2)}; }
const envelopeCache=new WeakMap();
const portDepthCache=new WeakMap();
export function beginAssemblyCollisionPass(model){envelopeCache.set(model,new Map());portDepthCache.set(model,new Map());}
export function partEnvelope(model,id){const cache=envelopeCache.get(model);if(cache?.has(id))return cache.get(id);const shapes=computeEnvelope(model,id);cache?.set(id,shapes);return shapes;}
function computeEnvelope(model,id) {
  const radius=geometry().tubeRadius||2.45, cs=geometry().connectorSize||5;
  const tube=model.tubes.get(id);
  if(tube) {
    if(tube.link || tube.arm)return [];
    const a=model.nodes.get(tube.a),b=model.nodes.get(tube.b);if(!a||!b)return [];
    if(tube.bow) {
      const u=sub(xyz(a),tube.bowCenter),w=sub(xyz(b),tube.bowCenter),radiusOfBow=(Math.hypot(...u)+Math.hypot(...w))/2,normal=unit(u).map(v=>-v),radial=unit(u),tangent=unit(w.map((v,i)=>v-radial[i]*dot(w,radial)));
      if(Math.abs(radiusOfBow-40)<=.5&&Math.abs(dot(unit(u),unit(w)))<=.02&&accessoryTriangles['round-tube2']){const basis=[tangent,normal,cross(tangent,normal)],pos=xyz(a);return accessoryTriangles['round-tube2'].map(points=>({kind:'triangle',points:points.map(point=>pos.map((v,i)=>v+basis.reduce((sum,axis,k)=>sum+axis[i]*point[k],0)))}));}
      const sagitta=radiusOfBow*(1-Math.cos(Math.PI/128));const out=[];for(let k=0;k<32;k++){const p=curvePoint(model,id,k/32),q=curvePoint(model,id,(k+1)/32);if(p&&q)out.push({kind:'capsule',a:p,b:q,r:radius+sagitta+0.01});}return out;
    }
    let p=xyz(a),q=xyz(b),d=unit(sub(q,p));
    if(tube.geom?.p0 && tube.geom.dir){p=tube.geom.p0.map((v,i)=>v+tube.geom.dir[i]*cs/2);q=tube.geom.p0.map((v,i)=>v+tube.geom.dir[i]*(tube.geom.len+(tube.geom.pad||0)+cs/2));}
    else {p=p.map((v,i)=>v+d[i]*cs/2);q=q.map((v,i)=>v-d[i]*cs/2);}
    return [{kind:'cylinder',a:p,b:q,r:radius}];
  }
  const clamp=model.clamps?.get(id);
  if(clamp){
    const axis=unit(clamp.dir||[1,0,0]),off=clamp.off||[0,0,0];let radial=unit(off);
    if(Math.hypot(...off)<0.01)radial=unit(cross(axis,Math.abs(axis[1])<.9?[0,1,0]:[1,0,0]));
    const art=clamp.connectorId==='tube_clamp'?'clip2':'clamp2';
    if(Math.hypot(...off)>.01&&accessoryTriangles[art]){const basis=art==='clip2'?[axis,radial,unit(cross(axis,radial))]:[axis,unit(cross(radial.map(v=>-v),axis)),radial.map(v=>-v)],pos=xyz(clamp);return accessoryTriangles[art].map(points=>({kind:'triangle',points:points.map(point=>pos.map((v,i)=>v+basis.reduce((sum,axis,k)=>sum+axis[i]*point[k],0)))}));}
    const tangent=unit(cross(axis,radial)),centers=[xyz(clamp)];if(Math.hypot(...off)>.01)centers.push(xyz(clamp).map((v,i)=>v+off[i]));
    const out=[];for(const center of centers)for(let k=0;k<32;k++){const angle=(k+.5)*Math.PI/16,r=radial.map((v,i)=>v*Math.cos(angle)+tangent[i]*Math.sin(angle)),t=unit(cross(axis,r));out.push({kind:'box',pos:center.map((v,i)=>v+r[i]*2.65),axes:[axis,r,t],half:[2.5,.17,2.8*Math.sin(Math.PI/32)]});}return out;
  }
  const node=model.nodes.get(id);
  if(node){
    if(node.c45body){const arm=[...model.tubes.values()].find(t=>t.arm&&(t.a===id||t.b===id)),base=arm&&model.nodes.get(arm.a===id?arm.b:arm.a);if(base){let basis;if(base.c45quat)basis=axes(base.c45quat);else {const ex=unit(node.c45axis||base.c45axis||[1,0,0]),v=sub(xyz(node),xyz(base)),ey=unit(v.map((n,i)=>n-ex[i]*dot(v,ex)));basis=[ex,ey,cross(ex,ey)];}const pos=xyz(base);return accessoryTriangles.connector45_2.map(points=>({kind:'triangle',points:points.map(point=>pos.map((v,i)=>v+basis.reduce((sum,axis,k)=>sum+axis[i]*point[k],0)))}));}}
    const resolved=resolveNodeConnection(model,node);if(!resolved.types.length)return [];const pos=xyz(node),basis=connectorBasis(resolved);if(basis&&connectorTriangles[resolved.type]&&!node.c45body&&!node.part)return connectorTriangles[resolved.type].map(points=>({kind:'triangle',points:points.map(point=>pos.map((v,i)=>v+basis.reduce((sum,axis,k)=>sum+axis[i]*point[k],0)))}));const out=[{kind:'box',pos,axes:axes(node.quat),half:[cs/2,cs/2,cs/2]}];for(const direction of resolved.renderDirs || resolved.worldDirs){const d=unit(direction);out.push({kind:'capsule',a:pos.map((v,i)=>v+d[i]*cs/2),b:pos.map((v,i)=>v+d[i]*7.5),r:2});}return out;}
  const p=model.panels?.get(id)||model.textiles?.get(id);
  if(p) {
    if(p.appearanceVersion)return componentVolumes(model,p).map(b=>({...b,kind:'box'}));
    const c=model.panelCorners(p);if(!c)return [];
    const u=sub(c[1],c[0]),v=sub(c[3],c[0]),center=c[0].map((x,i)=>(x+c[2][i])/2);
    let x=unit(u),normal=panelNormal(unit(u),unit(v),center,modelMiddle(model.nodes.values())).map(n=>n*(p.side<0?-1:1));
    let spanX=Math.hypot(...u),spanY=Math.hypot(...v),pos=center;
    if(p.geom?.quat && p.geom?.p){const basis=axes(p.geom.quat);x=basis[0];normal=basis[2];spanX=p.geom.h+cs;spanY=p.geom.w+cs;pos=p.geom.p;}
    if(p.turned && !p.geom){[spanX,spanY]=[spanY,spanX];x=unit(v);}
    const art=model.textiles?.has(id)?'textil2':'panel2',key=`${art}_${Math.round((spanY-cs)*10)}x${Math.round((spanX-cs)*10)}`,alternate=`${art}_${Math.round((spanX-cs)*10)}x${Math.round((spanY-cs)*10)}`;
    let selected=p.panelId in surfaceTriangles?p.panelId:key;let bins=nativeEnvelopes[selected];if(!bins&&nativeEnvelopes[alternate]){bins=nativeEnvelopes[alternate];selected=alternate;x=unit(cross(normal,x));}
    const basis=[x,unit(cross(normal,x)),normal];
    if(surfaceTriangles[selected])return surfaceTriangles[selected].map(points=>({kind:'triangle',points:points.map(point=>pos.map((v,i)=>v+basis.reduce((sum,axis,k)=>sum+axis[i]*point[k],0)))}));
    if(bins)return bins.map(limits=>{const mid=limits.map(([lo,hi])=>(lo+hi)/2);return {kind:'box',pos:pos.map((v,i)=>v+basis.reduce((s,a,k)=>s+a[i]*mid[k],0)),axes:basis,half:limits.map(([lo,hi])=>(hi-lo)/2)};});
    return [{kind:'box',pos:pos.map((value,i)=>value+normal[i]*.5),axes:basis,half:[spanX/2-2.5,spanY/2-2.5,2.5]}];
  }
  const f=model.fittings?.get(id)||model.slides?.get(id);
  if(f) {
    if(f.appearanceVersion)return componentVolumes(model,f).map(b=>({...b,kind:'box'}));
    if(['pool2','pool-small2'].includes(f.kind)){
      const [width,depth]=f.kind==='pool2'?[120,160]:[80,120];
      if(Math.abs((f.w||width)-width)>1||Math.abs(Math.abs(f.d||depth)-depth)>1){
        // Match SceneManager's non-standard pool lining: four thin walls and
        // a floor inset from the carrier axes. Water/balls are visual contents.
        const pw=f.w||120,ph=f.h||40,pd=f.d||120,dz=pd<0?-1:1,deep=Math.abs(pd),skin=2,inset=2.5,w=pw-2*inset,d=deep-2*inset,h=ph-inset,y=-inset-h/2,z=dz*deep/2;
        return [[w,h,skin,0,y,dz*inset],[w,h,skin,0,y,dz*(deep-inset)],[skin,h,d,-w/2,y,z],[skin,h,d,w/2,y,z],[w,skin,d,0,-ph+skin/2,z]].map(([a,b,c,x,y,z])=>nativeBox(f,[[x-a/2,x+a/2],[y-b/2,y+b/2],[z-c/2,z+c/2]]));
      }
    }
    if(accessoryTriangles[f.kind]){const basis=axes(f.quat),pos=xyz(f).map((v,i)=>v-(f.kind==='pool-small2'?basis[0][i]*20:f.kind==='bag2'?basis[2][i]*20:0));return accessoryTriangles[f.kind].map(points=>({kind:'triangle',points:points.map(point=>pos.map((v,i)=>v+basis.reduce((sum,axis,k)=>sum+axis[i]*point[k],0)))}));}
    if(nativeEnvelopes[f.kind])return nativeEnvelopes[f.kind].map(limits=>nativeBox(f,limits));
    if(NATIVE[f.kind])return [nativeBox(f,NATIVE[f.kind])];
    // Unknown geometry is represented conservatively and reported by the planner.
    return [nativeBox(f,[[-(f.w||32)/2,(f.w||32)/2],[-(f.h||32)/2,(f.h||32)/2],[-(f.d||32)/2,(f.d||32)/2]])];
  }
  return [];
}
function segmentDistance(a,b,c,d){const u=sub(b,a),v=sub(d,c),w=sub(a,c),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w),det=aa*cc-bb*bb;let s=det>1e-8?Math.max(0,Math.min(1,(bb*ee-cc*dd)/det)):0,t=cc>1e-8?(bb*s+ee)/cc:0;if(t<0){t=0;s=aa>1e-8?Math.max(0,Math.min(1,-dd/aa)):0;}else if(t>1){t=1;s=aa>1e-8?Math.max(0,Math.min(1,(bb-dd)/aa)):0;}return Math.hypot(...w.map((x,i)=>x+s*u[i]-t*v[i]));}
function boxSegment(box,a,b,r,padding=[0,0,0]){
  const p=box.axes.map(axis=>dot(sub(a,box.pos),axis)),d=box.axes.map(axis=>dot(sub(b,a),axis));
  const half=box.half.map((h,i)=>h+Math.abs(dot(padding,box.axes[i]))),breaks=[0,1];
  for(let i=0;i<3;i++)if(Math.abs(d[i])>1e-9)for(const side of [-half[i],half[i]]){const t=(side-p[i])/d[i];if(t>0&&t<1)breaks.push(t);}
  breaks.sort((a,b)=>a-b);const distance=t=>p.reduce((sum,v,i)=>{const q=Math.max(0,Math.abs(v+d[i]*t)-half[i]);return sum+q*q;},0);
  let best=Infinity;for(let k=0;k<breaks.length-1;k++){const lo=breaks[k],hi=breaks[k+1],mid=(lo+hi)/2;let A=0,B=0;for(let i=0;i<3;i++){const v=p[i]+d[i]*mid;if(Math.abs(v)>half[i]){const c=p[i]-(v>0?half[i]:-half[i]);A+=d[i]*d[i];B+=c*d[i];}}const t=A>1e-10?Math.max(lo,Math.min(hi,-B/A)):lo;best=Math.min(best,distance(lo),distance(hi),distance(t));}
  return best<(r-0.01)*(r-0.01);
}
function pointTriangleDistance(p,points){const [a,b,c]=points,ab=sub(b,a),ac=sub(c,a),ap=sub(p,a);if(Math.hypot(...cross(ab,ac))<1e-9)return Math.min(...points.map((q,i)=>segmentDistance(p,p,q,points[(i+1)%3])));const d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return Math.hypot(...ap);const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return Math.hypot(...bp);const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);return Math.hypot(...ap.map((x,i)=>x-ab[i]*v));}const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return Math.hypot(...cp);const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);return Math.hypot(...ap.map((x,i)=>x-ac[i]*w));}const va=d3*d6-d5*d4;if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));return Math.hypot(...bp.map((x,i)=>x-(c[i]-b[i])*w));}return Math.abs(dot(ap,unit(cross(ab,ac))));}
function segmentTriangleDistance(a,b,points){const [p,q,r]=points,n=cross(sub(q,p),sub(r,p)),d=sub(b,a),den=dot(n,d);if(Math.abs(den)>1e-10){const t=dot(n,sub(p,a))/den;if(t>=0&&t<=1&&pointTriangleDistance(a.map((v,i)=>v+d[i]*t),points)<1e-7)return 0;}return Math.min(pointTriangleDistance(a,points),pointTriangleDistance(b,points),...points.map((p,i)=>segmentDistance(a,b,p,points[(i+1)%3])));}
function triangleBox(points,box){const relative=points.map(p=>sub(p,box.pos)),edges=points.map((p,i)=>sub(points[(i+1)%3],p)),normal=cross(edges[0],edges[1]);for(const axis of [...box.axes,normal,...edges.flatMap(e=>box.axes.map(a=>cross(e,a)))]){if(Math.hypot(...axis)<1e-9)continue;const projected=relative.map(p=>dot(p,axis)),radius=box.axes.reduce((sum,a,i)=>sum+Math.abs(dot(a,axis))*box.half[i],0);if(Math.min(...projected)>radius-.001||Math.max(...projected)<-radius+.001)return false;}return true;}
function clipPolygonPlane(points,origin,normal,positive){const out=[];for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length],dp=dot(sub(p,origin),normal)*(positive?1:-1),dq=dot(sub(q,origin),normal)*(positive?1:-1);if(dp>=-1e-8)out.push(p);if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);out.push(p.map((v,k)=>v+(q[k]-v)*t));}}return out;}
function triangleCylinderDistance(points,cylinder){const axis=unit(sub(cylinder.b,cylinder.a));let polygon=clipPolygonPlane(points,cylinder.a.map((v,i)=>v+axis[i]*1e-6),axis,true);if(!polygon.length)return Infinity;polygon=clipPolygonPlane(polygon,cylinder.b.map((v,i)=>v-axis[i]*1e-6),axis,false);if(polygon.length<3)return Infinity;return Math.min(...polygon.slice(1,-1).map((p,i)=>segmentTriangleDistance(cylinder.a,cylinder.b,[polygon[0],p,polygon[i+2]])));}
function sweptTriangleTriangle(points,other,pad){
  const vertices=Math.hypot(...pad)>1e-10?[...points.map(p=>sub(p,pad)),...points.map(p=>p.map((v,i)=>v+pad[i]))]:points;
  const edges=points.map((p,i)=>sub(points[(i+1)%3],p)),otherEdges=other.map((p,i)=>sub(other[(i+1)%3],p));
  const normal=cross(edges[0],edges[1]),otherNormal=cross(otherEdges[0],otherEdges[1]);
  const axes=[normal,otherNormal,...edges.map(e=>cross(e,pad)),...edges.flatMap(e=>otherEdges.map(o=>cross(e,o))),...otherEdges.map(e=>cross(pad,e)),...edges.map(e=>cross(normal,e)),...otherEdges.map(e=>cross(otherNormal,e))];
  for(const raw of axes){const length=Math.hypot(...raw);if(length<1e-10)continue;const axis=raw.map(v=>v/length),a=vertices.map(p=>dot(p,axis)),b=other.map(p=>dot(p,axis));const loA=Math.min(...a),hiA=Math.max(...a),loB=Math.min(...b),hiB=Math.max(...b);if(hiA-loA>1e-6 || hiB-loB>1e-6){if(hiA<=loB+1e-6 || hiB<=loA+1e-6)return false;}else if(hiA<loB-1e-6 || hiB<loA-1e-6)return false;}
  return true;
}
function triangleOverlap(triangle,other,padding){
  const points=triangle.points,pad=Array.isArray(padding)?padding:[0,0,0];
  const surfaces=[points];
  if(Math.hypot(...pad)>1e-8){const start=points.map(p=>p.map((v,i)=>v-pad[i])),end=points.map(p=>p.map((v,i)=>v+pad[i]));surfaces.push(start,end);for(let i=0;i<3;i++){const j=(i+1)%3;surfaces.push([start[i],start[j],end[j]],[start[i],end[j],end[i]]);}}
  if(other.kind==='cylinder')return prismContainsPoint(points,pad,other.a)||prismContainsPoint(points,pad,other.b)||surfaces.some(points=>triangleCylinderDistance(points,other)<other.r-.005);
  if(other.kind==='capsule')return prismContainsPoint(points,pad,other.a)||prismContainsPoint(points,pad,other.b)||surfaces.some(points=>segmentTriangleDistance(other.a,other.b,points)<other.r-.005);
  if(other.kind==='triangle')return sweptTriangleTriangle(points,other.points,pad);
  return sweptTriangleBox(points,pad,other);
}
// Test the whole swept solid, including an obstacle fully enclosed between its faces.
function prismContainsPoint(points,pad,point){
  if(Math.hypot(...pad)<1e-9)return false;
  const edges=points.map((p,i)=>sub(points[(i+1)%3],p)),normal=cross(edges[0],edges[1]);
  const vertices=[...points.map(p=>sub(p,pad)),...points.map(p=>p.map((v,i)=>v+pad[i]))];
  for(const raw of [normal,...edges.map(e=>cross(e,pad)),...edges.map(e=>cross(e,normal))]){
    const length=Math.hypot(...raw);if(length<1e-9)continue;const axis=raw.map(v=>v/length),range=vertices.map(p=>dot(p,axis)),value=dot(point,axis);
    if(value<=Math.min(...range)+1e-7||value>=Math.max(...range)-1e-7)return false;
  }
  return true;
}
function sweptTriangleBox(points,pad,box){
  if(Math.hypot(...pad)<1e-9)return triangleBox(points,box);
  const edges=points.map((p,i)=>sub(points[(i+1)%3],p)),normal=cross(edges[0],edges[1]);
  const vertices=[...points.map(p=>sub(p,pad)),...points.map(p=>p.map((v,i)=>v+pad[i]))].map(p=>sub(p,box.pos));
  const axes=[...box.axes,normal,...edges.map(e=>cross(e,pad)),...[...edges,pad].flatMap(e=>box.axes.map(a=>cross(e,a)))];
  for(const raw of axes){const length=Math.hypot(...raw);if(length<1e-9)continue;const axis=raw.map(v=>v/length),range=vertices.map(p=>dot(p,axis)),radius=box.axes.reduce((sum,a,i)=>sum+Math.abs(dot(a,axis))*box.half[i],0);if(Math.min(...range)>radius-.001||Math.max(...range)<-radius+.001)return false;}
  return true;
}
function finitePipeCapsSeparate(a,b,padding){
  const extent=(shape,axis)=>{const along=dot(unit(sub(shape.b,shape.a)),axis),radius=shape.kind==='cylinder'?shape.r*Math.sqrt(Math.max(0,1-along*along)):shape.r;return [Math.min(dot(shape.a,axis),dot(shape.b,axis))-radius,Math.max(dot(shape.a,axis),dot(shape.b,axis))+radius];};
  for(const pipe of [a,b].filter(shape=>shape.kind==='cylinder')){const axis=unit(sub(pipe.b,pipe.a)),A=extent(a,axis),B=extent(b,axis),pad=Array.isArray(padding)?Math.abs(dot(padding,axis)):padding;if(A[1]+pad<=B[0]+1e-6||B[1]<=A[0]-pad+1e-6)return true;}
  return false;
}
export function assemblyShapesOverlap(a,b,padding=[0,0,0]){if(a.kind==='triangle')return triangleOverlap(a,b,padding);if(b.kind==='triangle')return triangleOverlap(b,a,padding);const pad=Array.isArray(padding)?Math.hypot(...padding):padding,vector=Array.isArray(padding)?padding:[0,0,0];if(['capsule','cylinder'].includes(a.kind)&&['capsule','cylinder'].includes(b.kind)){if(finitePipeCapsSeparate(a,b,padding))return false;return segmentDistance(a.a,a.b,b.a,b.b)<a.r+b.r+pad-0.03;}if(['capsule','cylinder'].includes(a.kind))return boxSegment(b,a.a,a.b,a.r,vector);if(['capsule','cylinder'].includes(b.kind))return boxSegment(a,b.a,b.b,b.r,vector);const delta=sub(b.pos,a.pos);for(const axis of [...a.axes,...b.axes,...a.axes.flatMap(x=>b.axes.map(y=>cross(x,y)))]){if(Math.hypot(...axis)<1e-7)continue;const ra=a.axes.reduce((s,x,i)=>s+Math.abs(dot(x,axis))*a.half[i],0),rb=b.axes.reduce((s,x,i)=>s+Math.abs(dot(x,axis))*b.half[i],0);if(Math.abs(dot(delta,axis))>=ra+rb+Math.abs(dot(vector,axis))-0.03)return false;}return true;}
const move=(shape,delta)=>shape.kind==='triangle'?{...shape,points:shape.points.map(p=>p.map((v,i)=>v+delta[i]))}:['capsule','cylinder'].includes(shape.kind)?{...shape,a:shape.a.map((v,i)=>v+delta[i]),b:shape.b.map((v,i)=>v+delta[i])}:{...shape,pos:shape.pos.map((v,i)=>v+delta[i])};
const boundsCache=new WeakMap();
function shapeBounds(shape){if(boundsCache.has(shape))return boundsCache.get(shape);const bounds=computeShapeBounds(shape);boundsCache.set(shape,bounds);return bounds;}
function computeShapeBounds(shape){ if(shape.kind==='triangle')return [0,1,2].map(i=>[Math.min(...shape.points.map(p=>p[i])),Math.max(...shape.points.map(p=>p[i]))]);if(['capsule','cylinder'].includes(shape.kind))return shape.a.map((v,i)=>[Math.min(v,shape.b[i])-shape.r,Math.max(v,shape.b[i])+shape.r]);return shape.pos.map((v,i)=>{const radius=shape.axes.reduce((s,a,k)=>s+Math.abs(a[i])*shape.half[k],0);return [v-radius,v+radius];}); }
const envelopeBoundsCache=new WeakMap();
function envelopeBounds(shapes){if(envelopeBoundsCache.has(shapes))return envelopeBoundsCache.get(shapes);const out=[0,1,2].map(i=>[Math.min(...shapes.map(s=>shapeBounds(s)[i][0])),Math.max(...shapes.map(s=>shapeBounds(s)[i][1]))]);envelopeBoundsCache.set(shapes,out);return out;}
const intersects=(a,b)=>a.every(([lo,hi],i)=>lo<b[i][1]+0.01&&hi>b[i][0]-0.01);
const shapeIndexCache=new WeakMap(),INDEX_CELL=8;
function cellsForBounds(bounds){const ranges=bounds.map(([lo,hi])=>[Math.floor((lo-.011)/INDEX_CELL),Math.floor((hi+.011)/INDEX_CELL)]);if(ranges.reduce((n,[lo,hi])=>n*(hi-lo+1),1)>512)return null;const out=[];for(let x=ranges[0][0];x<=ranges[0][1];x++)for(let y=ranges[1][0];y<=ranges[1][1];y++)for(let z=ranges[2][0];z<=ranges[2][1];z++)out.push(`${x},${y},${z}`);return out;}
function indexedShapes(shapes,bounds){
  if(shapes.length<64)return shapes;
  let index=shapeIndexCache.get(shapes);if(!index){index={bins:new Map(),wide:[]};for(const shape of shapes){const cells=cellsForBounds(shapeBounds(shape));if(!cells){index.wide.push(shape);continue;}for(const cell of cells){if(!index.bins.has(cell))index.bins.set(cell,[]);index.bins.get(cell).push(shape);}}shapeIndexCache.set(shapes,index);}
  const cells=cellsForBounds(bounds);if(!cells)return shapes;const found=new Set(index.wide);for(const cell of cells)for(const shape of index.bins.get(cell)||[])found.add(shape);return [...found];
}
function matingPortDepth(model,nodeId,direction){
  const cache=portDepthCache.get(model),key=`${nodeId}:${direction.join(',')}`;if(cache?.has(key))return cache.get(key);
  const node=model.nodes.get(nodeId);if(!node)return 7.5;
  // Use the measured mouth plane: saved quaternion rounding can put it just
  // beyond 7.5 cm along the tube axis. This clips only the occupied port span.
  const origin=xyz(node),triangles=partEnvelope(model,nodeId).filter(shape=>shape.kind==='triangle');
  const depth=triangles.length?Math.max(geometry().connectorSize/2,...triangles.flatMap(shape=>shape.points.map(point=>dot(sub(point,origin),direction)))):7.5;
  cache?.set(key,depth);return depth;
}
function panelSlotContact(model,id,obstacleId,shape,delta,obstacleOffset){
  const panel=model.panels?.get(id)||model.textiles?.get(id),tube=model.tubes.get(obstacleId);
  if(!panel||!tube||shape.kind!=='box'||Math.hypot(...sub(delta,obstacleOffset))>10)return false;
  const corners=model.panelCorners(panel);if(!corners)return false;
  const rail=model._rail(tube.id);if(!rail)return false;
  const carrier=[panel.a,panel.b].includes(tube.id)||corners.some((p,i)=>{
    const q=corners[(i+1)%4],direction=unit(sub(q,p));
    if(Math.abs(dot(direction,rail.dir))<.995)return false;
    const difference=sub(rail.p0,p),along=dot(difference,direction);
    return Math.hypot(...difference.map((v,j)=>v-direction[j]*along))<.6;
  });
  if(!carrier)return false;
  const lineA=rail.p0.map((v,i)=>v+obstacleOffset[i]),lineB=lineA.map((v,i)=>v+rail.dir[i]*rail.len);
  const vertices=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])vertices.push(shape.pos.map((v,i)=>v+shape.axes.reduce((s,axis,k)=>s+axis[i]*shape.half[k]*[x,y,z][k],0)));
  // Only measured lip/wrap bins entirely inside the 4.5 cm carrier-slot band.
  return vertices.every(p=>segmentDistance(p.map((v,i)=>v+delta[i]),p.map((v,i)=>v+delta[i]),lineA,lineB)<4.5);
}
function sharedPanelLipContact(model,id,obstacleId,a,b,delta,end,pad,obstacleOffset){
  const panel=model.panels?.get(id),other=model.panels?.get(obstacleId);
  if(!panel||!other||a.kind!=='triangle'||b.kind!=='triangle')return false;
  const relative=sub(delta,obstacleOffset);if(Math.hypot(...relative)+Math.hypot(...pad)>10)return false;
  const corners=model.panelCorners(panel);if(!corners)return false;
  const normal=unit(cross(sub(corners[1],corners[0]),sub(corners[3],corners[0])));
  if(Math.hypot(...relative)>1e-6&&Math.abs(dot(unit(relative),normal))<.995)return false;
  const final=a.points.map(p=>p.map((v,i)=>v+end[i])),fixed=b.points.map(p=>p.map((v,i)=>v+obstacleOffset[i]));
  const face=unit(cross(sub(fixed[1],fixed[0]),sub(fixed[2],fixed[0]))),movingFace=unit(cross(sub(final[1],final[0]),sub(final[2],final[0])));
  // Only a final coplanar lip contact is exempted; crossing faces remain collisions.
  if(Math.abs(dot(face,movingFace))<.999||final.some(p=>Math.abs(dot(sub(p,fixed[0]),face))>.001))return false;
  const carriers=[panel.a,panel.b].filter(t=>t&&[other.a,other.b].includes(t));
  for(const carrier of carriers){
    const rail=model._rail(carrier);if(!rail)continue;const axis=unit(rail.dir),origin=rail.p0.map((v,i)=>v+obstacleOffset[i]);
    const radial=unit(cross(axis,Math.abs(axis[1])<.9?[0,1,0]:[1,0,0])),tangent=cross(axis,radial);
    const planes=[{origin,normal:axis.map(v=>-v)},{origin:origin.map((v,i)=>v+axis[i]*rail.len),normal:axis}];
    // An inscribed 16-sided band is wholly inside the measured 4.5 cm slot band.
    for(let k=0;k<16;k++){const angle=k*Math.PI/8,n=radial.map((v,i)=>v*Math.cos(angle)+tangent[i]*Math.sin(angle));planes.push({origin:origin.map((v,i)=>v+n[i]*4.5*Math.cos(Math.PI/16)),normal:n});}
    let collisionOutside=false;
    for(const plane of planes){const outside=clipPolygonPlane(fixed,plane.origin,plane.normal,true);for(let i=1;i<outside.length-1;i++)if(assemblyShapesOverlap(move(a,delta),{kind:'triangle',points:[outside[0],outside[i],outside[i+1]]},pad)){collisionOutside=true;break;}if(collisionOutside)break;}
    if(!collisionOutside)return true;
  }
  return false;
}
function entryPanelContact(model,id,obstacleId,a,b,delta,end,pad,obstacleOffset,contracts){
  const contract=contracts.get(`${id}:${obstacleId}`),panel=model.panels?.get(id),slide=model.slides?.get(obstacleId);
  if(!contract||contract.panelId!==id||contract.slideId!==obstacleId||!panel||slide?.kind!=='slide2'||a.kind!=='triangle'||b.kind!=='triangle')return false;
  const rail=model._rail(contract.railId),corners=model.panelCorners(panel);if(!rail||!corners)return false;
  const basis=axes(slide.quat),[across,up,forward]=basis,origin=xyz(slide),normal=unit(cross(sub(corners[1],corners[0]),sub(corners[3],corners[0])));
  if(Math.abs(dot(normal,up))<.995||Math.abs(dot(unit(rail.dir),across))<.995||Math.abs(rail.len-40)>.6)return false;
  const railEnd=rail.p0.map((v,i)=>v+rail.dir[i]*rail.len),near=(p,q)=>Math.hypot(...sub(p,q))<.6;
  if(!corners.some((p,i)=>{const q=corners[(i+1)%4];return near(p,rail.p0)&&near(q,railEnd)||near(q,rail.p0)&&near(p,railEnd);}))return false;
  // The native body's entrance is centered on this exact 40 cm cross rail;
  // the entrance plate extends behind it, rather than into the chute.
  const center=rail.p0.map((v,i)=>(v+railEnd[i])/2),panelCenter=corners[0].map((v,i)=>(v+corners[2][i])/2);
  if(!near(center,origin)||dot(sub(panelCenter,origin),forward)>-.6)return false;
  const nativeNormal=panel.geom?.quat?axes(panel.geom.quat)[2]:panelNormal(unit(sub(corners[1],corners[0])),unit(sub(corners[3],corners[0])),panelCenter,modelMiddle(model.nodes.values())).map(v=>v*(panel.side<0?-1:1));
  if(dot(nativeNormal,up)<.995||panel.geom?.p&&!near(panel.geom.p,panelCenter))return false;
  const relative=sub(delta,obstacleOffset),finalRelative=sub(end,obstacleOffset);
  if(Math.hypot(...finalRelative)>1e-6||Math.hypot(...relative)+Math.hypot(...pad)>10)return false;
  if(dot(relative,up)<-1e-6||Math.hypot(...relative.map((v,i)=>v-up[i]*dot(relative,up)))>1e-6||Math.hypot(...pad)>1e-6&&Math.abs(dot(unit(pad),up))<.995)return false;
  // Official slide installation joins this plate from above. Native triangles
  // intersect only in the entrance hook strip (-2.91..0 cm in local Z).
  // Crop that finite strip only; every portion outside still collides normally.
  const planes=[{origin:origin.map((v,i)=>v-across[i]*20),normal:across.map(v=>-v)},{origin:origin.map((v,i)=>v+across[i]*20),normal:across},{origin:origin.map((v,i)=>v-forward[i]*2.91),normal:forward.map(v=>-v)},{origin,normal:forward}];
  for(let k=0;k<16;k++){const angle=k*Math.PI/8,n=up.map((v,i)=>v*Math.cos(angle)+forward[i]*Math.sin(angle));planes.push({origin:origin.map((v,i)=>v+n[i]*4.5*Math.cos(Math.PI/16)),normal:n});}
  for(const plane of planes){const outside=clipPolygonPlane(a.points,plane.origin,plane.normal,true);for(let i=1;i<outside.length-1;i++)if(assemblyShapesOverlap(move({kind:'triangle',points:[outside[0],outside[i],outside[i+1]]},delta),move(b,obstacleOffset),pad))return false;}
  return true;
}
function linerSleeveContact(model,id,obstacleId,a,b,delta,end,pad,obstacleOffset,contracts){
  const movingLiner=model.fittings?.has(id),linerId=movingLiner?id:obstacleId,nodeId=movingLiner?obstacleId:id,contract=contracts.get(`${linerId}:${nodeId}`),liner=model.fittings?.get(linerId),node=model.nodes.get(nodeId);
  if(!contract||contract.linerId!==linerId||contract.nodeId!==nodeId||!['pool2','pool-small2'].includes(liner?.kind)||!node||a.kind!=='triangle'||b.kind!=='triangle')return false;
  const carriers=contract.carrierPartIds?.map(id=>model.tubes.get(id));if(carriers?.length!==2||carriers.some(t=>!t||t.arm||t.link||t.bow||![t.a,t.b].includes(nodeId)))return false;
  const basis=axes(liner.quat),width=liner.w||(liner.kind==='pool2'?120:80),depth=liner.d||(liner.kind==='pool2'?160:120),poolOrigin=xyz(liner),corners=[[-width/2,0,0],[width/2,0,0],[width/2,0,depth],[-width/2,0,depth]].map(p=>poolOrigin.map((v,i)=>v+basis.reduce((sum,d,k)=>sum+d[i]*p[k],0)));
  if(!carriers.every(t=>corners.some((p,i)=>[t.a,t.b].every(id=>segmentDistance(xyz(model.nodes.get(id)),xyz(model.nodes.get(id)),p,corners[(i+1)%4])<.6))))return false;
  const directions=carriers.map(t=>unit(model._tubeDirAt(t,node,model.nodes.get(t.a===nodeId?t.b:t.a)))),axis=directions[0];
  if(dot(axis,directions[1])>-.995||Math.abs(dot(axis,unit(contract.axis||[])))<.995)return false;
  const resolved=resolveNodeConnection(model,node);if(![1,-1].every(sign=>resolved.renderDirs.some(d=>dot(unit(d),axis)*sign>.995)))return false;
  const relative=sub(delta,obstacleOffset);if(Math.hypot(...sub(end,obstacleOffset))>1e-6||Math.hypot(...relative)+Math.hypot(...pad)>7.5+1e-6)return false;
  if(Math.hypot(...relative.map((v,i)=>v-axis[i]*dot(relative,axis)))>.01||Math.hypot(...pad)>1e-6&&Math.abs(dot(unit(pad),axis))<.995)return false;
  const sleeve=movingLiner?a:b,connector=movingLiner?b:a,origin=xyz(node),radiusAt=p=>{const v=sub(p,origin),along=dot(v,axis);return Math.hypot(...v.map((x,i)=>x-axis[i]*along));};
  // Identify the factory circular sleeve faces by their source vertex radius.
  // Wall/floor faces have vertices away from this ring and cannot use the rule.
  if(!sleeve.points.every(p=>radiusAt(p)>=2.50&&radiusAt(p)<=2.54))return false;
  const radial=unit(cross(axis,Math.abs(axis[1])<.9?[0,1,0]:[1,0,0])),tangent=cross(axis,radial),planes=[{origin:origin.map((v,i)=>v-axis[i]*7.5),normal:axis.map(v=>-v)},{origin:origin.map((v,i)=>v+axis[i]*7.5),normal:axis}];
  // Only intersections inside the source-native 2.52 cm circle and actual middle
  // port span explain the sleeve mesh's inward chords; side branches stay solid.
  for(let k=0;k<64;k++){const angle=k*Math.PI/32,n=radial.map((v,i)=>v*Math.cos(angle)+tangent[i]*Math.sin(angle));planes.push({origin:origin.map((v,i)=>v+n[i]*2.52*Math.cos(Math.PI/64)),normal:n});}
  for(const plane of planes){const outside=clipPolygonPlane(connector.points,plane.origin,plane.normal,true);for(let i=1;i<outside.length-1;i++){const remaining={kind:'triangle',points:[outside[0],outside[i],outside[i+1]]};if(assemblyShapesOverlap(move(movingLiner?sleeve:remaining,delta),move(movingLiner?remaining:sleeve,obstacleOffset),pad))return false;}}
  return true;
}
export function assemblyFittingBoreContact(model,id,obstacleId,a,b,delta,end,pad,obstacleOffset,contracts){
  const contract=contracts.get(`${id}:${obstacleId}`),fitting=model.fittings?.get(id),support=model.fittings?.get(obstacleId)||model.nodes.get(obstacleId);
  if(!contract||contract.fittingId!==id||contract.supportId!==obstacleId||!fitting||!support||a.kind!=='triangle'||b.kind!=='triangle')return false;
  const axis=axes(fitting.quat)[0],origin=xyz(support),radius=contract.kind==='wheel-bearing'?2.5:2.1;
  if(dot(axis,unit(contract.axis||[]))<.995)return false;
  if(contract.kind==='wheel-bearing'){
    const offset=sub(xyz(fitting),origin),along=dot(offset,axis);
    if(fitting.kind!=='multi-wheel2'||support.kind!=='bearing2'||dot(axes(support.quat)[0],axis)<.999999||Math.abs(along-5)>.01||Math.hypot(...offset.map((v,i)=>v-axis[i]*along))>1e-4)return false;
  }else if(contract.kind==='node-stub'){
    if(!['bearing2','adapter2'].includes(fitting.kind)||!model.nodes.has(obstacleId)||Math.hypot(...sub(xyz(fitting),origin))>1e-4||!resolveNodeConnection(model,support).renderDirs.some(d=>dot(unit(d),axis)>.999999))return false;
  }else return false;
  const relative=sub(delta,obstacleOffset);if(Math.hypot(...sub(end,obstacleOffset))>1e-6||Math.hypot(...relative)+Math.hypot(...pad)>7.5+1e-6||dot(relative,axis)<-1e-6||Math.hypot(...relative.map((v,i)=>v-axis[i]*dot(relative,axis)))>1e-4||Math.hypot(...pad)>1e-6&&Math.abs(dot(unit(pad),axis))<.999999)return false;
  const normal=unit(cross(sub(b.points[1],b.points[0]),sub(b.points[2],b.points[0]))),movingNormal=unit(cross(sub(a.points[1],a.points[0]),sub(a.points[2],a.points[0]))),fixed=move(b,obstacleOffset),moving=move(a,delta);
  // Factory wheel/bearing cylindrical facets can use different diagonals on
  // the same source-native circular wall. End caps and cones remain obstacles.
  const rim=contract.kind==='wheel-bearing'&&b.points.every(p=>Math.abs(dot(sub(p,origin),axis)-7.5)<1e-6)&&b.points.every((p,i)=>Math.hypot(...sub(p,b.points[(i+1)%3]))<=.6);
  if((!rim&&Math.abs(dot(normal,axis))>.02)||Math.abs(dot(movingNormal,axis))>.02)return false;
  if(contract.kind==='node-stub'&&(Math.abs(dot(normal,movingNormal))<.999||moving.points.some(p=>Math.abs(dot(sub(p,fixed.points[0]),normal))>.001)))return false;
  const radiusAt=p=>{const v=sub(p,origin),along=dot(v,axis);return Math.hypot(...v.map((x,i)=>x-axis[i]*along));};
  if(![...a.points,...b.points].every(p=>Math.abs(radiusAt(p)-radius)<.01))return false;
  // A small native ear at the shaft's outer circular rim is another boundary
  // facet of this joint. Annular/full-cap triangles and other ends do not qualify.
  if(rim)return true;
  for(const [along,positive]of [[2.5,false],[7.5,true]]){const outside=clipPolygonPlane(b.points,origin.map((v,i)=>v+axis[i]*along),axis,positive);for(let i=1;i<outside.length-1;i++){const points=[outside[0],outside[i],outside[i+1]];if(Math.hypot(...cross(sub(points[1],points[0]),sub(points[2],points[0])))<1e-9)continue;if(assemblyShapesOverlap(moving,move({kind:'triangle',points},obstacleOffset),pad))return false;}}
  return true;
}
/** Full conservative swept geometry; contacts are exempted only inside the mating port. */
export function checkAssemblyPath(model,movingIds,installedIds,start,end=[0,0,0],{allowMating=true,obstacleTranslations=new Map(),matingContacts=new Map(),entryPanelContacts=new Map(),linerCarrierContacts=new Map(),fittingMatingContacts=new Map(),movingAssemblyIds=movingIds}={}) {
  const started=performance.now();const timing=()=>{const elapsed=performance.now()-started;if(globalThis.process?.env?.ASSEMBLY_PROFILE && elapsed>200)globalThis.process.stderr.write(JSON.stringify({elapsed:Math.round(elapsed),moving:movingIds.length,installed:installedIds.length,first:movingIds.slice(0,3),start,end})+'\n');};
  const moving=new Set(movingIds),travel=Math.hypot(...sub(start,end)),spacing=geometry().tubeRadius||2.45,count=Math.max(1,Math.ceil(travel/spacing));
  const assemblyMoving=new Set(movingAssemblyIds);
  const midpoint=start.map((v,i)=>(v+end[i])/2),fullPad=sub(end,start).map(v=>v/2);
  const shiftBounds=(bounds,offset)=>bounds.map(([lo,hi],i)=>[lo+offset[i],hi+offset[i]]);
  const obstacles=[...new Set(installedIds)].filter(id=>!moving.has(id)).map(id=>{const offset=obstacleTranslations.get(id)||[0,0,0],shapes=partEnvelope(model,id);return {id,offset,shapes,bounds:shiftBounds(envelopeBounds(shapes),offset)};});
  const adapterMap=new Map();for(const t of model.tubes.values())if(t.arm){if(!adapterMap.has(t.a))adapterMap.set(t.a,[]);if(!adapterMap.has(t.b))adapterMap.set(t.b,[]);adapterMap.get(t.a).push(t.b);adapterMap.get(t.b).push(t.a);}
  for(const id of movingIds){const shapes=partEnvelope(model,id);if(!shapes.length)continue;const movingBounds=envelopeBounds(shapes).map(([lo,hi],i)=>[lo+Math.min(start[i],end[i])-spacing/2,hi+Math.max(start[i],end[i])+spacing/2]);for(const obstacle of obstacles){if(!obstacle.shapes.length||!intersects(movingBounds,obstacle.bounds))continue;
    const pairs=shapes.flatMap(a=>{const bounds=shapeBounds(a).map(([lo,hi],i)=>[lo+Math.min(start[i],end[i])-spacing/2,hi+Math.max(start[i],end[i])+spacing/2]),localBounds=shiftBounds(bounds,obstacle.offset.map(v=>-v));return indexedShapes(obstacle.shapes,localBounds).filter(b=>{
      if(!intersects(localBounds,shapeBounds(b)))return false;
      // Exact whole-segment SAT proves these pairs clear before sampling. Keep
      // short intervals for all remaining pairs and for joint-contact checks.
      const exactSweep=a.kind==='triangle'&&['triangle','box'].includes(b.kind)||b.kind==='triangle'&&a.kind==='box';
      return count<=2||!exactSweep||assemblyShapesOverlap(move(a,midpoint),move(b,obstacle.offset),fullPad);
    }).map(b=>[a,b]);});
    if(!pairs.length)continue;
    const t=model.tubes.get(id),o=model.tubes.get(obstacle.id),shared=t&&o?[t.a,t.b].filter(n=>n===o.a||n===o.b):[];
    for(let sample=0;sample<count;sample++){
      const delta=start.map((v,i)=>v+(end[i]-v)*(sample+.5)/count),pad=sub(end,start).map(v=>v/count/2);
      const adapterIds=id=>adapterMap.get(id)||[];
      const adapterContacts=model.nodes.has(id)&&o ? [o.a,o.b].filter(n=>adapterIds(id).includes(n)) : t&&model.nodes.has(obstacle.id) ? [t.a,t.b].filter(n=>adapterIds(obstacle.id).includes(n)) : [];
      const declaredContacts=(matingContacts.get(`${id}:${obstacle.id}`)||[]).filter(nodeId=>model.nodes.has(nodeId));
      const contacts=allowMating ? [...new Set([...shared,...adapterContacts,...declaredContacts,...(t&&[t.a,t.b].includes(obstacle.id)?[obstacle.id]:[]),...(o&&[o.a,o.b].includes(id)?[id]:[])])]:[];
      for(const [a,b] of pairs){
        if(!assemblyShapesOverlap(move(a,delta),move(b,obstacle.offset),pad))continue;
        if(allowMating&&panelSlotContact(model,id,obstacle.id,a,delta,obstacle.offset))continue;
        if(allowMating&&sharedPanelLipContact(model,id,obstacle.id,a,b,delta,end,pad,obstacle.offset))continue;
        if(allowMating&&entryPanelContact(model,id,obstacle.id,a,b,delta,end,pad,obstacle.offset,entryPanelContacts))continue;
        if(allowMating&&linerSleeveContact(model,id,obstacle.id,a,b,delta,end,pad,obstacle.offset,linerCarrierContacts))continue;
        if(allowMating&&assemblyFittingBoreContact(model,id,obstacle.id,a,b,delta,end,pad,obstacle.offset,fittingMatingContacts))continue;
        // Connector/tube contact at the destination is valid only near the actual node.
        // No whole shared tube is excluded: clip both tubes away from the joint and test again.
        const relative=sub(delta,obstacle.offset),portTube=t||o;
        const contactAxes=contacts.flatMap(nodeId=>{const tube=assemblyMoving.has(nodeId)&&o?o:portTube;if(!tube||![tube.a,tube.b].includes(nodeId))return [];return [unit(model._tubeDirAt(tube,model.nodes.get(nodeId),model.nodes.get(nodeId===tube.a?tube.b:tube.a)))];});
        const portAxes=contactAxes.length?contactAxes:portTube?[unit(sub(xyz(model.nodes.get(portTube.b)),xyz(model.nodes.get(portTube.a))))]:[];
        const coaxial=portAxes.length&&portAxes.every(portAxis=>Math.hypot(...relative.map((v,i)=>v-portAxis[i]*dot(relative,portAxis)))<.6 && (travel<1e-6 || Math.abs(dot(unit(sub(end,start)),portAxis))>.995));
        if(contacts.length && coaxial && Math.hypot(...relative)+Math.hypot(...pad)<7.5+1e-6){
          const trim=(shape,tube)=>{if(!['capsule','cylinder'].includes(shape.kind)||!tube)return shape;let p=[...shape.a],q=[...shape.b];const d=unit(sub(q,p));for(const n of contacts){const pos=xyz(model.nodes.get(n));if(Math.hypot(...sub(p,pos))<8){const depth=matingPortDepth(model,n,d);p=p.map((v,i)=>v+d[i]*(depth-dot(sub(p,pos),d)));}if(Math.hypot(...sub(q,pos))<8){const depth=matingPortDepth(model,n,d.map(v=>-v));q=q.map((v,i)=>v-d[i]*(depth+dot(sub(q,pos),d)));}}if(dot(sub(q,p),d)<=0)return null;return {...shape,a:p,b:q};};
          const ta=trim(a,t),tb=trim(b,o);if(!ta||!tb||!assemblyShapesOverlap(move(ta,delta),move(tb,obstacle.offset),pad))continue;
        }
        timing();return {movingPartId:id,obstaclePartId:obstacle.id,movingTubeId:id,obstacleTubeId:obstacle.id,sample,pathSamples:count+1,sampleSpacing:travel/count,translation:delta,envelope:'complete-conservative',movingShape:a,obstacleShape:b};
      }
    }
  }}
  timing();return null;
}
