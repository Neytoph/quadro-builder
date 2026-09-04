import type { CSSProperties } from 'react'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { canvasCorner, SCENE_CLUSTER_GAP, usePanelLayout } from './panelLayout'

const TILE_EDGE = '2px solid rgba(255,255,255,0.88)'

const tileChrome = (_on: boolean, h: number): CSSProperties => ({
  height: h,
  width: h,
  boxSizing: 'border-box',
  boxShadow: '0 2px 8px rgba(0,0,0,0.28)',
  border: TILE_EDGE,
})

const tileBtn = 'overflow-hidden rounded-[11px] p-0 border-0 cursor-pointer transition-[filter,opacity,box-shadow,transform] duration-200 hover:scale-[1.03] active:scale-95 flex items-center justify-center'

/** 草地、框住、导出说明书：左栏右侧、与左栏顶对齐。 */
export default function SceneToggle() {
  const api = useEngine()
  const { t } = useI18n()
  const { left, vw, toolbarW } = usePanelLayout()
  const pos = canvasCorner(left, vw, { toolbarW })
  const { tile, clusterW } = pos
  const exporting = !!api.exportingManual

  return (
    <div
      data-tour="scene-buttons"
      className="fixed z-20 flex flex-row pointer-events-none"
      style={{ left: pos.sceneLeft, top: pos.sceneTop, width: clusterW, gap: SCENE_CLUSTER_GAP }}
    >
      <button
        type="button"
        onClick={api.toggleGrass}
        aria-pressed={api.grassOn}
        title={t('btn.grassTitle')}
        className={`pointer-events-auto ${tileBtn} ${api.grassOn ? 'opacity-100' : 'opacity-45 grayscale'}`}
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
        className={`pointer-events-auto ${tileBtn}`}
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

      <button
        type="button"
        onClick={() => void api.exportAssemblyPdf()}
        disabled={exporting}
        aria-busy={exporting}
        aria-label={t('btn.exportManual')}
        title={t('btn.exportManual')}
        className={`pointer-events-auto ${tileBtn} disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:scale-100`}
        style={tileChrome(false, tile)}
      >
        <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width={tile} height={tile} aria-hidden="true">
          <rect x="0" y="0" width="48" height="48" fill="#F3EADC" />
          <rect x="11" y="8" width="26" height="32" rx="3.2" fill="#fff" />
          <path d="M14.2 8 H33.8 A3.2 3.2 0 0 1 37 11.2 V16 H11 V11.2 A3.2 3.2 0 0 1 14.2 8 Z" fill="#EA580C" />
          <rect x="11" y="8" width="26" height="32" rx="3.2" fill="none" stroke="#3A8494" strokeWidth="1.7" />
          <rect x="15" y="19" width="8.2" height="7.2" rx="1.2" fill="#D7E8EE" />
          <rect x="24.8" y="19" width="8.2" height="7.2" rx="1.2" fill="#D7E8EE" />
          <circle cx="17.2" cy="33.2" r="3.1" fill="#fff" stroke="#5C6570" strokeWidth="1.05" />
          <path d="M22.4 31.7 h10.4 M22.4 35.3 h7.4" stroke="#C4B8A8" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
