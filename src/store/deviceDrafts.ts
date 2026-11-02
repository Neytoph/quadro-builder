import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { docToJSON } from '../collab/ymodel'

type Scope = string
type Reference = { scope: Scope; store: string; key: string; tab?: string }
type Row = { id: string; name?: string; updatedAt?: number; savedAt?: number; deletedAt?: unknown; rev?: number; dirty?: boolean; data?: unknown; qdf?: string; tabs?: Tab[] }
type Tab = { tabId: string; name?: string; dirty?: boolean; docId?: string; planId?: string; libraryId?: string; model?: unknown }
export type DeviceDraft = { reference: string; name: string; updatedAt: number; unassigned: boolean; source: 'session' | 'draft' | 'document' | 'library' | 'old' }

function scopeOf(owner: string | null) {
  if (owner !== null && !/^\d+$/.test(owner)) throw new Error('Invalid account')
  return owner === null ? 'anonymous' : `user:${owner}`
}
function database(scope: Scope) { return scope === 'local' ? 'quadro.library.v1' : `quadro.library.v1.${encodeURIComponent(scope)}` }
async function records(scope: Scope, store: string): Promise<Row[]> {
  const name = database(scope)
  if (!(await indexedDB.databases()).some(db => db.name === name)) return []
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
  try {
    if (!db.objectStoreNames.contains(store)) return []
    return await new Promise<Row[]>((resolve, reject) => { const tx = db.transaction(store, 'readonly'), request = tx.objectStore(store).getAll(); tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error) })
  } finally { db.close() }
}

/** 只列当前账号；未分账号的旧库和访客草稿需要用户明确选择查找。 */
export async function listDeviceDrafts(owner: string | null, includeUnassigned = false): Promise<DeviceDraft[]> {
  const own = scopeOf(owner), scopes = [own]
  if (includeUnassigned) scopes.push(...['local', 'anonymous'].filter(scope => scope !== own))
  const result: DeviceDraft[] = []
  const add = (ref: Reference, name: string, updatedAt: number, source: DeviceDraft['source']) => result.push({ reference: JSON.stringify(ref), name, updatedAt, source, unassigned: ref.scope !== own })
  for (const scope of scopes) {
    const [documents, sessions, library] = await Promise.all(['docs', 'session', 'designs'].map(store => records(scope, store)))
    for (const row of documents) if (!row.deletedAt && row.data && (!row.rev || row.dirty || scope === 'local')) add({ scope, store: 'docs', key: row.id }, row.name || '', row.updatedAt || 0, 'document')
    const seen = new Set<string>()
    for (const session of sessions) for (const tab of session.tabs || []) {
      if (tab.planId || seen.has(tab.tabId)) continue
      if ((tab.docId || tab.libraryId) && !tab.dirty) continue
      if (!tab.dirty && /^(未命名|Untitled|Unbenannt)?$/.test(tab.name || '')) continue
      seen.add(tab.tabId)
      add({ scope, store: 'session', key: session.id, tab: tab.tabId }, tab.name || '', session.savedAt || 0, session.id === 'current' ? 'session' : 'draft')
    }
    for (const row of library) if (!row.deletedAt && row.qdf) add({ scope, store: 'designs', key: row.id }, row.name || row.id, row.updatedAt || 0, 'library')
  }
  if (includeUnassigned) {
    const names = JSON.parse(localStorage.getItem('quadro.designs.index.v1') || '[]') as string[]
    for (const name of names) if (localStorage.getItem('quadro.design.v1.' + name)) add({ scope: 'local', store: 'old', key: 'quadro.design.v1.' + name }, name, 0, 'old')
    if (localStorage.getItem('quadro.autosave.v1')) add({ scope: 'local', store: 'old', key: 'quadro.autosave.v1' }, '', 0, 'old')
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function readDeviceDraft(owner: string | null, reference: string, includeUnassigned = false): Promise<{ name: string; data?: unknown; text?: string }> {
  const ref = JSON.parse(reference) as Reference
  const allowed = await listDeviceDrafts(owner, includeUnassigned)
  if (!allowed.some(row => row.reference === reference)) throw new Error('Draft unavailable for this account')
  if (ref.store === 'old') return { name: allowed.find(row => row.reference === reference)!.name, data: JSON.parse(localStorage.getItem(ref.key)!) }
  const row = (await records(ref.scope, ref.store)).find(row => row.id === ref.key)
  if (!row) throw new Error('Draft no longer available')
  if (ref.store === 'designs') return { name: row.name || '', text: row.qdf }
  if (ref.store === 'docs') return { name: row.name || '', data: row.data }
  const tab = row.tabs!.find(tab => tab.tabId === ref.tab)!
  const doc = new Y.Doc(), suffix = ref.scope === 'local' ? '' : '.' + encodeURIComponent(ref.scope)
  const persistence = new IndexeddbPersistence(`quadro.tab.${tab.tabId}${suffix}`, doc)
  try {
    await persistence.whenSynced
    const data = docToJSON(doc)
    return { name: tab.name || '', data: data.nodes.length ? data : tab.model || data }
  } finally { await persistence.destroy(); doc.destroy() }
}
