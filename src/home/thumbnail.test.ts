import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {createHomeVisuals} from './visuals.js';
import {fitRoomPreview,normalizeRoomPreview} from './thumbnail.js';

describe('房间三维缩略图',()=>{
  const visuals=createHomeVisuals(THREE,RoundedBoxGeometry);
  for(const room of [{w:450,d:350,h:260},{w:100,d:2000,h:50},{w:2000,d:100,h:2000},{w:100,d:100,h:2000}])it('完整容纳房间 '+JSON.stringify(room),()=>{
    const root=visuals.roomShell(room),camera=new THREE.OrthographicCamera();
    fitRoomPreview(camera,root,room,4/3);camera.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(root);
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const point=new THREE.Vector3(x,y,z).project(camera);
      expect(Math.abs(point.x)).toBeLessThan(1);expect(Math.abs(point.y)).toBeLessThan(1);expect(Math.abs(point.z)).toBeLessThan(1);
    }
    root.traverse((o:THREE.Object3D)=>{const mesh=o as THREE.Mesh;mesh.geometry?.dispose();const materials=mesh.material?Array.isArray(mesh.material)?mesh.material:[mesh.material]:[];for(const material of materials)material.dispose()});
  });
  it('保留家具高度、朝向、离地和区域体积，拒绝不合法几何',()=>{
    const item={type:'cabinet',kind:'furniture',x:20,z:30,w:80,d:40,h:100,elevation:50,rotation:270},data={room:{w:450,d:350,h:260},items:[item]};
    expect(normalizeRoomPreview(data).items[0]).toEqual(item);
    for(const change of [{h:NaN},{elevation:-1},{h:300},{rotation:45},{x:500}])expect(()=>normalizeRoomPreview({...data,items:[{...item,...change}]})).toThrow();
  });
});
