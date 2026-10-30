import type { CSSProperties } from 'react'
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye'
import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { canvasCorner, SCENE_CLUSTER_GAP, usePanelLayout } from './panelLayout'
import HomeRoomPanel from './HomeRoomPanel'

const TILE_EDGE = '2px solid rgba(255,255,255,0.88)'

const tileChrome = (_on: boolean, h: number): CSSProperties => ({
  height: h,
  width: h,
  boxSizing: 'border-box',
  boxShadow: '0 2px 8px rgba(0,0,0,0.28)',
  border: TILE_EDGE,
})

const tileBtn = 'm-tile overflow-hidden rounded-lg p-0 border-0 cursor-pointer transition-[filter,opacity,box-shadow,transform] duration-200 hover:scale-[1.03] active:scale-95 flex items-center justify-center'

/** 场景工具位于左侧属性栏旁，框架按钮跟在导出后面。 */
export default function SceneToggle() {
  const api = useEngine()
  const { t, lang } = useI18n()
  const { left, vw, toolbarW } = usePanelLayout()
  const pos = canvasCorner(left, vw, { toolbarW })
  const { tile, clusterW } = pos
  const exporting = !!api.exportingManual
  const indoor = api.background === 'home' && !!api.homeContext
  const { obstacles, usable } = api.homeZones
  const states = [
    { obstacles: true, usable: true, label: ['全部显示', 'Show all', 'Alles anzeigen'] },
    { obstacles: true, usable: false, label: ['仅显示橙色区域', 'Show orange zones only', 'Nur orange Bereiche anzeigen'] },
    { obstacles: false, usable: true, label: ['仅显示绿色区域', 'Show green zone only', 'Nur grünen Bereich anzeigen'] },
    { obstacles: false, usable: false, label: ['全部隐藏', 'Hide all', 'Alles ausblenden'] },
  ]
  const index = states.findIndex(state => state.obstacles === obstacles && state.usable === usable)
  const next = states[(index + 1) % states.length]
  const language = { zh: 0, en: 1, de: 2 }[lang]
  const zoneTitle = {
    zh: `区域显示：${states[index].label[language]}；点击${next.label[language]}`,
    de: `Bereiche: ${states[index].label[language]}. Klicken: ${next.label[language]}`,
    en: `Zones: ${states[index].label[language]}. Click: ${next.label[language]}`,
  }[lang]

  return (
    <div className="fixed z-20 pointer-events-none" style={{ left: pos.sceneLeft, top: pos.sceneTop }}><div
      data-tour="scene-buttons"
      data-ui="scene-buttons"
      className="flex flex-row flex-wrap pointer-events-none"
      style={{ width: clusterW, gap: SCENE_CLUSTER_GAP }}
    >
      <HomeRoomPanel tile={tile} />

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
      <button
        type="button"
        data-ui="frame-only-toggle"
        data-panel-chrome
        data-button-motion="off"
        aria-label={t('btn.frameOnly')}
        aria-pressed={api.frameOnly}
        title={t('btn.frameOnly')}
        onClick={api.toggleFrameOnly}
        className={`pointer-events-auto ${tileBtn} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600`}
        style={tileChrome(api.frameOnly, tile)}
      >
        <svg viewBox="0 0 48 48" width={tile} height={tile} aria-hidden="true">
          <rect width="48" height="48" fill={api.frameOnly ? '#FFF0DF' : '#EEF1F5'} />
          <g fill="none" stroke={api.frameOnly ? '#EA580C' : '#3A8494'} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round">
            <path d="M13 17 25 10 37 17 25 24Z M13 17V32L25 39 37 32V17 M25 24V39" />
            <path d="M25 10V25 M13 32 25 25 37 32" strokeDasharray="2 3" opacity=".5" />
          </g>
          <g fill={api.frameOnly ? '#EA580C' : '#3A8494'}>
            {[[13,17],[25,10],[37,17],[25,24],[13,32],[25,39],[37,32]].map(([cx,cy]) => <rect key={`${cx}-${cy}`} x={cx-1.8} y={cy-1.8} width="3.6" height="3.6" rx=".7" />)}
          </g>
        </svg>
      </button>
      {indoor && <button
        type="button"
        data-ui="home-zone-toggle"
        data-panel-chrome
        data-zone-state={['all', 'orange', 'green', 'none'][index]}
        aria-label={zoneTitle}
        title={zoneTitle}
        onClick={() => { api.setHomeZones('obstacles', next.obstacles); api.setHomeZones('usable', next.usable) }}
        className={`pointer-events-auto ${tileBtn} bg-[#FFFDF9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600`}
        style={tileChrome(false, tile)}
      >
        <span className="relative block h-[26px] w-[26px]" aria-hidden="true">
          <EyeIcon size={26} weight="regular" className="absolute inset-0" style={{ color: obstacles ? '#EB923E' : '#E7D5C2', clipPath: 'polygon(0 0,100% 0,0 100%)' }} />
          <EyeIcon size={26} weight="regular" className="absolute inset-0" style={{ color: usable ? '#68A179' : '#D1DFD3', clipPath: 'polygon(100% 0,100% 100%,0 100%)' }} />
          {!(obstacles && usable) && <span data-ui="home-zone-slash" className="absolute left-[12px] top-[-2px] h-[30px] w-[1.6px] rotate-45 rounded bg-[#A0A39B] shadow-[0_0_0_1.4px_#FFFDF9]" />}
        </span>
      </button>}
    </div></div>
  )
}
