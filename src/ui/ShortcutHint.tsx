import { useEngine } from '../store/EngineContext'
import { useI18n } from '../i18n'
import { FoldHeader } from './panelLayout'

type Row = { chord: string; action: string }

function rowsFor(
  t: (key: string, vars?: Record<string, string | number>) => string,
  mode: string,
  pasting: boolean,
  placingConnector: boolean,
): Row[] {
  if (pasting) {
    return [
      { chord: '↑ ↓', action: t('keys.lift') },
      { chord: 'Q / E', action: t('keys.rotate') },
      { chord: 'M / ⇧M', action: t('keys.mirror') },
      { chord: t('keys.click'), action: t('keys.drop') },
      { chord: 'Esc', action: t('keys.escCancel') },
    ]
  }
  if (placingConnector) {
    return [
      { chord: 'Esc', action: t('keys.escSelect') },
      { chord: 'D', action: t('keys.deleteMode') },
      { chord: t('keys.chord.undo'), action: t('keys.undo') },
    ]
  }
  switch (mode) {
    case 'delete':
      return [
        { chord: t('keys.click'), action: t('keys.clickDelete') },
        { chord: 'Esc / D / S', action: t('keys.escSelect') },
        { chord: t('keys.chord.undo'), action: t('keys.undo') },
      ]
    case 'add':
      return [
        { chord: '1 – 6', action: t('keys.tubeLen') },
        { chord: '↑ ↓ ← →', action: t('keys.buildDir') },
        { chord: 'Esc', action: t('keys.escSelect') },
        { chord: 'D', action: t('keys.deleteMode') },
      ]
    case 'panel':
      return [
        { chord: t('keys.chord.panelTurn'), action: t('keys.panelTurn') },
        { chord: 'Esc', action: t('keys.escSelect') },
        { chord: 'D', action: t('keys.deleteMode') },
      ]
    case 'slide':
    case 'fitting':
    case 'clamp':
    case 'c45':
    case 'reinforce':
      return [
        { chord: 'Esc', action: t('keys.escSelect') },
        { chord: 'D', action: t('keys.deleteMode') },
        { chord: t('keys.chord.undo'), action: t('keys.undo') },
      ]
    case 'assembly':
      return [
        { chord: '[ ]', action: t('keys.step') },
        { chord: 'A / Esc', action: t('keys.escSelect') },
        { chord: 'D', action: t('keys.deleteMode') },
      ]
    default:
      return [
        { chord: t('keys.chord.addSelect'), action: t('keys.addSelect') },
        { chord: t('keys.chord.block'), action: t('keys.block') },
        { chord: t('keys.chord.selectAll'), action: t('keys.selectAll') },
        { chord: t('keys.chord.copyPaste'), action: t('keys.copyPaste') },
        { chord: t('keys.chord.delete'), action: t('keys.deleteSel') },
        { chord: 'Q / E', action: t('keys.rotate') },
        { chord: 'M / ⇧M', action: t('keys.mirror') },
        { chord: `${t('keys.chord.group')} / ${t('keys.chord.ungroup')}`, action: t('keys.group') },
        { chord: 'D', action: t('keys.deleteMode') },
      ]
  }
}

const MODE_TITLE: Record<string, string> = {
  select: 'tool.select',
  delete: 'tool.delete',
  add: 'tool.tubes',
  panel: 'tool.panels',
  slide: 'tool.slides',
  fitting: 'tool.connections',
  clamp: 'tool.connections',
  c45: 'tool.connections',
  reinforce: 'tool.reinforce',
  assembly: 'assembly.toggle',
}

function Kbd({ text }: { text: string }) {
  const parts = text.split(' / ').filter(Boolean)
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      {parts.map((part, i) => (
        <span key={`${part}-${i}`} className="inline-flex items-center">
          {i > 0 && <span className="mx-0.5 text-gray-500 text-[9px]">/</span>}
          <span className="inline-flex items-center justify-center min-w-[1.2rem] h-[1.15rem] px-1 rounded-[4px] border border-gray-700 bg-gray-800 text-[10px] leading-none text-gray-100 font-medium tabular-nums whitespace-nowrap">
            {part}
          </span>
        </span>
      ))}
    </span>
  )
}

export default function ShortcutHint({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const api = useEngine()
  const { t } = useI18n()
  const mode = api.pasting ? 'paste' : api.mode
  const titleKey = api.pasting
    ? 'lib.placing'
    : (MODE_TITLE[api.placingConnector ? 'fitting' : api.mode] || 'tool.select')
  const rows = rowsFor(t, api.mode, api.pasting, !!api.placingConnector)
  const cameraLines = t('hint.camera').split('\n').filter(Boolean)

  return (
    <div
      data-ui="shortcut-hint"
      data-mode={mode}
      className={`relative flex flex-col min-h-0 overflow-hidden rounded-xl border shadow-lg backdrop-blur-sm ${
        api.mode === 'delete' && !api.pasting
          ? 'bg-gray-950/82 border-red-500/25'
          : 'bg-gray-950/82 border-teal-500/25'
      }`}
    >
      <FoldHeader
        open={open}
        onToggle={onToggle}
        title={open ? t('hint.hidePanel') : t('hint.showKeys')}
        label={(
          <span className="normal-case tracking-normal text-[11px] text-gray-100">
            {t('keys.title')}
            <span className="text-gray-400"> · {t(titleKey)}</span>
          </span>
        )}
      />
      {open && (
      <div className="px-2.5 pb-2.5 pt-0.5 overflow-y-auto min-h-0 scrollbar-thin">
        <div className="flex flex-col gap-1">
          {rows.map(row => (
            <div key={row.chord + row.action} className="flex items-start gap-2">
              <Kbd text={row.chord} />
              <span className="text-[11px] text-gray-300 leading-snug pt-px">{row.action}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-gray-700">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{t('keys.camera')}</div>
          <div className="text-[11px] text-gray-400 leading-relaxed whitespace-pre-line">
            {cameraLines.join('\n')}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
