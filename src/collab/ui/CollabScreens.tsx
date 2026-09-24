import { useI18n } from '../../i18n'
import { useCollab } from '../CollabContext'

/** 共享方案打开前后的几种整屏状态：连接中、要先登录、出错；以及只读时顶上的一句提示。 */
export default function CollabScreens() {
  const collab = useCollab()
  const { t } = useI18n()
  if (collab.mode === 'off') return null

  if (collab.status === 'needLogin') {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" data-ui="need-login">
        <div className="qb-card w-full max-w-sm p-5 text-gray-100">
          <div className="text-base font-semibold">{t('collab.join.title')}</div>
          <p className="text-sm text-gray-300 mt-2 mb-5">{t('collab.join.body')}</p>
          <div className="flex justify-end">
            <a href={collab.loginUrl()} className="qb-btn qb-btn-sm no-underline" data-ui="login-join">{t('collab.join.go')}</a>
          </div>
        </div>
      </div>
    )
  }
  if (collab.status === 'error') {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" data-ui="collab-error">
        <div className="qb-card w-full max-w-sm p-5 text-gray-100">
          <div className="text-base font-semibold">{t('collab.error.title')}</div>
          <p className="text-sm text-gray-300 mt-2 mb-5 break-words">{collab.error}</p>
          <div className="flex justify-end gap-2">
            <a href="/" className="qb-btn qb-btn-ghost qb-btn-sm no-underline">{t('nav.home')}</a>
            <button onClick={() => location.reload()} className="qb-btn qb-btn-sm">{t('collab.error.retry')}</button>
          </div>
        </div>
      </div>
    )
  }
  const s = collab.session
  if (collab.mode === 'plan' && (collab.status === 'loading' || (s && s.empty && !s.synced))) {
    return (
      <div className="qb-card fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-[55] px-4 py-2 text-sm text-gray-100" data-ui="collab-loading">
        {t(collab.status === 'loading' ? 'collab.loading' : 'collab.connecting')}
      </div>
    )
  }
  if (collab.mode === 'plan' && s && !collab.canEdit) {
    return (
      <div className="qb-card fixed top-[3.6rem] left-1/2 -translate-x-1/2 z-[34] px-3 py-1.5 text-xs text-gray-200 flex items-center gap-2 max-w-[calc(100vw-2rem)]" data-ui="read-only-banner">
        <span>{t(collab.role === 'guest' ? 'collab.readOnly.guest' : 'collab.readOnly.commenter')}</span>
        {collab.role === 'guest' && (
          <a href={collab.loginUrl()} className="text-teal-600 hover:text-teal-500 no-underline">{t('collab.readOnly.login')}</a>
        )}
      </div>
    )
  }
  return null
}
