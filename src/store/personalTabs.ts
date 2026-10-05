import type { ModelJSON } from '../collab/ymodel'

export type SaveState = 'unsaved' | 'local' | 'syncing' | 'synced' | 'failed' | 'conflict' | 'waiting'
export interface PersonalState {
  baseRev?: number
  savedContent?: string
  editGeneration?: number
  saveId?: string
  saveState?: SaveState
  conflictDocId?: string
}

export function samePersonalBinding(state: PersonalState & { docId: string | null },
  expected: { docId: string | null; saveId?: string }): boolean {
  return state.docId === expected.docId && state.saveId === expected.saveId
}

/** 异步存储读取结束后重新核对；过期回执只能留在存档，不能改写当前工作标签。 */
export async function readPersonalBinding<T>(state: PersonalState & { docId: string | null },
  expected: { docId: string | null; saveId?: string }, alive: () => boolean,
  read: () => Promise<T>): Promise<{ value: T } | null> {
  const value = await read()
  return alive() && samePersonalBinding(state, expected) ? { value } : null
}

/** 对象字段顺序不影响内容核对，零件顺序保持模型自己的语义。 */
export function modelContent(data: ModelJSON): string {
  return JSON.stringify(data, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
  })
}

export function personalDecision(state: PersonalState, dirty: boolean, current: ModelJSON,
  remote: { data: ModelJSON; rev: number } | null): 'same' | 'refresh' | 'protect' {
  const content = modelContent(current)
  if (remote && content === modelContent(remote.data)) return 'same'
  if (remote && typeof state.baseRev === 'number' && remote.rev <= state.baseRev) return 'same'
  // dirty=false 在旧版本中只证明点过保存，不能证明画布基于当前存档。
  if (typeof state.baseRev !== 'number' || state.savedContent === undefined) return 'protect'
  if (dirty || content !== state.savedContent) return 'protect'
  return remote ? 'refresh' : 'protect'
}

export function savedRecordState(record: { rev?: number; dirty?: boolean; saveId?: string; syncedSaveId?: string }): SaveState {
  if (record.saveId && record.saveId === record.syncedSaveId) return 'synced'
  if (record.dirty || !Number(record.rev)) return 'local'
  return 'synced'
}

export function displaySaveState(state: PersonalState, dirty: boolean): SaveState {
  if (state.saveState === 'conflict' || state.saveState === 'waiting') return state.saveState
  if (dirty) return 'unsaved'
  return state.saveState || 'unsaved'
}

export function savedGenerationUnchanged(state: PersonalState, generation: number, data: ModelJSON, current: ModelJSON): boolean {
  return (state.editGeneration || 0) === generation && modelContent(data) === modelContent(current)
}
