import { useEffect, useState } from 'react'
import type { Lang } from '../../i18n'
import { onSyncStart, syncStarted } from '../../sync/bootstrap'
import { mediaUrl } from '../api'

/** 后端认得出这个人（同步跑起来了）。在另一个标签页登录后切回来也会变成 true。 */
export function useSignedIn() {
  const [on, setOn] = useState(syncStarted)
  useEffect(() => (on ? undefined : onSyncStart(() => setOn(true))), [on])
  return on
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type E = any

/** 成员头像：成员色描边；在线右下绿点，离线变灰。 */
export function Face({ name, avatar, color, state, size }: {
  name: string
  avatar?: string
  color: string
  state?: 'on' | 'off'
  size?: 'sm' | 'lg'
}) {
  return (
    <span className={`cb-face ${state || ''} ${size || ''}`} style={{ '--c': color } as React.CSSProperties} title={name}>
      {avatar ? <img src={mediaUrl(avatar)} alt="" /> : (name || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

export function when(ms: number, lang: Lang) {
  const locale = lang === 'zh' ? 'zh-CN' : lang === 'de' ? 'de-DE' : 'en-US'
  return new Date(ms).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function day(ms: number, lang: Lang) {
  const locale = lang === 'zh' ? 'zh-CN' : lang === 'de' ? 'de-DE' : 'en-US'
  return new Date(ms).toLocaleDateString(locale, { month: 'long', day: 'numeric' })
}

export function errText(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

/** 零件属于哪一类（Builder._partLabel 要的那个 kind）。 */
export function partKind(model: E, id: string): string | null {
  if (model.nodes.has(id)) return 'node'
  if (model.tubes.has(id)) return 'tube'
  if (model.panels.has(id)) return 'panel'
  if (model.textiles.has(id)) return 'textile'
  if (model.fittings.has(id)) return 'fitting'
  if (model.slides.has(id)) return 'slide'
  if (model.clamps.has(id)) return 'clamp'
  return null
}

/** 零件的名字，用 Builder 自己给选中零件起名的那一套；model 可以是另一版的造型。 */
export function partLabel(builder: E, model: E, id: string): string | null {
  const kind = partKind(model, id)
  if (!kind) return null
  return builder._partLabel.call({ model }, id, kind) as string | null
}
