import type { CSSProperties } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { canvasCorner, SCENE_CLUSTER_GAP, usePanelLayout } from './panelLayout'

const tileChrome = (on: boolean, h: number): CSSProperties => ({
  height: h,
  boxShadow: '0 2px 8px rgba(0,0,0,0.28)',
  outline: on ? '2px solid rgba(255,255,255,0.62)' : '2px solid rgba(0,0,0,0.14)',
  outlineOffset: 1,
})

const tileBtn = 'overflow-hidden rounded-[11px] p-0 border-0 cursor-pointer transition-[filter,opacity,box-shadow,transform] duration-200 hover:scale-[1.03] active:scale-95 flex items-center justify-center'

/** 草地、框住：左栏右侧、与左栏顶对齐。 */
export default function SceneToggle() {
  const api = useEngine()
  const { t } = useI18n()
  const { left, vw } = usePanelLayout()
  const pos = canvasCorner(left, vw)
  const { tile, clusterW } = pos

  return (
    <div
      className="fixed z-20 flex flex-row pointer-events-none"
      style={{ left: pos.sceneLeft, top: pos.sceneTop, width: clusterW, gap: SCENE_CLUSTER_GAP }}
    >
      <button
        type="button"
        onClick={api.toggleGrass}
        aria-pressed={api.grassOn}
        title={t('btn.grassTitle')}
        className={`pointer-events-auto ${tileBtn} flex-1 min-w-0 ${api.grassOn ? 'opacity-100' : 'opacity-45 grayscale'}`}
        style={tileChrome(api.grassOn, tile)}
      >
        <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width={tile} height={tile} aria-hidden="true">
          <rect x="0" y="0" width="48" height="48" fill="#B8D6E0" />
          <circle cx="38" cy="12" r="6" fill="#FFD942" />
          <ellipse cx="14" cy="13" rx="8" ry="5" fill="rgba(255,248,240,0.7)" />
          <path d="M0,32 Q12,27 24,32 Q36,36 48,31 L48,48 L0,48 Z" fill="#7BC86A" />
          <rect x="21.5" y="31" width="5" height="9" rx="2" fill="#B08968" />
          <ellipse cx="24" cy="27" rx="11" ry="9" fill="#6FC48A" />
          <ellipse cx="16" cy="30" rx="7" ry="6" fill="#7ECBB0" />
          <ellipse cx="32" cy="30" rx="7" ry="6" fill="#5AAA72" />
        </svg>
      </button>

      <button
        type="button"
        onClick={api.frame}
        title={t('btn.frameTitle')}
        className={`pointer-events-auto ${tileBtn} flex-1 min-w-0`}
        style={tileChrome(false, tile)}
      >
        <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width={tile} height={tile} aria-hidden="true">
          <rect x="0" y="0" width="48" height="48" fill="#EEF1F5" />
          <path d="M14 11 H11 V14 M34 11 H37 V14 M11 34 V37 H14 M37 34 V37 H34" fill="none" stroke="#3A8494" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="17" y="17" width="14" height="14" rx="2.5" fill="none" stroke="#3A8494" strokeWidth="1.8" />
          <rect x="20" y="24" width="3.2" height="4.2" rx="0.7" fill="#F23B3B" />
          <rect x="23.4" y="21" width="3.2" height="7.2" rx="0.7" fill="#2FCB5A" />
          <rect x="26.8" y="19" width="3.2" height="9.2" rx="0.7" fill="#2B8FF0" />
        </svg>
      </button>
    </div>
  )
}
