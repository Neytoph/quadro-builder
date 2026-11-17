import { getAccountEpoch } from '../engine/storage.js'

export type ComponentPart = { id: string; x?: number; y?: number; z?: number; a?: string; b?: string; color?: string; [key: string]: unknown }
export type ComponentFragment = {
  anchor: number[]
  nodes: ComponentPart[]
  tubes: ComponentPart[]
  panels: ComponentPart[]
  textiles: ComponentPart[]
  clamps: ComponentPart[]
  slides: ComponentPart[]
  fittings: ComponentPart[]
  groups: Array<{ id: string; ids: string[] }>
}
export type CustomComponent = { id: string; name: string; fragment: ComponentFragment; updatedAt: number }

export const COMPONENT_LIMIT = 10

export function fragmentPartCount(fragment: ComponentFragment) {
  return fragment.nodes.length + fragment.tubes.length + fragment.panels.length
    + fragment.textiles.length + fragment.clamps.length + fragment.slides.length + fragment.fittings.length
}

export function fragmentIsComplete(fragment: ComponentFragment) {
  const tubes = new Set(fragment.tubes.map(tube => tube.id))
  const nodes = new Set(fragment.nodes.map(node => node.id))
  const fittings = new Set(fragment.fittings.map(fitting => fitting.id))
  if (fragment.fittings.some(part => typeof part.tube === 'string' && !tubes.has(part.tube))) return false
  if (fragment.nodes.some(node => (typeof node.bearingOn === 'string' && !fittings.has(node.bearingOn))
    || (node.clampOn && !tubes.has(String((node.clampOn as { tubeId: string }).tubeId))))) return false
  if (fragment.fittings.some(part => typeof part.node === 'string' && !nodes.has(part.node))) return false
  return true
}

// 未部署云端的本地版保留原库；托管版的访客使用独立库，不自动读取历史账号数据。
const localDatabase = () => import.meta.env.VITE_SYNC_BASE ? 'quadro.components.v2.anonymous' : 'quadro.components.v1'
function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, transaction: IDBTransaction) => IDBRequest<T>, storeName: string | string[] = 'components', database = localDatabase()): Promise<T> {
  const epoch = getAccountEpoch()
  return new Promise((resolve, reject) => {
    let blocked = false
    const open = indexedDB.open(database, 2)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains('components')) db.createObjectStore('components', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences', { keyPath: 'id' })
    }
    open.onerror = () => reject(open.error)
    open.onblocked = () => { blocked = true; reject(new Error('Component database is blocked by another window')) }
    open.onsuccess = () => {
      const db = open.result
      if (blocked) { db.close(); return }
      if (epoch !== getAccountEpoch()) { db.close(); reject(new Error('component_account_changed')); return }
      db.onversionchange = () => db.close()
      const tx = db.transaction(storeName, mode)
      const request = run(tx.objectStore(Array.isArray(storeName) ? storeName[0] : storeName), tx)
      tx.oncomplete = () => { db.close(); if (epoch !== getAccountEpoch()) reject(new Error('component_account_changed')); else resolve(request.result) }
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || request.error || new Error('Component storage failed')) }
    }
  })
}

export async function listComponents(): Promise<CustomComponent[]> {
  const rows = await transact<CustomComponent[]>('readonly', store => store.getAll())
  return rows.sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))
}

export async function saveComponent(component: CustomComponent): Promise<void> {
  const rows = await listComponents()
  if (!rows.some(row => row.id === component.id) && rows.length >= COMPONENT_LIMIT) throw new Error('component_limit')
  await transact('readwrite', store => store.put(component))
}

export async function removeComponent(id: string): Promise<void> {
  await transact('readwrite', (store, tx) => {
    const preferences = tx.objectStore('preferences')
    const lookup = preferences.get('radial')
    lookup.onsuccess = () => {
      if (lookup.result) preferences.put({ ...lookup.result, keys: lookup.result.keys.filter((key: string) => key !== `saved:${id}`) })
    }
    return store.delete(id)
  }, ['components', 'preferences'])
}

export async function readComponentConfiguration(): Promise<string[] | null> {
  const row = await transact<{ id: string; keys: string[] } | undefined>('readonly', store => store.get('radial'), 'preferences')
  if (!row) return null
  if (!Array.isArray(row.keys) || row.keys.some(key => typeof key !== 'string')) throw new Error('Invalid component configuration')
  return row.keys
}

export async function saveComponentConfiguration(keys: string[]): Promise<void> {
  await transact('readwrite', store => store.put({ id: 'radial', keys: [...new Set(keys)] }), 'preferences')
}

export async function legacyLibrary(userId: string) {
  const database = 'quadro.components.v1'
  const [components, configuration, owner] = await Promise.all([
    transact<CustomComponent[]>('readonly', store => store.getAll(), 'components', database),
    transact<{ keys: string[] } | undefined>('readonly', store => store.get('radial'), 'preferences', database),
    transact<{ userId: string; imported?: boolean } | undefined>('readonly', store => store.get('cloud-owner'), 'preferences', database),
  ])
  if (owner && (owner.userId !== userId || owner.imported)) return null
  const keys = configuration?.keys ?? null
  if (keys !== null && (!Array.isArray(keys) || keys.some(key => typeof key !== 'string'))) throw new Error('Invalid legacy component configuration')
  return components.length > 0 || keys !== null ? { components, keys } : null
}

export async function claimLegacyLibrary(userId: string): Promise<void> {
  await transact('readwrite', (store, tx) => {
    const request = store.get('cloud-owner')
    request.onsuccess = () => {
      if (request.result && request.result.userId !== userId) { tx.abort(); return }
      store.put({ ...request.result, id: 'cloud-owner', userId })
    }
    return request
  }, 'preferences', 'quadro.components.v1')
}

export async function markLegacyImported(userId: string): Promise<void> {
  await transact('readwrite', (store, tx) => {
    const request = store.get('cloud-owner')
    request.onsuccess = () => {
      if (request.result?.userId !== userId) { tx.abort(); return }
      store.put({ ...request.result, imported: true })
    }
    return request
  }, 'preferences', 'quadro.components.v1')
}
