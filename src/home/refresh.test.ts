import { describe, expect, it } from 'vitest'
import { refreshedRoomBackground, roomBackgroundWarnings } from './refresh'

describe('room background refresh',()=>{
 const snapshot={mode:'furniture',room:{w:400,d:300,h:260},items:[]}
 const original={version:1,roomId:'room-a',roomRev:1,name:'客厅',snapshot,placement:{position:[125,0,180],rotation:90,pivot:[20,0,20]}}
 it('preserves model placement and leaves the previous snapshot available',()=>{
  const next=refreshedRoomBackground(original,{id:'room-a',rev:2,name:'客厅',data:{...snapshot,room:{...snapshot.room,w:450}}})!
  expect(next.placement).toEqual(original.placement)
  expect(next.roomRev).toBe(2)
  expect(original.snapshot.room.w).toBe(400)
  expect(next.snapshot).not.toBe(original.snapshot)
 })
 it('does not redraw for a revision-only change such as list ordering',()=>{
  expect(refreshedRoomBackground(original,{id:'room-a',rev:5,name:'客厅',data:structuredClone(snapshot)})).toBeNull()
 })
 it('rejects switching the source during an in-flight refresh',()=>{
  expect(()=>refreshedRoomBackground(original,{id:'other',rev:2,name:'客厅',data:snapshot})).toThrow()
 })
 it('checks rotated placement, keeps usable areas out of obstacle warnings, and warns on reserved areas',()=>{
  const context={...original,placement:{position:[390,0,150],pivot:[0,0,0],rotation:90}}
  const bounds={min:[0,0,0],max:[100,100,50]}
  expect(roomBackgroundWarnings(context,bounds)).toEqual({outside:true,overlap:false})
  const item={kind:'usable',x:300,z:0,elevation:0,w:100,h:260,d:300}
  const inside={...context,placement:{...context.placement,position:[340,0,150]},snapshot:{...snapshot,items:[item]}}
  expect(roomBackgroundWarnings(inside,bounds)).toEqual({outside:false,overlap:false})
  inside.snapshot.items[0].kind='reserved'
  expect(roomBackgroundWarnings(inside,bounds)).toEqual({outside:false,overlap:true})
 })
})
