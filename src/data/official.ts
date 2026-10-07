import catalog from './officialModels.json'
import { publicResourceUrl, resourceVersion, ENGINE_VERSION } from '../engine/publicResources.js'

export type OfficialModel = { id: string; name: string }

export const OFFICIAL_MODELS = catalog as OfficialModel[]

export const OFFICIAL_BY_ID = new Map(OFFICIAL_MODELS.map(m => [m.id, m]))

export function officialLibId(id: string) {
  return `official:${id.toUpperCase()}`
}

export function parseOfficialId(id: string): string | null {
  const m = /^(?:official:)?([ABC]\d{4})$/i.exec(String(id).trim())
  return m ? m[1].toUpperCase() : null
}

export function officialQdfPath(id: string) {
  // QDF 和缩略图都在 public/ 里，跟着构建产物走，要带上 base。
  // 写死 `/qdf/…` 的话，部署在子路径下会去站点根目录找，全 404。
  return publicResourceUrl(`qdf/${id.toUpperCase()}.qdf`)
}

export function officialThumbPath(id: string) {
  return publicResourceUrl(`thumbs/official/${id.toUpperCase()}.jpg`)
}

export function officialCacheVersion(id: string) {
  return { resourceVersion: resourceVersion(`qdf/${id.toUpperCase()}.qdf`), parserVersion: ENGINE_VERSION }
}

export function cachedOfficialQdf(entry: { qdf?: string | null; resourceVersion?: string | null; parserVersion?: string } | null, id: string) {
  const version = officialCacheVersion(id)
  return version.resourceVersion && entry?.qdf && entry.resourceVersion === version.resourceVersion && entry.parserVersion === version.parserVersion ? entry.qdf : null
}

export async function fetchOfficialQdf(id: string) {
  const code = parseOfficialId(id)
  if (!code) throw new Error('bad id')
  const res = await fetch(officialQdfPath(code))
  if (!res.ok) throw new Error(`${code} HTTP ${res.status}`)
  const text = await res.text()
  if (!/material3\s*\{/.test(text) && !/^[0-9-].*;/m.test(text)) throw new Error(`${code} not qdf`)
  return text
}
