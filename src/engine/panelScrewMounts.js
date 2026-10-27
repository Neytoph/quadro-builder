import { confirmedSpec } from './componentPack.js';
import { geometry } from './catalog.js';

export const PANEL_SCREW_RADIUS=.6;
export const PANEL_SCREW_HEAD_DEPTH=.12;
export const PANEL_SCREW_SHAFT_RADIUS=.18;
export const PANEL_SCREW_SHAFT_LENGTH=2.2;
export const PANEL_LIP_THICKNESS=.12;
export const PANEL_LIP_CLEARANCE=.06;
export const PANEL_LIP_JOIN_DEPTH=.01;
const LIP_SEGMENTS=32;
export function sectorScrewMounts(model,part) {
  if(!part.mounts?.some(m=>m?.role==='arc-retainer'))return part.mounts || [];
  const spec=confirmedSpec(part.kind || part.partId);
  return [part.a,part.b].flatMap(id=>{
    const rail=model._rail(id);if(!rail)return [];
    const start=Math.hypot(...rail.p0.map((v,i)=>v-[part.x,part.y,part.z][i]))<.35?0:1;
    return [4,spec.width-4].map(distance=>({tube:id,t:start+(start?-1:1)*distance/rail.len,role:'panel-screw',width:2}));
  });
}
// 与原厂普通板网格一致：正面距管轴25.1mm，角部给接头让位25.1mm。
export const PANEL_OUTER_FACE=2.51;
export const PANEL_CORNER_RELIEF=2.51;

export function panelLipProfiles(part) {
  const spec=confirmedSpec(part.panelId||part.kind||part.partId);if(!spec)return [];
  const horizontal=part.params?.screwAxis==='horizontal';
  const front=spec.feature==='basin'?2.25:PANEL_OUTER_FACE;
  const inner=geometry().tubeRadius+PANEL_LIP_CLEARANCE,outer=inner+PANEL_LIP_THICKNESS;
  const back=front-geometry().panelThickness+PANEL_LIP_JOIN_DEPTH,edge=0;
  const top=Math.min(back,Math.sqrt(inner*inner-edge*edge)),bottom=-2.2;
  // 同高的内外圆弧截面保留管壁间隙；末端嵌入板身，避免接面共面闪烁。
  const sections=Array.from({length:LIP_SEGMENTS+1},(_,k)=>{
    const z=bottom+(top-bottom)*k/LIP_SEGMENTS;
    return {inner:[Math.sqrt(inner*inner-z*z),z],outer:[Math.sqrt(outer*outer-z*z),z]};
  });
  if(top<back)sections.push({inner:[sections.at(-1).inner[0],back],outer:[sections.at(-1).outer[0],back]});
  if(spec.feature==='sector')return [
    {origin:[spec.width/2,0,0],inward:[0,1,0],along:[1,0,0],length:spec.width-2*inner,sections},
    {origin:[0,spec.height/2,0],inward:[1,0,0],along:[0,1,0],length:spec.height-2*inner,sections},
  ];
  const length=(horizontal?spec.width:spec.height)-2*inner;
  return [-1,1].map(sign=>{
    const inward=horizontal?[0,-sign,0]:[-sign,0,0];
    return {origin:horizontal?[0,sign*spec.height/2,0]:[sign*spec.width/2,0,0],inward,along:[inward[1],-inward[0],0],length,sections};
  });
}

export function panelLipSegments(part) {
  const segments=[];
  for(const lip of panelLipProfiles(part))for(let i=1;i<lip.sections.length;i++){
    const a=lip.sections[i-1],b=lip.sections[i],points=[a.inner,a.outer,b.inner,b.outer];
    const delta=[b.inner[0]+b.outer[0]-a.inner[0]-a.outer[0],b.inner[1]+b.outer[1]-a.inner[1]-a.outer[1]],len=Math.hypot(...delta);
    const tangent=delta.map(v=>v/len),radial=[tangent[1],-tangent[0]];
    const ranges=[radial,tangent].map(axis=>{
      const values=points.map(p=>p[0]*axis[0]+p[1]*axis[1]);return [Math.min(...values),Math.max(...values)];
    });
    const mid=ranges.map(([lo,hi])=>(lo+hi)/2),local=radial.map((v,k)=>v*mid[0]+tangent[k]*mid[1]);
    const vector=p=>lip.inward.map((v,k)=>v*p[0]+(k===2?p[1]:0));
    segments.push({point:lip.origin.map((v,k)=>v+vector(local)[k]),axes:[lip.along,vector(radial),vector(tangent)],half:[lip.length/2,...ranges.map(([lo,hi])=>(hi-lo)/2)]});
  }
  return segments;
}

// 螺丝落在背面唇边的内侧，轴线朝承载管，沿管位置继续采用实际安装引用。
export function panelScrewPose(model,part,frame,mount) {
  const rail=model._rail(mount?.tube),spec=confirmedSpec(part.panelId||part.kind||part.partId);
  if(!rail || !spec || !frame || !Number.isFinite(mount.t))return null;
  const world=rail.p0.map((v,i)=>v+rail.dir[i]*rail.len*mount.t);
  const point=frame.axes.map(axis=>axis.reduce((sum,v,i)=>sum+v*(world[i]-frame.pos[i]),0));
  const tangent=frame.axes.map(axis=>axis.reduce((sum,v,i)=>sum+v*rail.dir[i],0));
  const inward=[-tangent[1],tangent[0],0],length=Math.hypot(inward[0],inward[1]);
  if(length<.999)return null;
  const reference=spec.feature==='sector'?[spec.width/2,spec.height/2]:[0,0];
  const sign=inward[0]*(reference[0]-point[0])+inward[1]*(reference[1]-point[1])<0?-1:1;
  const radial=inward.map(v=>v/length*sign),radius=geometry().tubeRadius+PANEL_LIP_CLEARANCE+PANEL_LIP_THICKNESS,z=.15;
  const across=Math.sqrt(radius*radius-z*z),normal=[radial[0]*across/radius,radial[1]*across/radius,z/radius];
  return {point:[point[0]+radial[0]*across,point[1]+radial[1]*across,z],normal,tangent:[radial[1],-radial[0],0]};
}

export function panelScrewAxes({normal,tangent}) {
  return [tangent,[normal[1]*tangent[2]-normal[2]*tangent[1],normal[2]*tangent[0]-normal[0]*tangent[2],normal[0]*tangent[1]-normal[1]*tangent[0]],normal];
}
