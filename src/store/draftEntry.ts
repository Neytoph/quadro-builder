import { readDeviceDraft } from './deviceDrafts'

type Handoff = { name: string; data: unknown; createdAt: number; draft: string }
export function draftHandoff(name: string, data: unknown, draft: string): string {
  const token = crypto.randomUUID()
  sessionStorage.setItem('xmf-draft-handoff:' + token, JSON.stringify({ name, data, draft, createdAt: Date.now() }))
  return token
}
export async function entryDraft(owner: string | null, allowUnassigned: () => boolean) {
  const query = new URLSearchParams(location.search), recovery = query.get('recoverSource'), token = query.get('handoff')
  if (recovery) {
    const unassigned = query.get('unassigned') === '1'
    if (unassigned && !allowUnassigned()) return null
    return { ...await readDeviceDraft(owner, recovery, unassigned), complete: () => { for (const key of ['recoverSource','unassigned']) { const url=new URL(location.href);url.searchParams.delete(key);history.replaceState(null,'',url) } } }
  }
  if (!token || !owner) return null
  const raw = sessionStorage.getItem('xmf-draft-handoff:' + token)
  if (!raw) throw new Error('Draft handoff missing')
  const value = JSON.parse(raw) as Handoff
  if (value.draft !== query.get('draft') || Date.now() - value.createdAt > 86400000) throw new Error('Draft handoff expired')
  return { name: value.name, data: value.data, text: undefined, complete: () => { sessionStorage.removeItem('xmf-draft-handoff:' + token);const url=new URL(location.href);url.searchParams.delete('handoff');history.replaceState(null,'',url) } }
}
