import { useEffect, useRef, useState } from 'react'
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
import { usePresence } from './ui/motion'
import { bootEntry, DELIVERY_EMBED, dropParam, fullBuilderUrl, VIEW_ONLY } from './entry'
import { syncNow, syncProbe } from './sync/bootstrap'
import { pullDoc } from './sync/docEntry'
import { collabApi } from './collab/api'
import { CollabProvider, useCollab } from './collab/CollabContext'
import './collab/collab.css'
import { JoinModal } from './collab/ui/Modals'
import PlanOverlays from './collab/ui/PlanOverlays'
import CollabCoach from './collab/ui/CollabCoach'
import CompareView from './collab/ui/CompareView'
import BatchImport from './collab/ui/BatchImport'
import RoomEditor from './collab/ui/RoomEditor'

function Toast() {
  const { toast: live, dismissToast } = useEngine()
  const [toast, leaving] = usePresence(live)
  useEffect(() => {
    if (!live) return
    // 警告和出错往往是一整句要读完的话，多留一会儿
    const id = window.setTimeout(dismissToast, live.kind === 'ok' ? 2800 : 6000)
    return () => window.clearTimeout(id)
  }, [live, dismissToast])
  if (!toast) return null
  const tone = toast.kind === 'err' ? 'text-red-700' : toast.kind === 'warn' ? 'text-amber-700' : 'text-gray-100'
  return (
    // key 跟着消息走：连着两条提示时，第二条重新演一遍入场。
    // 压在顶栏、右侧面板和下拉菜单上面：手机上右侧面板盖满画布，
    // 在「文件」里点保存，提示要浮在面板上才看得见。确认框（z-75）仍在它上面。
    <div key={toast.message} className={`m-toast qb-card fixed top-[9.5rem] left-1/2 -translate-x-1/2 w-max max-w-[calc(100vw-2rem)] text-center ${tone} text-sm font-medium px-4 py-2 z-[70] pointer-events-none ${leaving ? 'm-leave' : ''}`}>
      {toast.message}
    </div>
  )
}

function ManualConfirm() {
  const { exportManualConfirm, cancelExportManual, confirmExportManual } = useEngine()
  const { t } = useI18n()
  const [shown, leaving] = usePresence(exportManualConfirm ? true : null)

  useEffect(() => {
    if (!exportManualConfirm) return
    const onEsc = () => cancelExportManual()
    window.addEventListener(UI_ESCAPE_EVENT, onEsc)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, onEsc)
  }, [exportManualConfirm, cancelExportManual])

  if (!shown) return null
  return (
    <div
      className={`m-backdrop fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4 ${leaving ? 'm-leave pointer-events-none' : ''}`}
      onClick={cancelExportManual}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-confirm-title"
        className="m-modal qb-card w-full max-w-sm text-gray-100 p-5"
        onClick={e => e.stopPropagation()}
      >
        <div id="manual-confirm-title" className="text-base font-semibold">{t('confirm.exportManualTitle')}</div>
        <p className="text-sm text-gray-300 leading-relaxed mt-2 mb-5">{t('confirm.exportManual')}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={cancelExportManual} className="qb-btn qb-btn-ghost qb-btn-sm">{t('confirm.cancel')}</button>
          <button type="button" autoFocus onClick={() => void confirmExportManual()} className="qb-btn qb-btn-sm">{t('confirm.okExport')}</button>
        </div>
      </div>
    </div>
  )
}

