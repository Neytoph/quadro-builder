import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { readRooms, readRoom, onRoomAccountInvalidated, type RoomData, type Room } from '../home/rooms'
import { registerRoomThumbnails } from '../home/thumbnail.js'
import {usePresence} from './motion'

function GrassThumb({ blank = false }: { blank?: boolean }) {
  return <svg viewBox="0 0 48 48" className={'h-full w-full ' + (blank ? 'opacity-45 grayscale' : '')} aria-hidden="true">
    <rect width="48" height="48" fill="#B8D6E0" /><circle cx="38" cy="12" r="6" fill="#FFD942" />
    <ellipse cx="14" cy="13" rx="8" ry="5" fill="rgba(255,248,240,0.7)" />
    <path d="M0,32 Q12,27 24,32 Q36,36 48,31 L48,48 L0,48 Z" fill="#7BC86A" />
    <rect x="21.5" y="31" width="5" height="9" rx="2" fill="#B08968" />
    <ellipse cx="24" cy="27" rx="11" ry="9" fill="#6FC48A" /><ellipse cx="16" cy="30" rx="7" ry="6" fill="#7ECBB0" /><ellipse cx="32" cy="30" rx="7" ry="6" fill="#5AAA72" />
  </svg>
}

function RoomThumb({ data }: { data: RoomData }) {
  const host = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    registerRoomThumbnails()
    const preview = document.createElement('xmf-room-preview')
    preview.setAttribute('size', '160'); preview.setAttribute('data-room', JSON.stringify(data))
    host.current?.replaceChildren(preview)
    return () => preview.remove()
  }, [data])
  return <span ref={host} className="h-full w-full" aria-hidden="true" />
}

