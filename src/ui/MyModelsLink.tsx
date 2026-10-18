import { LayoutGrid } from 'lucide-react'
import { useI18n, type Lang } from '../i18n'
import { EDITOR_EMBED } from '../entry'
import { syncConfigured } from '../sync/bootstrap'

export function myModelsURL(lang: Lang): string {
  return `${lang === 'zh' ? '' : `/${lang}`}/workspace.html#designs`
}

export default function MyModelsLink({ toolbar = false }: { toolbar?: boolean }) {
  const { t, lang } = useI18n()
  if (!syncConfigured() || EDITOR_EMBED) return null
  return <a href={myModelsURL(lang)} target="_blank" rel="noopener" data-tour={toolbar ? 'my-models' : undefined}
    className={toolbar ? 'qb-nav-button qb-models-link' : 'qb-file-row qb-models-file-link'}
    title={`${t('models.entry')} · ${t('models.guideHint')}`} aria-label={t('models.entry')}>
    <LayoutGrid size={18} aria-hidden="true" /><span>{t('models.entry')}</span>
  </a>
}
