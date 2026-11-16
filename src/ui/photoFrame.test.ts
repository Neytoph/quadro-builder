import {describe,it,expect} from 'vitest'
import {presetFrame,resizePhotoFrame,photoSize} from '../../public/photo-render.js'
describe('拍照取景',()=>{
 it.each([3/4,4/3,16/9,9/16])('预设比例和输出尺寸一致 %s',ratio=>{
  const viewport={width:390,height:720},frame=presetFrame(viewport,ratio)
  expect(frame.width/frame.height).toBeCloseTo(ratio,8)
  expect(frame.outputWidth/frame.outputHeight).toBeCloseTo(ratio,8)
  expect(Math.max(frame.outputWidth,frame.outputHeight)).toBe(1536)
  expect(frame.x).toBeGreaterThanOrEqual(0);expect(frame.y+frame.height).toBeLessThanOrEqual(viewport.height)
 })
 it('四边和四角拖动均保持画布边界、可用比例及一致输出',()=>{
  const viewport={width:1213,height:767},start=presetFrame(viewport)
  for(const handle of ['n','s','w','e','nw','ne','sw','se'])for(const dx of [-5000,-130,95,5000])for(const dy of [-5000,-83,201,5000]){
   const frame=resizePhotoFrame(start,handle,dx,dy,viewport)
   expect(frame.x).toBeGreaterThanOrEqual(0);expect(frame.y).toBeGreaterThanOrEqual(0)
   expect(frame.x+frame.width).toBeLessThanOrEqual(viewport.width+.0001);expect(frame.y+frame.height).toBeLessThanOrEqual(viewport.height+.0001)
   expect(frame.width/frame.height).toBeCloseTo(frame.outputWidth/frame.outputHeight,8)
   expect(frame.width/frame.height).toBeGreaterThanOrEqual(1/3);expect(frame.width/frame.height).toBeLessThanOrEqual(3)
  }
 })
 it('单独拖动宽度改变比例；再次选择预设恢复比例',()=>{
  const viewport={width:1280,height:800},initial=presetFrame(viewport),changed=resizePhotoFrame(initial,'e',110,0,viewport)
  expect(changed.width/changed.height).not.toBeCloseTo(4/3,3)
  expect(presetFrame(viewport,9/16).outputWidth).toBe(864)
  expect(photoSize(100)).toEqual({width:1536,height:512})
 })
})
