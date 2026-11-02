import type { ModelJSON } from '../collab/ymodel'
import { modelContent } from './personalTabs'
import { withAccountWriteLock } from '../sync/writeLock'
import { withRequestDeadline } from '../sync/requestDeadline'
import { readModelSource } from './modelSource'

export type LibrarySnapshot = { name: string; data: ModelJSON; revision: number }
export class LibrarySaveError extends Error {
  status: number
  constructor(status: number) { super(`Model save (${status})`); this.status = status }
}
type Access = { id: string; owner: string; active: () => boolean; normalize: (data: unknown) => ModelJSON | null; signal?: AbortSignal }
type Save = Access & LibrarySnapshot & { saveId: string; parts: unknown; stats?: unknown; baseContent?: string; baseName?: string }

export async function librarySaveIdentity(name: string, data: ModelJSON, previous?: { saveId: string; signature: string }) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([name, modelContent(data)])))
  const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return previous?.signature === signature ? previous : { signature, saveId: crypto.randomUUID() }
}

function check(access: Access, response?: Response) {
  if (!access.active() || response && response.headers.get('X-Builder-User-ID') !== access.owner) throw new Error('Model save account changed')
}
export async function readLibrarySnapshot(access: Access): Promise<LibrarySnapshot> {
  check(access)
  const { response: res, text } = await readModelSource(`/quadro/library/${encodeURIComponent(access.id)}/native?snapshot=1`, {
    credentials: 'include', cache: 'no-store', headers: { 'X-Builder-User-ID': access.owner }, signal: access.signal,
  })
  check(access, res)
  if (!res.ok) throw new LibrarySaveError(res.status)
  const snapshot = JSON.parse(text) as LibrarySnapshot
  check(access)
  const data = access.normalize(snapshot.data)
  if (!data || typeof snapshot.name !== 'string' || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1
    || Number(res.headers.get('X-Library-Revision')) !== snapshot.revision) throw new Error('Invalid model snapshot')
  return { ...snapshot, data }
}

/** 冲突只在云端内容和原基线完全相同时自动重试；双方改动交给显式恢复流程。 */
export async function saveLibraryModel(save: Save): Promise<{ status: 'saved'; revision: number; recovered: boolean } | { status: 'conflict'; remote: LibrarySnapshot }> {
  return withAccountWriteLock(save.owner, async () => {
    let revision = save.revision
    for (let attempt = 0; attempt < 2; attempt++) {
      check(save)
      const { res, body } = await withRequestDeadline(save.signal, async signal => {
        const res = await fetch(`/quadro/library/${encodeURIComponent(save.id)}/native`, {
          method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Builder-User-ID': save.owner, 'X-Builder-Entry': 'editor' },
          body: JSON.stringify({ name: save.name, data: save.data, parts: save.parts, stats: save.stats, revision, saveId: save.saveId }),
          signal,
        })
        check(save, res)
        const body = res.ok || res.status === 409 ? await res.json() as { revision?: number; saveId?: string; reason?: string } : undefined
        check(save)
        return { res, body }
      })
      if (res.ok) {
        const receiptRevision = body?.revision
        if (typeof receiptRevision !== 'number' || !Number.isSafeInteger(receiptRevision) || receiptRevision < 1 || body?.saveId !== save.saveId) throw new Error('Invalid model save receipt')
        return { status: 'saved', revision: receiptRevision, recovered: attempt > 0 }
      }
      if (res.status !== 409) throw new LibrarySaveError(res.status)
      if (body?.reason === 'save_id_reused') throw new Error('Model save identity reused')
      const remote = await readLibrarySnapshot(save)
      if (remote.name === save.name && modelContent(remote.data) === modelContent(save.data)) return { status: 'saved', revision: remote.revision, recovered: true }
      if (attempt === 0 && remote.name === save.baseName && modelContent(remote.data) === save.baseContent) { revision = remote.revision; continue }
      return { status: 'conflict', remote }
    }
    throw new Error('Model save recovery exhausted')
  }, save.signal)
}
