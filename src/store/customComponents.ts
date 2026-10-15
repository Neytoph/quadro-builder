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

// 组件保存在独立的本机数据库，避免进入模型和 QDF 的同步集合。
function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, transaction: IDBTransaction) => IDBRequest<T>, storeName: string | string[] = 'components'): Promise<T> {
  return new Promise((resolve, reject) => {
    let blocked = false
    const open = indexedDB.open('quadro.components.v1', 2)
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
      db.onversionchange = () => db.close()
      const tx = db.transaction(storeName, mode)
      const request = run(tx.objectStore(Array.isArray(storeName) ? storeName[0] : storeName), tx)
      tx.oncomplete = () => { db.close(); resolve(request.result) }
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || request.error || new Error('Component storage failed')) }
    }
  })
}

export async function listComponents(): Promise<CustomComponent[]> {
  const rows = await transact<CustomComponent[]>('readonly', store => store.getAll())
  return rows.sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))
}

export async function saveComponent(component: CustomComponent): Promise<void> {
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
