import type { LocalDoc } from '../collab/localDocs'
import type { ModelJSON } from '../collab/ymodel'

export type NewModelTarget = { kind: 'share' | 'shared'; slot: number; requestId: string }
type NewModelSave = { name: string; data: ModelJSON; targetKind: 'share' | 'shared'; modelSlot: number; requestId: string }

export function newModelTarget(local: LocalDoc): NewModelTarget | null {
  const state = local.doc.getMap('new-model')
  const stored = state.get('target') as NewModelTarget | undefined
  if (stored) return stored
  const params = new URLSearchParams(location.search)
  const kind = params.get('newModelKind'), slot = Number(params.get('newModelSlot')), requestId = params.get('draft') || ''
  if ((kind !== 'share' && kind !== 'shared') || !Number.isSafeInteger(slot) || slot <= 0 || !/^[a-f0-9-]{36}$/.test(requestId)) return null
  const target: NewModelTarget = { kind, slot, requestId }
  state.set('target', target)
  return target
}

export function pendingNewModel(local: LocalDoc, target: NewModelTarget, name: string, data: ModelJSON): NewModelSave {
  const state = local.doc.getMap('new-model')
  const pending = state.get('pending') as NewModelSave | undefined
  if (pending) return pending
  const body = { name, data, targetKind: target.kind, modelSlot: target.slot, requestId: target.requestId }
  state.set('pending', body)
  return body
}

export function finishNewModel(local: LocalDoc) {
  local.doc.getMap('new-model').delete('pending')
}
