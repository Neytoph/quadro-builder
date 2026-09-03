import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { applyTuneJson, DEFAULT_GRADE, DEFAULT_TUNE, gradeHex, loadTune, mergeTune, normHex, saveTune } from '../engine/colorTune.js'
import { useEngine } from '../store/EngineContext'
import { CORNER_BOTTOM, NARROW_MAX, PANEL_GAP, TAB_BAR_H, TOOLBAR_H, VIEW_CUBE_MARGIN, VIEW_CUBE_PX, usePanelLayout } from './panelLayout'
import { useDock } from './dock'

type Tab = 'scene' | 'frame' | 'grade'

type Tune = typeof DEFAULT_TUNE

const SCENE_ROWS: Array<{ key: keyof Tune['scene']; label: string; hint?: string }> = [
  { key: 'blank', label: '空白画布', hint: '关风景时的底色' },
  { key: 'skyHorizon', label: '天空 · 天际' },
  { key: 'skyZenith', label: '天空 · 天顶' },
  { key: 'grass', label: '草地' },
  { key: 'hemiGround', label: '草地反光' },
  { key: 'trunk', label: '树干' },
  { key: 'crownA', label: '树冠 1' },
  { key: 'crownB', label: '树冠 2' },
  { key: 'crownC', label: '树冠 3' },
  { key: 'bush', label: '灌木' },
]

const FRAME_ROWS: Array<{ key: keyof Tune['frame']; label: string }> = [
  { key: 'red', label: '红' },
  { key: 'green', label: '绿' },
  { key: 'blue', label: '蓝' },
  { key: 'yellow', label: '黄' },
  { key: 'petrol', label: '石油蓝' },
  { key: 'mint', label: '薄荷' },
  { key: 'berry', label: '莓粉' },
  { key: 'apricot', label: '杏' },
]

const GRADE_ROWS: Array<{ key: keyof Tune['grade']; label: string; min?: number; max?: number }> = [
  { key: 'exposure', label: '曝光' },
  { key: 'brilliance', label: '鲜明度' },
  { key: 'highlights', label: '高光' },
  { key: 'shadows', label: '阴影' },
  { key: 'contrast', label: '对比度' },
  { key: 'brightness', label: '亮度' },
  { key: 'blackPoint', label: '黑点' },
  { key: 'saturation', label: '饱和度' },
  { key: 'vibrance', label: '自然饱和度' },
  { key: 'warmth', label: '色温' },
  { key: 'tint', label: '色调' },
  { key: 'fade', label: '褪色', min: 0 },
]

function ColorRow({ label, hint, value, preview, onChange }: {
  label: string
  hint?: string
  value: string
  preview?: string
  onChange: (hex: string) => void
}) {
  const [text, setText] = useState(value)
  useEffect(() => { setText(value) }, [value])
  const pick = (raw: string) => {
    setText(raw)
    const hex = normHex(raw)
    if (hex) onChange(hex)
  }
  return (
    <label className="flex items-center gap-2 py-0.5">
      <input
        type="color"
        value={value.toLowerCase()}
        onChange={e => pick(e.target.value)}
        className="w-8 h-8 rounded-md border border-gray-700 bg-transparent cursor-pointer shrink-0 p-0"
      />
      {preview && preview !== value ? (
        <span
          title="滤镜后"
          className="w-4 h-8 rounded-sm border border-gray-700 shrink-0"
          style={{ background: preview }}
        />
      ) : null}
      <span className="flex-1 min-w-0 text-[12px] text-gray-200 leading-tight">
        {label}
        {hint ? <span className="block text-[10px] text-gray-500">{hint}</span> : null}
      </span>
      <input
        type="text"
        spellCheck={false}
        value={text}
        onChange={e => pick(e.target.value)}
        onBlur={() => setText(value)}
        className="w-[5.6rem] shrink-0 rounded-md border border-gray-700 bg-gray-900 px-1.5 py-1 font-mono text-[11px] text-gray-100"
      />
    </label>
  )
}

