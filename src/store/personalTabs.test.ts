import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { storeState } from 'y-indexeddb'
import { BuildModel, buildableTubes, geometry, loadCatalog, panels, parseQDF, storage } from '../engine-api'
import { createTabDoc, dropTabDoc, openTabDoc, readPersonalState, writePersonalState } from '../collab/localDocs'
import type { ModelJSON } from '../collab/ymodel'
import { displaySaveState, modelContent, personalDecision, readPersonalBinding, savedGenerationUnchanged, savedRecordState } from './personalTabs'

// 隔离单元夹具使用真实官方模型；IndexedDB 由测试环境提供，浏览器验收另行执行。
let original: ModelJSON
let changed: ModelJSON
beforeAll(async () => {
  await loadCatalog()
  const model = new BuildModel()
  const qdf = readFileSync(join(process.cwd(), 'src/data/A0128.qdf'), 'utf8')
  const parsed = parseQDF(qdf, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 })
  expect(model.loadJSON(parsed).ok).toBe(true)
  original = model.toJSON() as ModelJSON
  changed = structuredClone(original)
  const first = changed.nodes[0] as Record<string, unknown>
  first.x = Number(first.x || 0) + 10
})

describe('personal tab working baseline', () => {
  it('refreshes a clean saved tab when another device has updated it', () => {
    const state = { baseRev: 1, savedContent: modelContent(original) }
    expect(personalDecision(state, false, original, { rev: 2, data: changed })).toBe('refresh')
  })

  it('protects unknown historical content even when dirty is false', () => {
    expect(personalDecision({}, false, original, { rev: 2, data: changed })).toBe('protect')
    expect(personalDecision({}, false, original, { rev: 2, data: original })).toBe('same')
  })

  it('protects unsaved work but does not create a conflict for the unchanged baseline', () => {
    const state = { baseRev: 1, savedContent: modelContent(original) }
    expect(personalDecision(state, true, changed, { rev: 2, data: original })).toBe('protect')
    expect(personalDecision(state, true, changed, { rev: 1, data: original })).toBe('same')
    expect(personalDecision(state, false, changed, { rev: 2, data: original })).toBe('protect')
  })

  it('preserves work when the remote design was deleted', () => {
    expect(personalDecision({ baseRev: 1, savedContent: modelContent(original) }, false, original, null)).toBe('protect')
  })

  it('a save receipt clears only the generation and content actually saved', () => {
    expect(savedGenerationUnchanged({ editGeneration: 4 }, 4, original, original)).toBe(true)
    expect(savedGenerationUnchanged({ editGeneration: 5 }, 4, original, original)).toBe(false)
    expect(savedGenerationUnchanged({ editGeneration: 4 }, 4, original, changed)).toBe(false)
  })

  it('a delayed conflict-copy read cannot rebind a tab after a newer save', async () => {
    const tab = { docId: 'original', saveId: 'save-1' }
    let finish!: (copy: { id: string }) => void
    const read = readPersonalBinding(tab, { docId: 'original', saveId: 'save-1' }, () => true,
      () => new Promise<{ id: string }>(resolve => { finish = resolve }))
    tab.saveId = 'save-2'
    finish({ id: 'old-conflict-copy' })
    expect(await read).toBeNull()
    expect(tab).toEqual({ docId: 'original', saveId: 'save-2' })
  })

  it('a closed tab rejects delayed storage results while a live matching tab accepts them', async () => {
    const tab = { docId: 'original', saveId: 'save-1' }
    const expected = { ...tab }
    expect(await readPersonalBinding(tab, expected, () => false, async () => 'copy')).toBeNull()
    expect(await readPersonalBinding(tab, expected, () => true, async () => 'copy')).toEqual({ value: 'copy' })
  })

  it('JSON acknowledgement remains synced while its cover is pending; edits and gestures have their own status', () => {
    expect(savedRecordState({ rev: 2, dirty: true, saveId: 's2', syncedSaveId: 's2' })).toBe('synced')
    expect(savedRecordState({ rev: 2, dirty: true, saveId: 's3', syncedSaveId: 's2' })).toBe('local')
    expect(displaySaveState({ saveState: 'synced' }, true)).toBe('unsaved')
    expect(displaySaveState({ saveState: 'waiting' }, true)).toBe('waiting')
    expect(displaySaveState({ saveState: 'conflict' }, true)).toBe('conflict')
  })

  it('persists the baseline with the Yjs document before session debounce and clears obsolete conflict links', async () => {
    storage.setAccountScope('frontend-test')
    const id = `baseline-${Date.now()}`
    const local = createTabDoc(id, original)
    await local.persistence!.whenSynced
    let externalChanges = 0
    local.history.onExternal(() => externalChanges++)
    writePersonalState(local, { baseRev: 1, savedContent: modelContent(original), editGeneration: 4, saveId: 'save-4', saveState: 'syncing', conflictDocId: 'old' })
    writePersonalState(local, { baseRev: 1, savedContent: modelContent(original), editGeneration: 4, saveId: 'save-4', saveState: 'syncing', conflictDocId: undefined })
    expect(externalChanges).toBe(0)
    expect(local.history.canUndo()).toBe(false)
    await storeState(local.persistence!, true)
    await local.persistence!.destroy()
    local.history.destroy()
    local.doc.destroy()
    const restored = await openTabDoc(id, null)
    expect(readPersonalState(restored)).toEqual({ baseRev: 1, savedContent: modelContent(original), editGeneration: 4, saveId: 'save-4', saveState: 'syncing' })
    expect(modelContent(restored.history.toJSON())).toBe(modelContent(original))
    await dropTabDoc(id, restored)
    storage.setAccountScope(null)
  })
})
