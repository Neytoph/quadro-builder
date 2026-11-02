import { confirmedSyncAccount } from '../sync/bootstrap'

export type RoomItem = { id: string; kind: 'furniture' | 'reserved' | 'usable'; x: number; z: number; w: number; d: number }
export type RoomData = { room: { w: number; h: number; d: number }; items: RoomItem[]; mode: string }
export type Room = { id: string; name: string; rev: number; ownerID?: number; data: RoomData }
type Text = (zh: string, en: string, de: string) => string
let owner: number | null | undefined, checkedAt = 0, generation = 0, reuseStartup = true
let pendingIdentity: Promise<number | null> | null = null, pendingList: Promise<Room[]> | null = null
let cached: { owner: number; items: Room[] } | null = null
const listeners = new Set<() => void>()
const accountError = (text: Text) => new Error(text('账号已变化，请重新加载房间', 'Account changed. Reload rooms', 'Konto geändert. Räume erneut laden'))
function invalidate() {
  generation++; owner = undefined; checkedAt = 0; cached = null; pendingIdentity = null; pendingList = null; reuseStartup = false
  for (const listener of listeners) listener()
}
export function onRoomAccountInvalidated(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
window.addEventListener('quadro-account-invalidated', invalidate)
window.addEventListener('focus', invalidate)
window.addEventListener('pageshow', event => { if (event.persisted) invalidate() })
window.addEventListener('storage', event => { if (event.key === null || event.key === 'qh_who') invalidate() })
document.addEventListener('visibilitychange', () => { if (document.hidden) invalidate() })
document.addEventListener('qh-authed', invalidate)
document.addEventListener('qh-identity', event => {
  const who = (event as CustomEvent<{ authenticated: boolean; user_id: number }>).detail
  if (owner !== undefined && owner !== (who.authenticated ? who.user_id : null)) invalidate()
})
async function request(path: string, text: Text) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
    const body = await response.json()
    return { response, body }
  } catch (cause) {
    console.warn('Room request unavailable', cause)
    throw new Error(text('连接异常，请检查网络后重新加载房间', 'Connection issue. Check your network and reload rooms.', 'Verbindungsproblem. Netzwerk prüfen und Räume erneut laden.'), { cause })
  } finally { clearTimeout(timer) }
}
async function account(text: Text): Promise<number | null> {
  if (checkedAt && Date.now() - checkedAt < 30000) return owner ?? null
  if (pendingIdentity) return pendingIdentity
  const version = generation, startup = reuseStartup ? confirmedSyncAccount() : null
  reuseStartup = false
  const pending = (async () => {
    let next: number | null
    if (startup) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(text('无法确认登录状态，请重新加载房间', 'Cannot check sign-in status. Reload rooms.', 'Anmeldestatus nicht erreichbar. Räume erneut laden.'))), 12000) })
      let value: string | null
      try { value = await Promise.race([startup, deadline]) } finally { clearTimeout(timer) }
      next = value === null ? null : Number(value)
    } else {
      const { response, body } = await request('/whoami', text)
      if (!response.ok || typeof body?.authenticated !== 'boolean') throw new Error(text('无法确认登录状态', 'Cannot check sign-in status', 'Anmeldestatus nicht erreichbar'))
      next = body.authenticated ? body.user_id : null
    }
    if (version !== generation) throw accountError(text)
    if (next !== null && (!Number.isSafeInteger(next) || next <= 0)) throw new Error('Invalid room account')
    if (owner !== undefined && owner !== next) { invalidate(); throw accountError(text) }
    owner = next; checkedAt = Date.now(); return next
  })()
  pendingIdentity = pending
  try { return await pending } finally { if (pendingIdentity === pending) pendingIdentity = null }
}
async function read(path: string, expectedOwner: number, version: number, text: Text) {
  const { response, body } = await request('/quadro/rooms' + path + '?expectedUserID=' + expectedOwner, text)
  if (version !== generation) throw accountError(text)
  if (response.status === 401 || body?.code === 'room_account_changed') { invalidate(); throw accountError(text) }
  if (response.status === 404) throw new Error(text('关联房间已删除，保留上次背景', 'Linked room deleted. Previous background kept.', 'Verknüpfter Raum gelöscht. Letzter Hintergrund bleibt.'))
  if (!response.ok) throw new Error(text('房间加载失败，请重试', 'Cannot load rooms. Please retry.', 'Räume nicht ladbar. Bitte erneut versuchen.'))
  if (response.headers.get('X-Room-User-ID') !== String(expectedOwner)) { invalidate(); throw accountError(text) }
  return body
}
export async function readRooms(text: Text, onCached: (items: Room[]) => void): Promise<Room[]> {
  const current = await account(text)
  if (owner !== current) throw accountError(text)
  if (current === null) throw new Error(text('登录后可加载房间', 'Sign in to load rooms', 'Zum Laden der Räume anmelden'))
  if (cached?.owner === current) onCached(structuredClone(cached.items))
  if (pendingList) return pendingList
  const version = generation
  const pending = (async () => {
    const body = await read('', current, version, text)
    const items = body.items.map((room: Room) => ({ ...room, ownerID: current })) as Room[]
    cached = { owner: current, items }; return structuredClone(items)
  })()
  pendingList = pending
  try { return await pending } finally { if (pendingList === pending) pendingList = null }
}
export async function readRoom(room: Room, text: Text): Promise<Room> {
  if (await account(text) !== room.ownerID || owner !== room.ownerID || room.ownerID === undefined) throw accountError(text)
  const body = await read('/' + encodeURIComponent(room.id), room.ownerID, generation, text)
  return { ...body, ownerID: room.ownerID }
}
