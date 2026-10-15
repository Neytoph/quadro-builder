import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {insetScrewPose} from './insetPanelMounts.js';

export function insetScrewMeshes(scene,model,part,frame) {
  const meshes=[],rotation=new THREE.Quaternion(...frame.quat),origin=new THREE.Vector3(...frame.pos);
  const material=(groove=false)=>{
    const key=groove?'inset-screw-groove':'inset-screw-clear';
    if(!scene._materials[key])scene._materials[key]=new THREE.MeshPhysicalMaterial({color:groove?'#789292':'#e3eded',roughness:.27,metalness:0,transparent:true,opacity:groove?.55:.72,transmission:groove?0:.18,thickness:.3,ior:1.48,clearcoat:.15,depthWrite:false});
    return scene._materials[key];
  };
  const add=(name,key,make,position,angle=0,groove=false)=>{
    const geometry=scene._cachedGeo(`inset:${key}`,make),mesh=new THREE.Mesh(geometry,material(groove));
    mesh.name=name;mesh.position.fromArray(position).applyQuaternion(rotation).add(origin);mesh.quaternion.copy(rotation).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),angle));mesh.castShadow=false;mesh.receiveShadow=false;meshes.push(mesh);
  };
  const lower=part.panelId==='panel_40x40_busy' ? .9 : 1.95;
  for(const mount of Array.isArray(part.mounts)?part.mounts:[]){
    const pose=insetScrewPose(model,frame,mount);if(!pose)continue;
    const {position:p,inward}=pose,angle=Math.atan2(inward[1],inward[0]),id=`${mount.tube}:${mount.t}`;
    add(`inset-screw-tab:${id}`,`tab:${lower}`,()=>new RoundedBoxGeometry(4,1.8,3.15-lower,2,.2),p.map((v,i)=>v+inward[i]*1.2+(i===2?(lower+3.15)/2:0)),angle);
    add(`inset-screw-shaft:${id}`,'shaft',()=>{const g=new THREE.CylinderGeometry(.24,.24,1.2,16);g.rotateX(Math.PI/2);return g;},[p[0],p[1],p[2]+2.55]);
    add(`inset-screw-head:${id}`,'head',()=>{const g=new THREE.CylinderGeometry(.8,.8,.24,24);g.rotateX(Math.PI/2);return g;},[p[0],p[1],p[2]+3.08]);
    for(const vertical of [false,true])add(`inset-screw-slot:${id}:${vertical}`,`slot:${vertical}`,()=>new THREE.BoxGeometry(vertical?.06:.5,vertical?.5:.06,.04),[p[0],p[1],p[2]+3.21],0,true);
  }
  return meshes;
}
