import {it,expect} from 'vitest'
import {PerspectiveCamera,OrthographicCamera,Vector3} from 'three'
import {SceneManager} from './scene.js'

// 投影与资源恢复的隔离夹具；实际 WebGL 图片由浏览器验收另行验证。
it.each(['perspective','orthographic'])('子视锥与原画布框选坐标一致：%s',projection=>{
 const viewport={width:1296,height:810},frame={x:.13,y:.19,width:.61,height:.57}
 const camera=projection==='perspective'?new PerspectiveCamera(48,viewport.width/viewport.height,.1,5000):new OrthographicCamera(-160,160,100,-100,.1,5000)
 camera.position.set(200,130,260);camera.zoom=1.4;camera.lookAt(0,30,0);camera.updateProjectionMatrix();camera.updateMatrixWorld()
 const matrix=camera.projectionMatrix.clone(),points=[new Vector3(0,30,0),new Vector3(50,70,-10),new Vector3(-30,0,45)]
 const expected=points.map(point=>{const p=point.clone().project(camera);return {x:((p.x+1)/2-frame.x)/frame.width,y:((1-p.y)/2-frame.y)/frame.height}})
 let actual:Array<{x:number;y:number}>=[],ratio=2,size={x:viewport.width,y:viewport.height}
 const fixture=Object.create(SceneManager.prototype)
 Object.assign(fixture,{camera,scene:{},_finishMotion(){},requestRender(){},renderer:{getSize(target:{set:(x:number,y:number)=>unknown}){return target.set(size.x,size.y)},getPixelRatio(){return ratio},setPixelRatio(value:number){ratio=value},setSize(x:number,y:number){size={x,y}},render(_scene:unknown,crop:typeof camera){actual=points.map(point=>{const p=point.clone().project(crop);return {x:(p.x+1)/2,y:(1-p.y)/2}})},domElement:{toDataURL(){return 'unit-fixture'}}}})
 fixture.snapshotCrop({width:1536,height:1024,viewport,frame})
 for(let i=0;i<points.length;i++){expect(actual[i].x).toBeCloseTo(expected[i].x,10);expect(actual[i].y).toBeCloseTo(expected[i].y,10)}
 expect(fixture.camera).toBe(camera);expect(camera.projectionMatrix.equals(matrix)).toBe(true);expect(ratio).toBe(2);expect(size).toEqual({x:viewport.width,y:viewport.height})
})
