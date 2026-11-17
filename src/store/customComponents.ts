import { getAccountEpoch, getAccountScope } from '../engine/storage.js'
import * as local from './customComponentsLocal'
import type { CustomComponent } from './customComponentsLocal'
export { COMPONENT_LIMIT, fragmentPartCount, fragmentIsComplete } from './customComponentsLocal'
export type { ComponentPart, ComponentFragment, CustomComponent } from './customComponentsLocal'

export type ComponentLibraryData = { components: CustomComponent[]; keys: string[] | null }
type Library = { data: ComponentLibraryData; rev: number; updatedAt: number }
type Account = { id: string; scope: string; epoch: number }
let loaded: { account: Account; value: Library } | null = null
let viewScope: { scope: string; epoch: number } | null = null

function writable() {
  if (viewScope && (viewScope.scope !== getAccountScope() || viewScope.epoch !== getAccountEpoch())) throw new Error('component_account_changed')
}

function account(): Account | null {
  if (!import.meta.env.VITE_SYNC_BASE) return null
  const scope = getAccountScope(), match = /^user:(\d+)$/.exec(scope)
  return match ? { id: match[1], scope, epoch: getAccountEpoch() } : null
}

function active(expected: Account) {
  if (expected.scope !== getAccountScope() || expected.epoch !== getAccountEpoch()) throw new Error('component_account_changed')
}

async function call(expected: Account, body?: { data: ComponentLibraryData; baseRev: number }): Promise<Library> {
  active(expected)
  const base = String(import.meta.env.VITE_SYNC_BASE).replace(/\/$/, '')
  const response = await fetch(`${base}/components`, {
    method: body ? 'PUT' : 'GET', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Builder-User-ID': expected.id },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  active(expected)
  if (response.status === 401 || response.status === 403 || response.headers.get('X-Builder-User-ID') !== expected.id) {
    loaded = null
    throw new Error('component_account_changed')
  }
  if (response.status === 409) throw new Error('components_changed')
  if (!response.ok) throw new Error(`Component storage → ${response.status}`)
  const result = await response.json() as Library
  active(expected)
  if (!Number.isSafeInteger(result.rev) || result.rev < 0 || !Array.isArray(result.data?.components) ||
      !(result.data.keys === null || Array.isArray(result.data.keys) && result.data.keys.every(key => typeof key === 'string'))) {
    throw new Error('Invalid component library')
  }
  return result
}

export async function readComponentLibrary(): Promise<ComponentLibraryData> {
  const scope = getAccountScope(), epoch = getAccountEpoch()
  const expected = account()
  if (!expected) {
    const [components, keys] = await Promise.all([local.listComponents(), local.readComponentConfiguration()])
    if (scope !== getAccountScope() || epoch !== getAccountEpoch()) throw new Error('component_account_changed')
    loaded = null
    viewScope = { scope, epoch }
    return { components, keys }
  }
  const value = await call(expected)
  loaded = { account: expected, value }
  viewScope = { scope, epoch }
  return structuredClone(value.data)
}

async function mutate(change: (data: ComponentLibraryData) => void) {
  const expected = account()
  if (!expected) throw new Error('component_account_changed')
  if (!loaded || loaded.account.scope !== expected.scope || loaded.account.epoch !== expected.epoch) {
    await readComponentLibrary()
  }
  active(expected)
  const previous = loaded!
  const data = structuredClone(previous.value.data)
  change(data)
  const value = await call(expected, { data, baseRev: previous.value.rev })
  active(expected)
  loaded = { account: expected, value }
}

export async function listComponents(): Promise<CustomComponent[]> {
  return (await readComponentLibrary()).components
}

export async function readComponentConfiguration(): Promise<string[] | null> {
  return (await readComponentLibrary()).keys
}

export async function saveComponent(component: CustomComponent): Promise<void> {
  writable()
  if (!account()) return local.saveComponent(component)
  await mutate(data => {
    const index = data.components.findIndex(row => row.id === component.id)
    if (index < 0 && data.components.length >= local.COMPONENT_LIMIT) throw new Error('component_limit')
    if (index < 0) data.components.push(component)
    else data.components[index] = component
  })
}

export async function removeComponent(id: string): Promise<void> {
  writable()
  if (!account()) return local.removeComponent(id)
  await mutate(data => {
    data.components = data.components.filter(row => row.id !== id)
    if (data.keys) data.keys = data.keys.filter(key => key !== `saved:${id}`)
  })
}

export async function saveComponentConfiguration(keys: string[]): Promise<void> {
  writable()
  if (!account()) return local.saveComponentConfiguration(keys)
  await mutate(data => { data.keys = [...new Set(keys)] })
}

export async function canImportLegacyComponents(): Promise<boolean> {
  const expected = account()
  if (!expected) return false
  const legacy = await local.legacyLibrary(expected.id)
  active(expected)
  if (!legacy) return false
  return true
}

export async function importLegacyComponents(): Promise<void> {
  writable()
  const expected = account()
  if (!expected) throw new Error('component_account_changed')
  const legacy = await local.legacyLibrary(expected.id)
  active(expected)
  if (!legacy) return
  await local.claimLegacyLibrary(expected.id)
  active(expected)
  await mutate(data => {
    const ids = new Set(data.components.map(row => row.id))
    const extra = legacy.components.filter(row => !ids.has(row.id))
    if (extra.length + data.components.length > local.COMPONENT_LIMIT) throw new Error('component_limit')
    data.components.push(...extra)
    if (legacy.keys) data.keys = [...new Set([...(data.keys ?? []), ...legacy.keys])]
  })
  active(expected)
  await local.markLegacyImported(expected.id)
}
