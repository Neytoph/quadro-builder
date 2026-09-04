import { useEffect } from 'react'
import { LanguageProvider, useI18n } from './i18n'
import { EngineProvider, useEngine } from './store/EngineContext'
import CanvasHost from './ui/CanvasHost'
import TopToolbar from './ui/TopToolbar'
import LeftStack from './ui/LeftStack'
import RightDock from './ui/RightDock'
import ProjectTabs from './ui/ProjectTabs'
import AssemblyBar from './ui/AssemblyBar'
import Onboarding from './ui/Onboarding'
import ThumbCapture from './ui/ThumbCapture'
import ErrorBoundary from './ui/ErrorBoundary'
import SceneToggle from './ui/SceneToggle'
// 调色台代码保留在 src/ui/ColorTune.tsx，面板先不挂上。
import { PanelLayoutProvider } from './ui/panelLayout'
import { UI_ESCAPE_EVENT } from './ui/events'
import { DockProvider, useDock } from './ui/dock'

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

function ManualConfirm() {
  const { exportManualConfirm, cancelExportManual, confirmExportManual } = useEngine()
  const { t } = useI18n()

  useEffect(() => {
    if (!exportManualConfirm) return
    const onEsc = () => cancelExportManual()
    window.addEventListener(UI_ESCAPE_EVENT, onEsc)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, onEsc)
  }, [exportManualConfirm, cancelExportManual])

  if (!exportManualConfirm) return null
  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4"
      onClick={cancelExportManual}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-confirm-title"
        className="w-full max-w-sm bg-gray-900 text-gray-100 rounded-2xl border border-gray-700 shadow-2xl p-5"
        onClick={e => e.stopPropagation()}
      >
        <div id="manual-confirm-title" className="text-base font-semibold">{t('confirm.exportManualTitle')}</div>
        <p className="text-sm text-gray-300 leading-relaxed mt-2 mb-5">{t('confirm.exportManual')}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancelExportManual}
            className="px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-gray-800 cursor-pointer"
          >
            {t('confirm.cancel')}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => void confirmExportManual()}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-teal-500 hover:bg-teal-400 text-white cursor-pointer"
          >
            {t('confirm.okExport')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ManualProgress() {
  const { exportingManual } = useEngine()
  const { t } = useI18n()
  if (!exportingManual) return null
  return (
    <div className="fixed inset-0 z-[80] bg-black/45 flex items-center justify-center">
      <div className="bg-gray-900 border border-gray-700 rounded-xl px-6 py-4 text-gray-100 text-sm shadow-xl tabular-nums">
        {t('manual.progress', { k: exportingManual.page, n: exportingManual.total })}
      </div>
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
        if (api.exportManualConfirm) {
          api.cancelExportManual()
          return
        }
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
        if (api.mode === 'assembly' || api.mode === 'delete') return
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
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        api.setMode(api.mode === 'delete' ? 'select' : 'delete')
        return
      }
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
      <SceneToggle />
      <ProjectTabs />
      <TopToolbar />
      <LeftStack />
      <RightDock />
      <AssemblyBar />
      <Toast />
      <ManualConfirm />
      <ManualProgress />
      <Onboarding />
      <ThumbCapture />
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
