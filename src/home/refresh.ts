type Context = { version: number; roomId: string | null; roomRev: number; name: string; snapshot: unknown; placement?: unknown }
type Room = { id: string; rev: number; name: string; data: unknown }

// 刷新背景只替换房间布局，模型的摆放及零件完全保持。
export function refreshedRoomBackground(current: Context, room: Room): Context | null {
  if (current.roomId !== room.id) throw new Error('Room source changed')
  if (JSON.stringify(current.snapshot) === JSON.stringify(room.data) && current.name === room.name) return null
  return { ...structuredClone(current), name: room.name, roomRev: room.rev, snapshot: structuredClone(room.data) }
}

// 只提示外包范围冲突，不移动零件，也不把外包盒重叠当成精确碰撞。
export function roomBackgroundWarnings(context: Context, bounds: { min: number[]; max: number[] } | null): { outside: boolean; overlap: boolean } {
  const result = { outside: false, overlap: false }
  if (!bounds) return result
  const layout = context.snapshot as { room: { w: number; h: number; d: number }; items: Array<{kind: string; x: number; z: number; elevation: number; w: number; h: number; d: number}> }
  const placement = context.placement as { position: number[]; pivot: number[]; rotation: number } | undefined
  const position = placement?.position || [0,0,0], pivot = placement?.pivot || [0,0,0], angle = (placement?.rotation || 0) * Math.PI / 180
  const points: number[][] = []
  for (const x of [bounds.min[0],bounds.max[0]]) for (const y of [bounds.min[1],bounds.max[1]]) for (const z of [bounds.min[2],bounds.max[2]]) {
    const dx=x-pivot[0],dz=z-pivot[2]
    points.push([dx*Math.cos(angle)+dz*Math.sin(angle)+position[0],y-pivot[1]+position[1],-dx*Math.sin(angle)+dz*Math.cos(angle)+position[2]])
  }
  const min=[0,1,2].map(a=>Math.min(...points.map(p=>p[a]))),max=[0,1,2].map(a=>Math.max(...points.map(p=>p[a])))
  result.outside = [layout.room.w,layout.room.h,layout.room.d].some((size,a)=>min[a]<-.1||max[a]>size+.1)
  result.overlap = layout.items.some(i=>i.kind!=='usable'&&min[0]<i.x+i.w&&max[0]>i.x&&min[1]<i.elevation+i.h&&max[1]>i.elevation&&min[2]<i.z+i.d&&max[2]>i.z)
  return result
}