function NameDialog() {
  const { nameAsk, answerName } = useEngine()
  const { t } = useI18n()
  const [shown, leaving] = usePresence(nameAsk)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const selectPending = useRef(false)

  useEffect(() => {
    if (!nameAsk) return
    if (inputRef.current?.value === nameAsk.value) {
      inputRef.current.select()
      return
    }
    setValue(nameAsk.value)
    selectPending.current = true
  }, [nameAsk])

  // 预填的名字进了输入框以后整段选中，直接打字就替换掉
  useEffect(() => {
    if (!selectPending.current || !inputRef.current) return
    selectPending.current = false
    inputRef.current.select()
  }, [value])

  if (!shown) return null
  return (
    <div
      className={`m-backdrop fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4 ${leaving ? 'm-leave pointer-events-none' : ''}`}
      onClick={() => answerName(null)}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-dialog-title"
        className="m-modal qb-card w-full max-w-sm text-gray-100 p-5"
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); answerName(value) }}
      >
        <div id="name-dialog-title" className="text-base font-semibold">{shown.title}</div>
        <label className="block mt-3 mb-5">
          <span className="text-xs text-gray-400">{t('saves.namePrompt')}</span>
          <input
            ref={inputRef}
            autoFocus
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={t('tab.untitled')}
            className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-teal-500"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => answerName(null)} className="qb-btn qb-btn-ghost qb-btn-sm">{t('confirm.cancel')}</button>
          <button type="submit" className="qb-btn qb-btn-sm">{shown.ok}</button>
        </div>
      </form>
    </div>
  )
}

