import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { docs, storage, BuildModel, loadCatalog } from '../engine-api'
import { createConfirmedComponentFixture } from '../engine/confirmedComponentExample.js'
import { writeJSON } from './ymodel'
import { legacyBackupWithTabs } from './legacyBackup'

describe('旧设备备份（真实 Yjs 和内存 IndexedDB，未执行下载或登录）', () => {
  it('备份包含旧标签的最新工作，可作为模型 JSON 重开；当前账户不接收旧数据', async () => {
    await loadCatalog()
    const model = createConfirmedComponentFixture('rope').model.toJSON()
    const doc = new Y.Doc()
    const persistence = new IndexeddbPersistence('quadro.tab.legacy-only', doc)
    await persistence.whenSynced
    writeJSON(doc, model, 'legacy-fixture')
    await persistence.destroy(); doc.destroy()
    // 明确创建旧版数据库夹具，不改变实际用户 IndexedDB。
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('quadro.library.v1', 2)
      request.onupgradeneeded = () => {
        for (const name of ['docs', 'session', 'designs']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('session', 'readwrite')
      tx.objectStore('session').put({ id: 'current', tabs: [{ tabId: 'legacy-only', name: 'old work' }] })
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
    })
    db.close()
    storage.setAccountScope('legacy-backup-test')
    const backup = await legacyBackupWithTabs()
    const reopened = new BuildModel()
    expect(reopened.loadJSON(JSON.parse(JSON.stringify(backup.tabModels[0].data))).ok).toBe(true)
    const expected = new BuildModel()
    expect(expected.loadJSON(JSON.parse(JSON.stringify(model))).ok).toBe(true)
    expect(reopened.toJSON()).toEqual(expected.toJSON())
    expect(await docs.listDocs()).toEqual([])
    expect(await docs.loadSession()).toBeNull()
    storage.setAccountScope(null)
  })
})
