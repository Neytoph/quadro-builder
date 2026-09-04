import catalog from './officialModels.json'

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
  return `/mdb-files/qdf/${id.toUpperCase()}.qdf`
}

export function officialThumbPath(id: string) {
  return `/thumbs/official/${id.toUpperCase()}.jpg?v=2`
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