/** 导出文件要先注册：没登录时问要不要去注册；注册完回来问要不要接着导出。 */
function AccountDialog() {
  const { accountAsk, answerAccount } = useEngine()
  const { t } = useI18n()
  const [shown, leaving] = usePresence(accountAsk)

  useEffect(() => {
    if (!accountAsk) return
    const onEsc = () => answerAccount(false)
    window.addEventListener(UI_ESCAPE_EVENT, onEsc)
    return () => window.removeEventListener(UI_ESCAPE_EVENT, onEsc)
  }, [accountAsk, answerAccount])

  if (!shown) return null
  const resume = shown.phase === 'resume'
  return (
    <div
      className={`m-backdrop fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-4 ${leaving ? 'm-leave pointer-events-none' : ''}`}
      onClick={() => answerAccount(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-dialog-title"
        className="m-modal qb-card w-full max-w-sm text-gray-100 p-5"
        onClick={e => e.stopPropagation()}
      >
        <div id="account-dialog-title" className="text-base font-semibold">{t(resume ? 'account.resumeTitle' : 'account.title')}</div>
        <p className="text-sm text-gray-300 leading-relaxed mt-2 mb-5">
          {resume ? t('account.resumeBody', { what: t(`account.what.${shown.kind}`) }) : t('account.body')}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => answerAccount(false)} className="qb-btn qb-btn-ghost qb-btn-sm">{t('confirm.cancel')}</button>
          <button type="button" autoFocus onClick={() => answerAccount(true)} className="qb-btn qb-btn-sm">{t(resume ? 'account.resumeGo' : 'account.go')}</button>
        </div>
      </div>
    </div>
  )
}

/** 只看模式底下那一条：看成品和一步一步看手册来回切。 */
function ViewBar() {
  const api = useEngine()
  const { t } = useI18n()
  const totals = api.bom?.totals
  const hasParts = !!totals && (totals.tubes + totals.connectors + totals.panels + totals.other) > 0
  if (!hasParts) return null
  const n = api.assembly.max + 1
  const step = 'h-8 px-3 rounded-full text-[13px] text-gray-100 hover:bg-teal-100 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default whitespace-nowrap'
  if (!api.assembly.active) {
    return (
      <div data-tour="assembly" className="m-asm qb-card fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 p-1.5 max-w-[calc(100vw-1rem)]">
        <button onClick={() => api.setAssembly(true)} className="qb-btn qb-btn-sm">{t('view.manual', { n })}</button>
      </div>
    )
  }
  return (
    <div data-tour="assembly" className="m-asm qb-card fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 p-1.5 max-w-[calc(100vw-1rem)] overflow-x-auto scrollbar-none">
      {/* 嵌在手机上的方案页里只有三百来像素宽：上一步、下一步只留箭头，字在宽屏上才露出来 */}
      <button disabled={api.assembly.step <= 0} onClick={() => api.stepAssembly(-1)} className={step} aria-label={t('assembly.prev')}>‹<span className="hidden sm:inline"> {t('assembly.prev')}</span></button>
      <div className="px-1 text-[13.5px] font-bold qb-num whitespace-nowrap">{t('assembly.step', { k: api.assembly.step + 1, n })}</div>
      <button disabled={api.assembly.step >= api.assembly.max} onClick={() => api.stepAssembly(1)} className={step} aria-label={t('assembly.next')}><span className="hidden sm:inline">{t('assembly.next')} </span>›</button>
      <button onClick={() => api.setAssembly(false)} className={step}>{t('view.whole')}</button>
    </div>
  )
}

/** 只看模式：嵌在方案页、造型页里，只有 3D 画面和分步手册，左上角是「在 Builder 里打开」。 */
function ViewShell() {
  const { t } = useI18n()
  const collab = useCollab()
  const { ready, setViewCubeEnabled } = useEngine()
  // 交付查看没有「在 Builder 里打开」；嵌在交付页里时连分步手册和视角方块也不画
  const delivery = collab.mode === 'delivery'
  useEffect(() => {
    if (ready && DELIVERY_EMBED) setViewCubeEnabled(false)
  }, [ready, setViewCubeEnabled])
  return (
    <div className="app-viewport w-screen flex bg-gray-950 overflow-hidden" data-ui={DELIVERY_EMBED ? 'delivery-embed' : undefined}>
      <CanvasHost />
      {!delivery && <a href={fullBuilderUrl()} target="_top" className="qb-btn qb-btn-sm fixed top-3 left-3 z-40 no-underline">{t('view.open')} ↗</a>}
      {!DELIVERY_EMBED && <ViewBar />}
      <Toast />
    </div>
  )
}

/** 画房间边界：一张俯视的平面图和左边的面板（三维画面在底下，不用）。 */
function RoomShell() {
  const collab = useCollab()
  return (
    <div className="app-viewport w-screen flex bg-gray-950 overflow-hidden">
      <CanvasHost />
      {collab.room && <RoomEditor />}
      <Toast />
    </div>
  )
}

/** ?import=qdf：打开就是批量导入 */
function ImportOnEntry() {
  const [open, setOpen] = useState(() => bootEntry().importQdf)
  const { ready } = useEngine()
  if (!open || !ready) return null
  return <BatchImport onClose={() => setOpen(false)} />
}

/**
 * ?doc=<doc id>：打开自己「我的设计」里的这一座。没登录先去登录；登录了等同步跑完一轮，
 * 开启过共享的这一座打开方案标签页，其余的打开它的标签页；本机没有就从 /models 拉下来，
 * 服务端也没有（不是自己的、删掉了）就说找不到。
 */
function DocOnEntry() {
  const api = useEngine()
  const collab = useCollab()
  const { t } = useI18n()
  const done = useRef(false)
  const { ready, openDoc, notify } = api
  const { openPlan, loginUrl, report } = collab

  useEffect(() => {
    const id = bootEntry().doc
    if (!id || !ready || done.current) return
    done.current = true
    void (async () => {
      const signedIn = await syncProbe()
      if (signedIn === false) { location.href = loginUrl(); return }
      if (signedIn !== true) throw new Error('?doc=: sync server did not answer')
      await syncNow()
      dropParam('doc')
      if ((await collabApi.mine()).some(p => p.id === id)) { await openPlan(id); return }
      if (!await pullDoc(import.meta.env.VITE_SYNC_BASE as string, id)) { notify(t('doc.notFound'), 'err'); return }
      await openDoc(id)
    })().catch(report)
  }, [ready, openDoc, notify, openPlan, loginUrl, report, t])

  return null
}

/**
 * ?new=1：这台设备上记着的标签页恢复出来以后，在它们后面新开一个空白标签页。
 * 开完从地址栏去掉，刷新不会再开一个。
 */
function NewOnEntry() {
  const { ready, newTab } = useEngine()
  const done = useRef(false)
  useEffect(() => {
    if (!bootEntry().blank || !ready || done.current) return
    done.current = true
    newTab()
    dropParam('new')
  }, [ready, newTab])
  return null
}

function ManualProgress() {
  const { exportingManual } = useEngine()
  const { t } = useI18n()
  if (!exportingManual) return null
  return (
    <div className="m-backdrop fixed inset-0 z-[80] bg-black/45 flex items-center justify-center">
      <div className="m-modal qb-card px-6 py-4 text-gray-100 text-sm tabular-nums">
        {t('manual.progress', { k: exportingManual.page, n: exportingManual.total })}
      </div>
    </div>
  )
}

function AppInner() {
  const api = useEngine()
  const collab = useCollab()
  const { handleEsc } = useDock()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (api.nameAsk) {
          api.answerName(null)
          return
        }
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
      // 起名框开着时，画布上的快捷键一律不响应
      if (api.nameAsk) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (el?.closest?.('[data-panel-chrome]')) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? api.redo() : api.undo(); return }
      if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); api.redo(); return }
      if (meta && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); api.copy(); return }
      if (meta && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); api.paste(); return }
      if (meta && (e.key === 's' || e.key === 'S')) { e.preventDefault(); void (e.shiftKey ? api.saveCurrentAs() : api.saveCurrent()); return }
      if (meta && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); api.selectAll(); return }
      if (meta && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); e.shiftKey ? api.ungroup() : api.group(); return }
      if (meta) return
      // 共享方案的成员：C 放一颗评论图钉
      if ((e.key === 'c' || e.key === 'C') && collab.mode === 'plan' && collab.role !== 'guest') {
        e.preventDefault()
        api.setMode('select')
        collab.setPinDraft(null)
        collab.setPlacingPin(!collab.placingPin)
        return
      }
      if ((e.key === 'm' || e.key === 'M') && (api.selectionCount || api.pasting)) {
        e.preventDefault()
        api.mirror(e.shiftKey ? 'fb' : 'lr')
        return
      }
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
        else { if (api.mode !== 'add' && !api.readOnly) api.setMode('add'); api.buildStep(dir) }
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
  }, [api, collab, handleEsc])

  // 共享方案里只能看的人没有颜色栏；访客连工具条也没有，评论者的工具条只剩「选择」「评论」
  const viewer = collab.mode === 'plan' && !collab.canEdit
  const visitor = viewer && collab.role === 'guest'
  return (
    <div className="app-viewport w-screen flex bg-gray-950 overflow-hidden">
      <CanvasHost />
      <SceneToggle />
      <ProjectTabs />
      {!visitor && !collab.compare && <TopToolbar />}
      {!viewer && !collab.compare && <LeftStack />}
      <RightDock />
      {!collab.compare && <AssemblyBar />}
      {collab.mode === 'plan' && !collab.compare && <PlanOverlays />}
      {collab.mode === 'plan' && collab.compare && <CompareView key={collab.session?.id} />}
      <JoinModal />
      <Toast />
      <ManualConfirm />
      <AccountDialog />
      <NameDialog />
      <ManualProgress />
      {collab.mode === 'off' && <Onboarding />}
      {collab.mode === 'plan' && <CollabCoach />}
      <ThumbCapture />
      <ImportOnEntry />
      <DocOnEntry />
      <NewOnEntry />
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
      <CollabProvider>
        <PanelLayoutProvider>
          <DockProvider>
            <Shell />
          </DockProvider>
        </PanelLayoutProvider>
      </CollabProvider>
    </EngineProvider>
  )
}

function Shell() {
  const collab = useCollab()
  if (VIEW_ONLY || collab.mode === 'delivery') return <ViewShell />
  if (collab.mode === 'room') return <RoomShell />
  return <AppInner />
}