export default function HomeRoomPanel({ tile = 40 }: { tile?: number }) {
  const api = useEngine(), { lang } = useI18n()
  const text = useCallback((zh: string, en: string, de: string) => lang === 'zh' ? zh : lang === 'de' ? de : en, [lang])
  const demo = new URLSearchParams(location.search).has('homeDemo')
  const [open, setOpen] = useState(false), [rooms, setRooms] = useState<Room[]>([])
  const [shown,leaving]=usePresence(open?true:null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [choosing, setChoosing] = useState(false)
  const [position, setPosition] = useState({ left: 12, top: 120, maxHeight: 400 })
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const request = useRef(0), listRequest = useRef(0), panelID = useId()
  const context = api.homeContext
  const close = (focus = false) => {
    request.current++; setOpen(false); setChoosing(false)
    if (focus) trigger.current?.focus()
  }
  useEffect(() => {
    if (!open) return
    const measure = () => {
      const rect = trigger.current!.getBoundingClientRect(), width = tile + 12
      setPosition({ left: Math.max(12, Math.min(rect.left + (rect.width - width) / 2, innerWidth - width - 12)), top: rect.bottom + 8, maxHeight: Math.max(width, innerHeight - rect.bottom - 20) })
    }
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close() }
    measure()
    window.addEventListener('resize', measure); document.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('resize', measure); document.removeEventListener('pointerdown', outside) }
  }, [open, tile])
  useEffect(() => {
    if (open && !loading) panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }, [open, loading])
  const load = useCallback(async () => {
    const version = ++listRequest.current
    setLoading(true); setError('')
    try {
      let items: Room[]
      if (demo) items = JSON.parse(localStorage.getItem('xmf-home-demo-rooms') || '[]')
      else {
        items = await readRooms(text, cached => { if (version === listRequest.current) { setRooms(cached); setLoading(false) } })
      }
      if (version === listRequest.current) setRooms(items)
    } catch (e) { if (version === listRequest.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (version === listRequest.current) setLoading(false) }
  }, [demo, text])
  useEffect(() => {
    // 启动时准备场景选项；菜单开关不取消读取，也不重新发起请求。
    const invalidate = () => {
      request.current++; listRequest.current++
      setOpen(false); setChoosing(false); setRooms([]); setError(''); setLoading(false)
      if (!document.hidden) void load()
    }
    const visible = () => { if (!document.hidden) void load() }
    const unsubscribe = onRoomAccountInvalidated(invalidate)
    document.addEventListener('visibilitychange', visible)
    void load()
    return () => { request.current++; listRequest.current++; unsubscribe(); document.removeEventListener('visibilitychange', visible) }
  }, [load])
  const choose = async (room: Room) => {
    const version = ++request.current
    setChoosing(true); setError('')
    try {
      const latest = demo ? room : await readRoom(room, text)
      if (version !== request.current) return
      if (!api.bindHome(latest, api.activeTabId)) throw new Error(text('当前造型或操作已变化，请重新选择房间', 'The active model or action changed. Select the room again.', 'Aktives Modell oder Aktion geändert. Raum erneut auswählen.'))
      close(true)
    } catch (e) { if (version === request.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (version === request.current) setChoosing(false) }
  }
  const switchTo = (mode: 'grass' | 'blank' | 'home') => { api.setBackground(mode); close(true) }
  const iconButton = 'relative shrink-0 overflow-hidden rounded-lg p-0 cursor-pointer flex items-center justify-center bg-[#FFFDF9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:opacity-50 disabled:cursor-wait'
  const option = (active: boolean) => iconButton + ' h-[var(--scene-tile)] w-[var(--scene-tile)] border-2 ' + (active ? 'border-orange-600' : 'border-white hover:border-orange-200')
  return <div ref={root} className="relative pointer-events-auto" onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape' && open) { event.preventDefault(); close(true) }
    if (event.key === 'Tab' && open) close()
  }} onKeyUp={event => event.stopPropagation()}>
    <button ref={trigger} type="button" data-ui="scene-trigger" aria-label={text('场景', 'Scene', 'Szene')} aria-haspopup="menu" aria-expanded={open} aria-controls={panelID}
      title={text('切换场景', 'Change scene', 'Szene wechseln')} className={iconButton + ' shadow-[0_2px_8px_rgba(0,0,0,0.28)]'}
      style={{ width: tile, height: tile, border: '2px solid rgba(255,255,255,0.88)' }}
      onClick={() => { if (open) close(); else setOpen(true) }}>
      {api.background === 'home' && context ? <RoomThumb data={context.snapshot} /> : <GrassThumb blank={api.background === 'blank'} />}
    </button>
    {shown && createPortal(<div ref={panel} id={panelID} data-ui="scene-menu" role="menu" aria-label={text('场景', 'Scene', 'Szene')} aria-orientation="vertical" inert={leaving}
      className={`m-pop ${leaving?'m-leave pointer-events-none':'pointer-events-auto'} fixed z-[60] flex flex-col items-center gap-2 overflow-y-auto overscroll-contain rounded-[14px] border border-[#ECD6C2] bg-[#FFFDF9] p-[5px] shadow-lg`}
      style={{ ...position, width: tile + 12, '--scene-tile': `${tile}px` } as CSSProperties} onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        const buttons = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        let next = index + (event.key === 'ArrowDown' ? 1 : -1)
        if (event.key === 'Home') next = 0
        if (event.key === 'End') next = buttons.length - 1
        event.preventDefault(); buttons[(next + buttons.length) % buttons.length]?.focus()
      }}>
      <button type="button" role="menuitemradio" aria-checked={api.background === 'grass'} aria-label={text('草地', 'Grass', 'Wiese')} title={text('草地', 'Grass', 'Wiese')} className={option(api.background === 'grass')} disabled={choosing} onClick={() => switchTo('grass')}><GrassThumb /></button>
      <button type="button" role="menuitemradio" aria-checked={api.background === 'blank'} aria-label={text('空白', 'Blank', 'Leer')} title={text('空白', 'Blank', 'Leer')} className={option(api.background === 'blank')} disabled={choosing} onClick={() => switchTo('blank')}><GrassThumb blank /></button>
      {rooms.map(room => {
        const bound = room.id === context?.roomId, active = bound && api.background === 'home'
        return <button key={room.id} type="button" role="menuitemradio" data-room-id={room.id} aria-checked={active} aria-label={room.name} title={room.name} className={option(active)} disabled={choosing} onClick={() => bound ? switchTo('home') : void choose(room)}><RoomThumb data={bound ? context.snapshot : room.data} /></button>
      })}
      {context && !rooms.some(room => room.id === context.roomId) && <button type="button" role="menuitemradio" data-room-id={context.roomId} aria-checked={api.background === 'home'} aria-label={context.name} title={context.name} className={option(api.background === 'home')} disabled={choosing} onClick={() => switchTo('home')}><RoomThumb data={context.snapshot} /></button>}
      {loading && <span role="status" aria-label={text('正在加载房间', 'Loading rooms', 'Räume werden geladen')} className="flex h-[var(--scene-tile)] w-[var(--scene-tile)] shrink-0 items-center justify-center text-[#9A3412]"><LoaderCircle size={18} className="animate-spin" /></span>}
      {context?.roomId&&<button type="button" className={option(false)} aria-label={text('更新房间背景','Refresh room background','Raumhintergrund aktualisieren')} title={text('更新房间背景','Refresh room background','Raumhintergrund aktualisieren')} onClick={()=>{window.dispatchEvent(new Event('xmf-room-background-refresh'));close(true)}}><RefreshCw size={18}/></button>}
      {error && <><span role="alert" className="sr-only">{error}</span><button type="button" className={option(false)} aria-label={text('重新加载房间', 'Reload rooms', 'Räume erneut laden')} title={error} onClick={() => void load()}><RefreshCw size={18} /></button></>}
    </div>, document.body)}
  </div>
}
