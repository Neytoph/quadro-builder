type Access = { active: boolean; endsAt?: string; object?: { id: string; docId?: string; backend: string }; kind: string }
let current: Access[] = []
let initialized=false
export function clearSlotAccess(){current=[];initialized=false}
export function updateSlotAccess(slots: Access[]) { current = slots;initialized=true }
export function saveCapacityFull(): boolean { return initialized && !current.some(slot => slot.kind === 'save' && slot.active && !slot.object) }
export function collaborationSpace(): boolean | undefined { return initialized ? current.some(slot => slot.kind === 'shared' && slot.active && !slot.object) : undefined }
export function slotAccess(docId?: string | null, libraryId?: string, planId?: string | null): Access | undefined {
  return current.find(slot => slot.object && (libraryId ? slot.object.id === libraryId : planId ? slot.kind === 'shared' && slot.object.backend === planId : docId && slot.kind === 'save' && slot.object.docId === docId))
}
export function slotLocked(docId?: string | null, libraryId?: string, planId?: string | null): boolean {
  const slot = slotAccess(docId, libraryId, planId)
  if(initialized&&libraryId&&!slot)return true
  return !!slot && (!slot.active || !!slot.endsAt && Date.parse(slot.endsAt) <= Date.now())
}
