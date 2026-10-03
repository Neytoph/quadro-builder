import { useEffect, useState } from 'react'
import type { ComponentFragment } from '../store/customComponents'
import { useI18n } from '../i18n'
import { renderComponentThumbnail } from './componentThumbnail'

const loading = { zh: '正在生成组件预览…', en: 'Rendering component preview…', de: 'Bauteilvorschau wird erstellt…' }

export default function CustomComponentPreview({ fragment }: { fragment: ComponentFragment }) {
  const { t, lang } = useI18n()
  const key = JSON.stringify(fragment)
  const [result, setResult] = useState<{ key: string; url?: string; error?: string } | null>(null)
  useEffect(() => {
    let active = true
    renderComponentThumbnail(key).then(url => { if (active) setResult({ key, url }) }).catch(error => {
      console.error('Component thumbnail failed', error)
      if (active) setResult({ key, error: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [key])
  const current = result?.key === key ? result : null
  if (current?.url) return <img src={current.url} alt="" draggable={false} className="qb-component-preview" data-ui="component-real-thumbnail" />
  return <span className="qb-component-preview qb-component-preview-state" role="status" title={current?.error ? `${t('toast.pngFailed')}: ${current.error}` : loading[lang]} aria-label={current?.error ? t('toast.pngFailed') : loading[lang]} data-preview-error={!!current?.error}>{current?.error ? '⚠' : '…'}</span>
}
