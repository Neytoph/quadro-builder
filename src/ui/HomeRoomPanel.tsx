import { useState } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { HOME_STYLE } from '../home/visuals.js'

type Room = { id: string; name: string; rev: number; ownerID?: number; data: { room: { w: number; h: number; d: number }; items: unknown[]; mode: string } }
export default function HomeRoomPanel() {
  const api = useEngine(), { lang } = useI18n()
  const demo = new URLSearchParams(location.search).has('homeDemo')
  const prefix = lang === 'zh' ? '' : '/' + lang
  const text = (zh: string, en: string, de: string) => lang === 'zh' ? zh : lang === 'de' ? de : en
  const [open, setOpen] = useState(false), [rooms, setRooms] = useState<Room[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const identity = async () => {
    const response = await fetch('/whoami', { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error(text('无法确认登录状态', 'Cannot check sign-in status', 'Anmeldestatus nicht erreichbar'))
    const body = await response.json()
    if (!body.authenticated) throw new Error(text('登录后可加载我的家', 'Sign in to load your home', 'Zum Laden deines Zuhauses anmelden'))
    return body.user_id as number
  }
  if (api.grassOn) return null
  const context = api.homeContext
  const load = async () => {
    setOpen(true); setLoading(true); setError('')
    try {
      if (demo) { setRooms(JSON.parse(localStorage.getItem('xmf-home-demo-rooms') || '[]')); return }
      const owner = await identity()
      const response = await fetch('/quadro/rooms?expectedUserID=' + owner, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? text('登录后可加载我的家', 'Sign in to load your home', 'Zum Laden deines Zuhauses anmelden') : text('房间加载失败，请重试', 'Cannot load rooms. Please retry.', 'Räume nicht ladbar. Bitte erneut versuchen.'))
      const body = await response.json()
      if (await identity() !== owner) throw new Error(text('账号已变化，请重新加载房间', 'Account changed. Reload rooms', 'Konto geändert. Räume erneut laden'))
      setRooms(body.items.map((room: Room) => ({ ...room, ownerID: owner })))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  const choose = async (room: Room) => {
    setError('')
    try {
      if (!demo && await identity() !== room.ownerID) throw new Error(text('账号已变化，请重新加载房间', 'Account changed. Reload rooms', 'Konto geändert. Räume erneut laden'))
      if (!api.bindHome(room)) throw new Error(text('请先完成当前操作，再加载房间', 'Finish your current action before loading a room', 'Aktuelle Aktion vor dem Laden abschließen'))
      setOpen(false)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const edit = () => {
    const key = 'xmf-home-session:' + crypto.randomUUID()
    sessionStorage.setItem(key, JSON.stringify({ id: context!.roomId, rev: context!.roomRev, name: context!.name, data: context!.snapshot, placement: context!.placement }))
    location.href = prefix + '/home-editor.html?session=' + encodeURIComponent(key) + '&return=builder' + (demo ? '&demo=1' : '')
  }
  const button = 'min-h-11 rounded-xl border border-orange-200 bg-[#FFFCF9] px-3 text-sm text-[#9A3412] cursor-pointer'
  return <div className="pointer-events-auto relative mt-2 max-w-[min(300px,calc(100vw-90px))] rounded-2xl border border-orange-200 bg-[#FFFCF9]/95 p-2 shadow-sm text-[#242833] max-[640px]:fixed max-[640px]:inset-x-3 max-[640px]:bottom-20 max-[640px]:mt-0 max-[640px]:max-w-none max-[640px]:max-h-[55dvh] max-[640px]:overflow-auto">
    {context ? <><div className="flex items-center justify-between gap-2"><strong className="block min-w-0 break-words px-1 text-sm">{context.name}</strong><button className={button + ' min-[641px]:hidden shrink-0'} aria-expanded={expanded} onClick={() => { setExpanded(!expanded); if (expanded) setOpen(false) }}>{expanded ? '×' : text('房间', 'Room', 'Raum')}</button></div><div className={'mt-1 flex-wrap gap-1 min-[641px]:flex ' + (expanded ? 'flex' : 'hidden')}><button className={button} onClick={() => void load()}>{text('更换房间', 'Change room', 'Raum wechseln')}</button><button className={button} onClick={edit}>{text('编辑房间', 'Edit room', 'Raum bearbeiten')}</button><button className={button} onClick={() => api.bindHome(null)}>{text('移除房间', 'Remove room', 'Raum entfernen')}</button><button className={button} onClick={api.frameHome}>{text('查看全屋', 'View room', 'Raum ansehen')}</button></div></> : <button className={button} onClick={() => void load()}>{text('加载我的家', 'Load my home', 'Mein Zuhause laden')}</button>}
    {context && <p className={'mt-2 px-1 text-xs leading-relaxed text-[#676b73] min-[641px]:block ' + (expanded ? 'block' : 'hidden')}>
      {text('房间宽 × 深 × 高', 'Room width × depth × height', 'Raum: Breite × Tiefe × Höhe')}<br />
      {context.snapshot.room.w} × {context.snapshot.room.d} × {context.snapshot.room.h} cm<br />
      {text(`地面每格 ${HOME_STYLE.gridCell} cm · 同一比例`, `${HOME_STYLE.gridCell} cm floor grid · Same scale`, `${HOME_STYLE.gridCell} cm Bodenraster · Einheitlicher Maßstab`)}
    </p>}
    {open && <div role="dialog" aria-label={text('选择房间', 'Choose room', 'Raum wählen')} className="mt-2 max-h-[45dvh] overflow-auto border-t border-orange-100 pt-2">
      <div className="flex justify-between items-center"><strong>{text('我的家', 'My home', 'Mein Zuhause')}</strong><button className={button} aria-label={text('关闭', 'Close', 'Schließen')} onClick={() => setOpen(false)}>×</button></div>
      {loading && <p role="status">{text('正在加载…', 'Loading…', 'Wird geladen…')}</p>}
      {error && <p role="alert" className="my-2 text-sm">{error}<button className={button} onClick={() => void load()}>{text('重试', 'Retry', 'Erneut versuchen')}</button></p>}
      {!loading && !error && !rooms.length && <p className="my-3 text-sm">{text('还没有房间，添加并命名你的第一个房间。', 'Add and name your first room.', 'Ersten Raum hinzufügen und benennen.')}</p>}
      {!loading && !error && rooms.map(room => <button key={room.id} className={button + ' my-1 w-full text-left'} onClick={() => void choose(room)}><strong className="block break-words">{room.name}</strong><small>{room.data.room.w} × {room.data.room.d} × {room.data.room.h} cm</small></button>)}
      {demo && <p className="my-2 text-xs">{text('交互预览 · 房间保存在本机', 'UI preview · Rooms stored locally', 'UI-Vorschau · Räume lokal gespeichert')}</p>}
      <a href={prefix + (demo ? '/home-demo.html' : '/home.html')} className="block min-h-11 py-3 text-sm text-[#9A3412]">{text('管理我的家', 'Manage my home', 'Mein Zuhause verwalten')} ↗</a>
    </div>}
  </div>
}
