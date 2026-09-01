import { useEffect } from 'react'
import { LanguageProvider, useI18n } from './i18n'
import { EngineProvider, useEngine } from './store/EngineContext'
import CanvasHost from './ui/CanvasHost'
import TopToolbar from './ui/TopToolbar'
import SideToolbar from './ui/SideToolbar'
import RightDock from './ui/RightDock'
import ProjectTabs from './ui/ProjectTabs'
import AssemblyBar from './ui/AssemblyBar'
import Onboarding from './ui/Onboarding'
import ErrorBoundary from './ui/ErrorBoundary'
import { canvasInset, PANEL_GAP, PanelLayoutProvider, TOP_MIN, usePanelLayout } from './ui/panelLayout'
import { UI_ESCAPE_EVENT } from './ui/events'
import { DockProvider, DOCK_PILLS, useDock } from './ui/dock'

function Toast() {
  const { toast, dismissToast } = useEngine()
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(dismissToast, 2800)
    return () => window.clearTimeout(id)
  }, [toast, dismissToast])
  if (!toast) return null
  const tone = toast.kind === 'err' ? 'bg-red-800' : toast.kind === 'warn' ? 'bg-amber-800' : 'bg-teal-800'
  return (
    <div className={`fixed top-[9.5rem] left-1/2 -translate-x-1/2 ${tone} text-white text-sm px-4 py-2 rounded-lg shadow-lg z-40`}>
      {toast.message}
    </div>
  )
}

const pill = 'text-xs rounded-full border px-3 py-1.5 shadow-lg cursor-pointer backdrop-blur whitespace-nowrap text-center'

function AppActions() {
  const { t } = useI18n()
  const { pane, toggle } = useDock()
  const { left, vw } = usePanelLayout()
  const leftPos = left.top > TOP_MIN + 40 ? PANEL_GAP : canvasInset(left)
  const toolbarLeft = vw / 2 - 340
  const beside = leftPos + 108 < toolbarLeft
  return (
    <div
      className="fixed z-40 flex flex-col items-stretch gap-1.5"
      style={{ left: leftPos, top: beside ? TOP_MIN : TOP_MIN + 64 }}
    >
      {DOCK_PILLS.map(item => {
        const on = pane === item.id
        return (
          <button key={item.id} onClick={() => toggle(item.id)}
            className={on
              ? `${pill} bg-teal-500 hover:bg-teal-400 border-teal-400 text-gray-950 font-semibold`
              : `${pill} bg-gray-800/90 hover:bg-gray-700 border-gray-700 text-gray-100`}>
            {t(item.labelKey)}
          </button>
        )
      })}
    </div>
  )
}

function CameraHint() {
  const { t } = useI18n()
  const { left, vh } = usePanelLayout()
  const coversBottom = left.top + left.height > vh - 96
  return (
    <div
      data-ui="camera-hint"
      className="fixed z-20 pointer-events-none text-[11px] text-gray-100 select-none leading-relaxed whitespace-pre-line bg-gray-950/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/15 shadow-lg"
      style={{ left: coversBottom ? canvasInset(left) : PANEL_GAP, bottom: 16, maxWidth: '14rem' }}
    >
      {t('hint.camera')}
    </div>
  )
}

function AppInner() {
  const api = useEngine()
  const { handleEsc } = useDock()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        const focused = document.activeElement as HTMLElement | null
        if (focused && focused !== document.body && typeof focused.blur === 'function') focused.blur()
        window.dispatchEvent(new Event(UI_ESCAPE_EVENT))
        if (api.pasting) {
          api.cancelPaste()
          api.setMode('select')
          return
        }
        api.setMode('select')
        handleEsc()
        return
      }
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (el?.closest?.('[data-panel-chrome]')) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? api.redo() : api.undo(); return }
      if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); api.redo(); return }
      if (meta && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); api.copy(); return }
      if (meta && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); api.paste(); return }
      if (meta && (e.key === 's' || e.key === 'S')) { e.preventDefault(); void api.saveCurrent(); return }
      if (meta && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); api.selectAll(); return }
      if (meta) return
      if ((e.key === 'l' || e.key === 'L') && !api.pasting) { e.preventDefault(); api.selectConnected(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { api.deleteSel(); return }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); api.frame(); return }
      if (e.key === '[' || e.key === ']') {
        if (api.assembly.active) {
          e.preventDefault()
          api.stepAssembly(e.key === ']' ? 1 : -1)
        }
        return
      }
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        if (api.pasting) {
          e.preventDefault()
          api.nudgePasteY(e.key === 'PageUp' ? 1 : -1)
        }
        return
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (api.mode === 'assembly') return
        e.preventDefault()
        if (api.pasting) {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') api.nudgePasteY(e.key === 'ArrowUp' ? 1 : -1)
          return
        }
        const { axes, frontal } = api.cameraAxes()
        const neg = (v: number[]) => v.map(n => -n)
        const dir = e.key === 'ArrowUp' ? (frontal ? [0, 1, 0] : axes.forward)
          : e.key === 'ArrowDown' ? (frontal ? [0, -1, 0] : neg(axes.forward))
          : e.key === 'ArrowRight' ? axes.right
          : neg(axes.right)
        if (api.mode === 'select' && api.selectionCount) api.moveSelection(dir)
        else { if (api.mode !== 'add') api.setMode('add'); api.buildStep(dir) }
        return
      }
      if (e.key === 'q' || e.key === 'Q') {
        if (api.selectionCount || api.pasting) { e.preventDefault(); api.rotate(-1) }
        return
      }
      if (e.key === 'e' || e.key === 'E') {
        if (api.selectionCount || api.pasting) { e.preventDefault(); api.rotate(1) }
        return
      }
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        api.setAssembly(!api.assembly.active)
        return
      }
      const TUBE_BY_KEY: Record<string, string> = { '1': 'T15', '2': 'T25', '3': 'T35', '4': 'T10', '5': 'T20', '6': 'T75' }
      if (TUBE_BY_KEY[e.key]) { api.setTube(TUBE_BY_KEY[e.key]); return }
      if (e.key === 'b' || e.key === 'B') api.setMode('add')
      else if (e.key === 'p' || e.key === 'P') api.setMode('panel')
      else if (e.key === 's' || e.key === 'S') api.setMode('select')
      else if (e.key === 'r' || e.key === 'R') api.setMode('slide')
      else if (e.key === 'v' || e.key === 'V') api.startReinforce()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [api, handleEsc])

  return (
    <div className="app-viewport w-screen flex bg-gray-950 overflow-hidden">
      <CanvasHost />
      <ProjectTabs />
      <TopToolbar />
      <SideToolbar />
      <RightDock />
      <AssemblyBar />
      <Toast />
      <CameraHint />
      <AppActions />
      <Onboarding />
    </div>
  )
}

export default function App() {
  return (
    <LanguageProvider>
      <ErrorBoundary>
        <EngineShell />
      </ErrorBoundary>
    </LanguageProvider>
  )
}

function EngineShell() {
  return (
    <EngineProvider>
      <PanelLayoutProvider>
        <DockProvider>
          <AppInner />
        </DockProvider>
      </PanelLayoutProvider>
    </EngineProvider>
  )
}