function GradeRow({ label, value, min = -100, max = 100, onChange }: {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (n: number) => void
}) {
  const shown = Math.round(value)
  return (
    <label className="flex items-center gap-2 py-0.5">
      <span
        className="w-[4.6rem] shrink-0 text-[12px] text-gray-200 cursor-pointer"
        title="双击归零"
        onDoubleClick={() => onChange(0)}
      >
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={shown}
        onChange={e => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)}
        className="flex-1 min-w-0 accent-amber-500"
      />
      <span className="w-8 text-right font-mono text-[11px] text-gray-400 tabular-nums">
        {shown}
      </span>
    </label>
  )
}

export default function ColorTune() {
  const api = useEngine()
  const { pane } = useDock()
  const { right, vw } = usePanelLayout()
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<Tab>('scene')
  const [tune, setTune] = useState<Tune>(() => loadTune())
  const [copied, setCopied] = useState(false)
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(loadTune(), null, 2))
  const [jsonError, setJsonError] = useState('')
  const [comparing, setComparing] = useState(false)
  const compareRef = useRef<{ mode: 'off' | 'hold' | 'pin'; at: number }>({ mode: 'off', at: 0 })
  const tuneRef = useRef(tune)
  tuneRef.current = tune

  const json = useMemo(() => JSON.stringify(tune, null, 2), [tune])
  const narrow = vw <= NARROW_MAX
  const rightOffset = !narrow && pane ? right.width + PANEL_GAP * 2 : PANEL_GAP

  useEffect(() => {
    if (!comparing) setJsonDraft(json)
  }, [json, comparing])

  const commit = useCallback((next: Tune) => {
    const merged = mergeTune(DEFAULT_TUNE, next)
    setTune(merged)
    saveTune(merged)
    setJsonError('')
    if (!comparing) api.applyColorTune(merged)
  }, [api, comparing])

  const applyDraft = useCallback((text: string) => {
    const next = applyTuneJson(tuneRef.current, text)
    if (!next) {
      setJsonError('JSON 无效')
      api.notify('JSON 无效，检查一下括号和逗号', 'warn')
      return false
    }
    setJsonDraft(JSON.stringify(next, null, 2))
    commit(next)
    api.notify('已套上这段 JSON', 'ok')
    return true
  }, [api, commit])

  const showBefore = useCallback(() => {
    setComparing(true)
    api.applyColorTune(structuredClone(DEFAULT_TUNE))
  }, [api])

  const showAfter = useCallback(() => {
    setComparing(false)
    api.applyColorTune(tuneRef.current)
  }, [api])

  const onCompareDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const cur = compareRef.current
    if (cur.mode === 'pin') {
      compareRef.current = { mode: 'off', at: 0 }
      showAfter()
      return
    }
    compareRef.current = { mode: 'hold', at: Date.now() }
    showBefore()
  }

  const onCompareUp = () => {
    const cur = compareRef.current
    if (cur.mode !== 'hold') return
    if (Date.now() - cur.at < 220) {
      compareRef.current = { mode: 'pin', at: cur.at }
      return
    }
    compareRef.current = { mode: 'off', at: 0 }
    showAfter()
  }

  const patchScene = (key: keyof Tune['scene'], value: string | number) => {
    if (key !== 'blank' && !api.grassOn) api.toggleGrass()
    commit({ ...tune, scene: { ...tune.scene, [key]: value } })
  }

  const patchFrame = (key: keyof Tune['frame'], value: string) => {
    commit({ ...tune, frame: { ...tune.frame, [key]: value } })
  }

  const patchGrade = (key: keyof Tune['grade'], value: number) => {
    commit({ ...tune, grade: { ...tune.grade, [key]: value } })
  }

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      api.notify('色值已复制，发给我即可', 'ok')
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      api.notify('复制失败，请手动选中下方 JSON', 'warn')
    }
  }

  if (!api.ready) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed z-40 px-3 h-9 rounded-full bg-amber-700/95 text-white text-[13px] shadow-lg border border-amber-400/40 cursor-pointer"
        style={{ right: rightOffset, top: narrow ? TAB_BAR_H + TOOLBAR_H + PANEL_GAP : TAB_BAR_H + PANEL_GAP }}
      >
        调色
      </button>
    )
  }

  return (
    <aside
      data-panel-chrome
      className="fixed z-40 flex flex-col min-h-0 overflow-hidden bg-gray-950/92 backdrop-blur border border-amber-800/50 rounded-2xl shadow-xl text-gray-200"
      style={{
        right: rightOffset,
        top: narrow ? TAB_BAR_H + TOOLBAR_H + PANEL_GAP : TAB_BAR_H + PANEL_GAP,
        width: 300,
        maxHeight: narrow
          ? 'min(70vh, 560px)'
          : `calc(100vh - 72px - ${VIEW_CUBE_PX + VIEW_CUBE_MARGIN + CORNER_BOTTOM}px)`,
      }}
    >
      <div className="px-3 py-2 border-b border-gray-800 shrink-0 flex items-center gap-2">
        <span className="flex-1 min-w-0 text-sm font-semibold">调色</span>
        <button
          type="button"
          aria-pressed={comparing}
          title="按住看原样，松开回调后；短点可钉住"
          onPointerDown={onCompareDown}
          onPointerUp={onCompareUp}
          onPointerCancel={onCompareUp}
          className={`h-7 px-2 rounded-md text-[11px] cursor-pointer shrink-0 select-none ${
            comparing ? 'bg-white text-gray-900' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'
          }`}
        >
          {comparing ? '原样' : '对比'}
        </button>
        <span className="text-[10px] text-amber-400/90 shrink-0">调试用</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="w-8 h-8 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-gray-800 cursor-pointer text-lg leading-none"
          aria-label="收起"
        >×</button>
      </div>
      {comparing ? (
        <div className="px-3 py-1.5 text-[11px] text-amber-100 bg-amber-900/70 border-b border-amber-800/60 shrink-0">
          正在看出厂原样 · 再点或松开回到调后
        </div>
      ) : null}

      <div className="px-3 pt-2 flex gap-1 shrink-0">
        {([
          { id: 'scene' as const, label: '风景' },
          { id: 'frame' as const, label: '架子' },
          { id: 'grade' as const, label: '滤镜' },
        ]).map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id)
              if (item.id === 'scene' && !api.grassOn) api.toggleGrass()
            }}
            className={`flex-1 h-8 rounded-lg text-[12px] cursor-pointer ${
              tab === item.id ? 'bg-amber-800/70 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className={`px-3 py-2 overflow-y-auto min-h-0 scrollbar-thin ${comparing ? 'opacity-50 pointer-events-none' : ''}`}>
        {tab === 'scene' ? (
          <>
            <p className="text-[11px] text-gray-500 mb-2 leading-snug">
              对着 3D 拖色块。风景色会自动打开左下角草地。窄条是滤镜后的效果。
            </p>
            {SCENE_ROWS.map(row => (
              <ColorRow
                key={String(row.key)}
                label={row.label}
                hint={row.hint}
                value={String(tune.scene[row.key])}
                preview={gradeHex(String(tune.scene[row.key]), tune.grade)}
                onChange={hex => patchScene(row.key, hex)}
              />
            ))}
            <label className="flex items-center gap-2 py-1 mt-1">
              <span className="flex-1 text-[12px] text-gray-200">阳光强度</span>
              <input
                type="range" min={0.6} max={2.2} step={0.02}
                value={tune.scene.dirIntensity}
                onChange={e => patchScene('dirIntensity', Number(e.target.value))}
                className="w-28"
              />
              <span className="w-8 text-right font-mono text-[11px] text-gray-400">
                {tune.scene.dirIntensity.toFixed(2)}
              </span>
            </label>
            <label className="flex items-center gap-2 py-1">
              <span className="flex-1 text-[12px] text-gray-200">天空光</span>
              <input
                type="range" min={0.6} max={2.0} step={0.02}
                value={tune.scene.hemiIntensity}
                onChange={e => patchScene('hemiIntensity', Number(e.target.value))}
                className="w-28"
              />
              <span className="w-8 text-right font-mono text-[11px] text-gray-400">
                {tune.scene.hemiIntensity.toFixed(2)}
              </span>
            </label>
          </>
        ) : tab === 'frame' ? (
          <>
            <p className="text-[11px] text-gray-500 mb-2 leading-snug">
              改的是管子 / 板件底色。旁边窄条是滤镜后的样子，场景里立刻变。
            </p>
            {FRAME_ROWS.map(row => (
              <ColorRow
                key={row.key}
                label={row.label}
                value={tune.frame[row.key]}
                preview={gradeHex(tune.frame[row.key], tune.grade)}
                onChange={hex => patchFrame(row.key, hex)}
              />
            ))}
          </>
        ) : (
          <>
            <p className="text-[11px] text-gray-500 mb-2 leading-snug">
              像手机修图那样统一调。0 为原样，双击某一项归零。底色仍在「架子 / 风景」里。
            </p>
            <div className="flex gap-1 mb-2">
              {FRAME_ROWS.map(row => (
                <span
                  key={row.key}
                  title={`${row.label} · 滤镜后`}
                  className="flex-1 h-5 rounded-sm border border-gray-700"
                  style={{ background: gradeHex(tune.frame[row.key], tune.grade) }}
                />
              ))}
            </div>
            {GRADE_ROWS.map(row => (
              <GradeRow
                key={row.key}
                label={row.label}
                value={tune.grade[row.key]}
                min={row.min}
                max={row.max}
                onChange={n => patchGrade(row.key, n)}
              />
            ))}
            <button
              type="button"
              onClick={() => commit({ ...tune, grade: { ...DEFAULT_GRADE } })}
              className="mt-2 w-full h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-[12px] cursor-pointer"
            >
              滤镜归零
            </button>
          </>
        )}

        <p className="mt-3 mb-1 text-[11px] text-gray-500 leading-snug">
          可直接改或粘贴 JSON，点「套上」立刻进 3D。
        </p>
        <textarea
          value={jsonDraft}
          spellCheck={false}
          disabled={comparing}
          onChange={e => {
            setJsonDraft(e.target.value)
            setJsonError('')
          }}
          onPaste={e => {
            const text = e.clipboardData.getData('text')
            if (!text.trim().startsWith('{')) return
            window.setTimeout(() => applyDraft(text), 0)
          }}
          onBlur={() => {
            if (jsonDraft.trim() === json.trim()) return
            if (jsonDraft.trim()) applyDraft(jsonDraft)
          }}
          className={`mt-0 w-full h-32 rounded-lg border bg-gray-900 px-2 py-1.5 font-mono text-[10px] text-gray-300 resize-y disabled:opacity-50 ${
            jsonError ? 'border-red-600' : 'border-gray-800'
          }`}
        />
        {jsonError ? <p className="mt-1 text-[11px] text-red-400">{jsonError}</p> : null}
        <div className="flex gap-1.5 mt-2 pb-1">
          <button
            type="button"
            onClick={() => void copyJson()}
            className="flex-1 h-8 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-[12px] cursor-pointer"
          >
            {copied ? '已复制' : '复制'}
          </button>
          <button
            type="button"
            disabled={comparing}
            onClick={() => applyDraft(jsonDraft)}
            className="flex-1 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-[12px] cursor-pointer disabled:opacity-40"
          >
            套上
          </button>
          <button
            type="button"
            disabled={comparing}
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText()
                applyDraft(text)
              } catch {
                api.notify('读不了剪贴板，请粘贴到框里', 'warn')
              }
            }}
            className="h-8 px-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-[12px] cursor-pointer disabled:opacity-40"
          >
            粘贴
          </button>
          <button
            type="button"
            disabled={comparing}
            onClick={() => commit(structuredClone(DEFAULT_TUNE))}
            className="h-8 px-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-[12px] cursor-pointer disabled:opacity-40"
          >
            重置
          </button>
        </div>
      </div>
    </aside>
  )
}
