import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { storage } from '../engine-api'
import { docToJSON } from './ymodel'

/** 仅由用户确认后的本地备份动作调用；旧标签不会绑定到当前账户或连接 WebSocket。 */
export async function legacyBackupWithTabs() {
  const backup = await storage.legacyBackup()
  const sessions = backup.sessions as Array<{ tabs?: Array<{ tabId?: string; name?: string; model?: unknown }> }>
  const tabModels = []
  for (const session of sessions) for (const tab of session.tabs || []) {
    if (!tab.tabId) continue
    const doc = new Y.Doc()
    const persistence = new IndexeddbPersistence(`quadro.tab.${tab.tabId}`, doc)
    try {
      await persistence.whenSynced
      const data = docToJSON(doc)
      tabModels.push({ tabId: tab.tabId, name: tab.name || '', data: data.nodes.length ? data : tab.model || data })
    } finally {
      await persistence.destroy()
      doc.destroy()
    }
  }
  return { ...backup, tabModels }
}
