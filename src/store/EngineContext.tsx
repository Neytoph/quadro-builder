import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { bumpCount, track } from '../analytics/track'
import {
  BuildModel, Builder, SceneManager, loadCatalog, computeBOM, compareInventory, connectorsForNode, computeSafety,
  parseQDF, parseDesign, designEntry, buildQDF, buildableTubes, buildableCurvedTubes, buildablePanels, tubeColors, allConnectors, accessories,
  panels, geometry, RANDOM_COLOR, BUILD_ORDERS, docs, storage, setLang as setEngineLang, t as engineT,
  computeBuildPlan, partsOfModel, textilePart,
} from '../engine-api'
import { useI18n } from '../i18n'
import { onSyncEvent, syncSavedDoc, syncNow, syncProbe, syncStarted } from '../sync/bootstrap'
import { tabOpenedFrom, tabSavedAs } from '../sync/origin'
import { pullDoc } from '../sync/docEntry'
import { bootEntry, SESSIONLESS, VIEW_ONLY, type ResumeExport } from '../entry'
import { publishSharePage, sharePagesEnabled, stampFor, type ExportKind, type Stamp } from '../sharePage'
import { statsOfModel } from '../designStats'
import { geometricPreset, jsonToFragment } from '../data/presets'
import pyramidQdf from '../data/A0128.qdf?raw'
import { clearSharePayload, decodeShare, peekSharePayload, shareUrl } from '../share'
import { isUntitledName, labelOf as nameLabel } from '../names'
import { fetchOfficialQdf, officialLibId, OFFICIAL_BY_ID, parseOfficialId } from '../data/official'
import { applyFrameHex, loadTune } from '../engine/colorTune.js'
import { exportAssemblyPdf as runAssemblyPdf } from '../engine/assemblyManual.js'
import { ACCESSORY_IDS } from '../engine/accessoryPack.js'
import { takeModelThumb, waitSceneReady } from '../engine/thumbShot.js'
import { bomToCsv, bomToPngDataUrl, loadImage } from '../ui/bomExport'
import { shareImageDataUrl } from '../ui/shareImage'
import { MOTION } from '../ui/motion'
import { createTabDoc, dropTabDoc, memoryDoc, openTabDoc, readPersonalState, writePersonalState, SEED_ORIGIN, type LocalDoc } from '../collab/localDocs'
import { partCountOf, writeJSON, type ModelJSON } from '../collab/ymodel'
import { appendTab } from './tabs'
import { modelContent, personalDecision, personalRecordUnconfirmed, personalSaveBaseline, readPersonalBinding, restorePersonalBinding, samePersonalBinding, savedGenerationUnchanged, savedRecordState, type PersonalState } from './personalTabs'
import { renderModelCover } from './modelCover'
import { computeAssemblyPlan } from '../engine/assemblyPlan.js'
import { proposeAssemblyRepairs } from '../engine/connectionResolver.js'
import { validAssemblyConfig } from '../engine/assemblyConfig.js'
import { assemblyPdfStrings, assemblyStrings } from '../ui/assemblyStrings'

// 引擎来自 Vanilla JS，这里不跟它的推断类型较劲。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type E = any
type AnyRec = Record<string, E>
type ToastKind = 'ok' | 'warn' | 'err'
type NameAsk = { title: string; ok: string; value: string; resolve: (name: string | null) => void }
export type SidePanel = 'bom' | 'inventory'
export type AssemblyConfig = { version: 1; regions: Array<{ id: string; name: string; partIds: string[] }>; order: string[] }
export type ManualPreview = { data: ModelJSON; plan: E; config: AssemblyConfig; order: string; source: string; tabId: string | null; name: string; repair: E | null }

export interface RoomSettings {
  w: number
  d: number
  h: number
  visible: boolean
  showExtents: boolean
}

export type SafetyLevel = 'error' | 'warn' | 'info'
export interface SafetyFinding {
  rule: string
  level: SafetyLevel
  /** 官方安全须知的章节号，引擎自己的规则是 builder */
  ref: string
  params: Record<string, unknown>
  ids: { nodes?: string[]; tubes?: string[]; panels?: string[] }
}
export interface SafetyResult {
  findings: SafetyFinding[]
  height: number
}

export type ThumbJob = { kind: 'official' | 'preset'; id: string } | { kind: 'model'; data: unknown }

export interface TabInfo extends PersonalState {
  tabId: string
  docId: string | null
  name: string
  dirty: boolean
  /** 共享方案的标签页：方案 id。它的文档经 WebSocket 同步，不用保存 */
  planId: string | null
}

export interface BomRow {
  key: string
  name: string
  count: number
  color?: string | null
  colorName?: string | null
  subtotal?: number
  id?: string
  kind: string
  w?: number
  h?: number
  kitContents?: string
  designAssumption?: boolean
  loadVerified?: boolean
}

export interface InstallationPreview {
  kind: string
  partId: string
  mountCount: number
  valid: boolean
  reason: string | null
  canFlip: boolean
  supportCount?: number
  assumption?: string | boolean
}

export interface BomView {
  tubes: BomRow[]
  connectors: BomRow[]
  panels: BomRow[]
  textiles: BomRow[]
  slides: BomRow[]
  wheels: BomRow[]
  fittings: BomRow[]
  reinforcements: BomRow[]
  screws: BomRow[]
  totals: { tubes: number; connectors: number; panels: number; screws: number; other: number; price: number }
  openEnds: number
}

export interface InvRow {
  group: string
  key: string
  name: string
  need: number
  owned: number
  ok: boolean
  soft?: boolean
}

export interface Inventory {
  tubes: Record<string, number>
  connectors: Record<string, number>
  panels: Record<string, number>
  reinforcements: Record<string, number>
  fittings: Record<string, number>
  screws: Record<string, number>
}

interface EngineApi {
  ready: boolean
  entryReady: boolean
  completeEntry: () => void
  error: string | null
  hostRef: React.RefObject<HTMLDivElement | null>
  tick: number
  mode: string
  color: string
  tubeId: string
  panelId: string
  slideKind: string
  fittingKind: string
  fittingPart: string | null
  poolLinerId: string | null
  clampPart: string
  canUndo: boolean
  canRedo: boolean
  selectionCount: number
  installationPreview: InstallationPreview | null
  insetScrewAxis: 'vertical' | 'horizontal'
  setInsetScrewAxis: (axis: 'vertical' | 'horizontal') => void
  canFlipAccessory: boolean
  confirmInstallation: () => void
  cancelInstallation: () => void
  flipAccessory: () => void
  toast: { message: string; kind: ToastKind } | null
  tabs: TabInfo[]
  activeTabId: string | null
  bom: BomView | null
  inventory: Inventory
  invRows: InvRow[]
  feasible: boolean | null
  sizeCm: [number, number, number] | null
  assembly: { step: number; max: number; active: boolean; order: string }
  assemblyOrders: string[]
  setAssemblyOrder: (order: string) => void
  exportInventory: () => void
  importInventory: (file: File) => Promise<void>
  canPaste: boolean
  pasting: boolean
  pasteHeightCm: number | null
  side: SidePanel
  setSide: (p: SidePanel) => void
  notify: (message: string, kind?: ToastKind) => void
  dismissToast: () => void
  bump: () => void
  setMode: (mode: string) => void
  setColor: (id: string) => void
  recolorAll: (colors: string[]) => void
  setTube: (id: string) => void
  setPanel: (id: string) => void
  setSlide: (kind: string) => void
  setFitting: (kind: string, partId?: string) => void
  setClamp: (id: string) => void
  startPool: (id: string) => void
  startC45: () => void
  startReinforce: () => void
  placeConnector: (id: string) => void
  placingConnector: string | null
  buildStep: (dir: number[]) => void
  moveSelection: (dir: number[]) => void
  cameraAxes: () => { axes: { forward: number[]; right: number[] }; frontal: boolean }
  undo: () => void
  redo: () => void
  rotate: (dir: 1 | -1) => void
  /** 左右（lr）或前后（fb）镜像，按当前视角定轴；粘贴中就翻手上的副本 */
  mirror: (dir: 'lr' | 'fb') => void
  group: () => void
  ungroup: () => void
  /** 当前选中涉及几个组 */
  selectionGroups: number
  deleteSel: () => void
  copy: () => void
  paste: () => void
  cancelPaste: () => void
  nudgePasteY: (steps: number) => void
  selectAll: () => void
  selectConnected: () => void
  placeModule: (key: string) => void
  frame: () => void
  toggleGrass: () => void
  grassOn: boolean
  highlight: (kind: string, id: string, color?: string | null) => void
  /** 按零件 id 高亮一批（安全审查点行用），再点同一批取消 */
  highlightIds: (key: string, ids: string[]) => void
  safety: SafetyResult | null
  setInv: (group: keyof Inventory, key: string, value: number) => void
  newTab: () => void
  closeTab: (tabId: string) => void
  activateTab: (tabId: string) => void
  renameTab: (tabId: string, name: string) => void
  /** 共享方案的标签页换成方案现在的名字 */
  setTabName: (tabId: string, name: string) => void
  /** 存下当前这一座；取消起名返回 null */
  saveCurrent: (name?: string) => Promise<{ docId: string; name: string; data: ModelJSON } | null>
  saveCurrentAs: () => Promise<void>
  /** 起名框：保存、另存为、重命名都用它，不走浏览器自带的弹框 */
  askName: (title: string, ok: string, value: string) => Promise<string | null>
  answerName: (name: string | null) => void
  nameAsk: { title: string; ok: string; value: string } | null
  openDoc: (docId: string) => Promise<void>
  retrySave: (tabId: string) => Promise<void>
  /** `local`：本次保存尚未全部交给服务器。 */
  listDocs: () => Promise<Array<{ id: string; name: string; updatedAt: number; local: boolean }>>
  removeDoc: (docId: string) => Promise<void>
  renameDoc: (docId: string, name: string) => Promise<void>
  duplicateDoc: (docId: string) => Promise<void>
  pushDoc: (docId: string) => Promise<boolean>
  importFile: (file: File) => Promise<void>
  openLibraryId: (id: string) => Promise<void>
  exportQdf: () => void
  exportJson: () => void
  setAssembly: (on: boolean) => void
  stepAssembly: (delta: number) => void
  engineLang: (lang: 'zh' | 'en' | 'de') => void
  room: RoomSettings
  setRoom: (p: Partial<RoomSettings>) => void
  roomOverflow: { w: number; d: number; h: number }
  loadPreset: (key: string) => void
  setViewCubePad: (right: number, bottom: number, size?: number) => void
  setViewCubeEnabled: (on: boolean) => void
  exportPng: () => Promise<void>
  /** 料表存成表格文件 */
  exportBomCsv: () => Promise<void>
  /** 料表存成一张图，发群里直接能看 */
  exportBomPng: () => Promise<void>
  exportAssemblyPdf: () => Promise<void>
  confirmExportManual: (cover?: string | null) => Promise<void>
  cancelExportManual: () => void
  exportManualConfirm: boolean
  manualPreview: ManualPreview | null
  updateManualConfig: (config: AssemblyConfig) => void
  updateManualOrder: (order: string) => void
  saveManualConfig: () => boolean
  reviewManualRepairs: (nodeIds: string[]) => void
  applyManualRepairs: () => boolean
  discardManualRepairs: () => void
  exportingManual: { page: number; total: number } | null
  shareCurrent: () => Promise<void>
  /**
   * 导出文件要先有账号（部署设了 VITE_REGISTER_URL 时）。register：还没登录，问要不要
   * 去注册；resume：注册完回来了，问要不要接着导出。
   */
  accountAsk: { kind: ResumeExport; phase: 'register' | 'resume' } | null
  answerAccount: (go: boolean) => void
  catalog: {
    tubes: Array<{ id: string; length_cm: number; name?: string }>
    curved: Array<{ id: string; name?: string }>
    panels: Array<{ id: string; w?: number; h?: number; name?: string; holes?: number; acrylic?: boolean; feature?: string; compat?: boolean }>
    colors: Array<{ id: string; hex: string; name?: string; name_en?: string }>
    connectors: Array<{ id: string; kind: string; qdf?: string; name?: string }>
    accessories: Array<{ id: string; qdf?: string; name?: string; variant?: string; compat?: boolean; rail?: { along: number; gap: number } }>
  }
  applyColorTune: (tune: { scene: Record<string, unknown>; frame: Record<string, string>; grade?: Record<string, number> }) => void
  startThumbBatch: () => void
  endThumbBatch: () => void
  /** 截一张缩略图：官方造型、起步造型，或者一份造型 JSON（批量导入的结果） */
  captureThumb: (job: ThumbJob) => Promise<string | null>
  /** 当前画面这一座的缩略图（和模型库封面同一条截图通路），共享方案导出时当封面 */
  coverShot: () => Promise<string | null>
  /** 交付查看：把一份外面取来的文档换进来当唯一的标签页，只能看。 */
  attachDoc: (o: { local: LocalDoc; name: string; readOnly: boolean }) => void
  /** 打开共享方案的标签页（已开着就切过去），返回标签页 id */
  openPlanTab: (planId: string, name: string, preserveOriginal?: boolean) => string
  /** 共享方案标签页的权限：能不能改、新建零件 id 的本端标记（见 BuildModel.idTag） */
  setTabAccess: (tabId: string, o: { readOnly: boolean; idTag: string }) => void
  tabLocal: (tabId: string) => LocalDoc | null
  readOnly: boolean
  /** 引擎本体（共享界面要投影坐标、取点、给零件上色） */
  engine: () => { scene: E; model: E; builder: E } | null
}

const Ctx = createContext<EngineApi | null>(null)

const TEXTIL = new Set([
  'textil2', 'lattice2', 'textil-round2', 'bag2', 'roof-large2', 'roof2',
  'textile', 'textile_20x40', 'lattice', 'textile_round', 'bag', 'roof_large', 'roof',
])
const WHEEL = new Set([
  'multi-wheel2', 'floating-wheel2', 'hub-cap2', 'casters2', 'adapter2', 'bearing2', 'steering-lock2',
  'wheel', 'wheel_floating', 'hub_cap', 'caster', 'wheel_adapter', 'wheel_bearing', 'steering_lock',
])

function cleanBomText(v: unknown): string {
  if (v == null) return ''
  const s = String(v).trim()
  return !s || s === 'undefined' || s === 'null' ? '' : s
}

function emptyInv(): Inventory {
  return { tubes: {}, connectors: {}, panels: {}, reinforcements: {}, fittings: {}, screws: {} }
}

function inventoryUsed(inv: Inventory) {
  return Object.values(inv).some(group => Object.values(group).some(n => Number(n) > 0))
}

/** 库存里记了多少种件（数量 > 0 的算一种）。打点用，别跟上面的布尔混了。 */
function inventoryRows(inv: Inventory) {
  let n = 0
  for (const group of Object.values(inv)) {
    for (const v of Object.values(group)) if (Number(v) > 0) n++
  }
  return n
}

const INV_GROUPS = ['tubes', 'connectors', 'panels', 'reinforcements', 'fittings', 'screws'] as const
const QDF_COLORS = new Set(['red', 'green', 'blue', 'yellow', 'black'])

function parseInventory(src: unknown): Inventory | null {
  if (!src || typeof src !== 'object') return null
  const rec = src as AnyRec
  const payload = (rec.inventory && typeof rec.inventory === 'object') ? rec.inventory as AnyRec
    : (rec.data && typeof rec.data === 'object' && !INV_GROUPS.some(g => rec[g])) ? rec.data as AnyRec
    : rec
  if (!INV_GROUPS.some(g => payload[g] && typeof payload[g] === 'object')) return null
  const next = emptyInv()
  for (const g of INV_GROUPS) {
    const group = payload[g]
    if (!group || typeof group !== 'object') continue
    for (const [k, v] of Object.entries(group as Record<string, unknown>)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) next[g][k] = n
    }
  }
  return next
}

function qdfWillMapColors(model: E) {
  if (!model) return false
  const hit = (c: unknown) => typeof c === 'string' && c.length > 0 && !QDF_COLORS.has(c)
  for (const t of model.tubes?.values?.() || []) if (hit(t.color)) return true
  for (const p of model.panels?.values?.() || []) if (hit(p.color)) return true
  for (const x of model.textiles?.values?.() || []) if (hit(x.color)) return true
  return false
}

function modelPartCount(model: unknown) {
  if (!model || typeof model !== 'object') return 0
  const rec = model as AnyRec
  const n = (v: unknown) => Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0)
  // 只有连接件、没有管/板，不算一份设计（空场景误点通型会留下一个节点）。
  return n(rec.tubes) + n(rec.panels) + n(rec.slides) + n(rec.fittings)
}

// 「搭完一座」的门槛：最小的官方造型是 20 件管和板（不算连接件，口径同
// modelPartCount）。用户亲手改出来的一座到了这个规模，就算搭出了一座完整的架子。
// 后台来源看板（小麦坊 gateway/internal/store/sources.go）用同一个数判断老数据。
const BUILT_MIN_PARTS = 20

// 选件打点。连着选同一个不重复发——工具条的下拉每打开一次就会把当前件
// 再点一遍，不去重的话一次正经搭建能刷出几十条一模一样的记录。
let lastPick = ''
function pickPart(kind: string, id: string) {
  const key = kind + ':' + id
  if (key === lastPick) return
  lastPick = key
  track('builder.part.pick', { kind, id })
}

// 存盘时的构成快照。比"每放一根管发一条"便宜几百倍，回答的还是更该问的
// 那个问题：什么件真的被留下了——试了又删的不算数，那才是定价和二手
// 该看的口径。props 最多 8 个（gateway/internal/events 的 maxProps），
// 保存时加上 named 和访问标识，正好是 8 个。
function modelShape(model: unknown) {
  const rec = (model && typeof model === 'object' ? model : {}) as AnyRec
  const n = (v: unknown) => Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0)
  return {
    parts: modelPartCount(model),
    tubes: n(rec.tubes),
    conns: n(rec.connectors),
    panels: n(rec.panels),
    slides: n(rec.slides),
    fittings: n(rec.fittings),
  }
}

function cubeLabels() {
  return {
    right: engineT('cube_right'), left: engineT('cube_left'),
    top: engineT('cube_top'), bottom: engineT('cube_bottom'),
    front: engineT('cube_front'), back: engineT('cube_back'),
  }
}

/**
 * 标签页。造型本身在 local（这一页的 Yjs 文档和它的编辑记录）里，
 * 会话记录只存名字、对应的存档和界面状态。
 */
type Tab = TabInfo & {
  view: AnyRec
  local: LocalDoc
  /** 共享方案：新建零件 id 里夹的本端标记，见 BuildModel.idTag */
  idTag?: string
  /** 共享方案里的评论者和访客、交付查看：只能看 */
  readOnly?: boolean
}

const EMPTY_MODEL: ModelJSON = { format: 2, nodes: [], tubes: [] }

/** 让引擎按它的规矩读一遍再导出：旧格式升上来、坐标取整，写进文档的都是当前格式。 */
function normalizeModel(data: unknown): ModelJSON | null {
  const m = new BuildModel()
  const res = m.loadJSON(data)
  return res && res.ok ? m.toJSON() as ModelJSON : null
}

/**
 * 整座换掉（打开文件、官方造型换进空标签页）：文档改成 json，不进撤销记录，
 * 原来的撤销记录也清掉。当前页的画面由文档变化带着刷新。
 */
function replaceTabModel(tab: Tab, json: ModelJSON) {
  writeJSON(tab.local.doc, json, SEED_ORIGIN)
  tab.local.history.clear()
}

/** 新标签页，文档里是 seed。只放一座的打开方式不在本机留库。 */
function makeTab(seed: ModelJSON, name: string, docId: string | null): Tab {
  const tabId = docs.newTabId()
  const local = SESSIONLESS ? memoryDoc(seed) : createTabDoc(tabId, seed)
  return { tabId, docId, name, dirty: false, planId: null, view: {}, local, editGeneration: 0, saveState: 'unsaved' }
}

function persistPersonal(tab: Tab) {
  if (tab.planId || tab.readOnly || SESSIONLESS) return
  const { docId, name, dirty, baseRev, savedContent, editGeneration, saveId, saveState, conflictDocId } = tab
  writePersonalState(tab.local, { bindingVersion: 1, docId, name, dirty, baseRev, savedContent, editGeneration, saveId, saveState, conflictDocId })
}

/**
 * 共享方案的标签页：文档先空着，连上服务器以后拿到方案的内容（服务器上还没有就由
 * 编辑者用方案的 data 生成）。
 */
function makePlanTab(planId: string, name: string): Tab {
  const tabId = docs.newTabId()
  return { tabId, docId: null, name, dirty: false, planId, view: {}, local: createTabDoc(tabId, null) }
}

function tabParts(tab: Tab) {
  return partCountOf(tab.local.history.toJSON())
}

/** 空的「未命名」标签页不留；全空的话留第一个。返回留下的和去掉的。 */
function pruneSessionTabs(tabs: Tab[]) {
  const keep = tabs.filter(tb => tb.planId || tb.docId || tabParts(tb) > 0 || !isUntitledName(tb.name))
  if (keep.length) return { keep, gone: tabs.filter(tb => !keep.includes(tb)) }
  const first = tabs[0]
  return first ? { keep: [{ ...first, dirty: false }], gone: tabs.slice(1) } : { keep: tabs, gone: [] }
}

function loadInv(): Inventory {
  const raw = (storage.loadInventory?.() as Inventory | null) || emptyInv()
  return { ...emptyInv(), ...raw, tubes: raw.tubes || {}, connectors: raw.connectors || {}, panels: raw.panels || {}, reinforcements: raw.reinforcements || {}, fittings: raw.fittings || {}, screws: raw.screws || {} }
}

const ROOM_KEY = 'quadro.room.v1'
const DEFAULT_ROOM: RoomSettings = { w: 300, d: 400, h: 240, visible: false, showExtents: false }

function clampRoomCm(n: number) {
  if (!Number.isFinite(n)) return 100
  return Math.min(2000, Math.max(40, Math.round(n)))
}

function loadRoom(): RoomSettings {
  try {
    const v = JSON.parse(localStorage.getItem(ROOM_KEY) || 'null') as Partial<RoomSettings> | null
    if (v && typeof v.w === 'number' && typeof v.d === 'number' && typeof v.h === 'number') {
      return {
        w: clampRoomCm(v.w), d: clampRoomCm(v.d), h: clampRoomCm(v.h),
        visible: !!v.visible, showExtents: !!v.showExtents,
      }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_ROOM }
}

/** 按 ?src= 取来的造型文件：Builder 的 JSON（可能包在 {design} 里），否则当 .qdf 解。 */
function designFromText(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    const data = JSON.parse(trimmed) as AnyRec
    return 'design' in data ? data.design : data
  }
  const data = parseDesign(text)
  if (!data) throw new Error('qdf')
  return data
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export function asBom(raw: AnyRec): BomView {
  const tubes = ((raw.tubes as AnyRec[]) || []).map(r => ({
    key: String(r.key ?? `${r.tubeId}|${r.color}`), name: cleanBomText(r.name), count: Number(r.count),
    color: (r.color as string) || null, colorName: (r.colorName as string) || null, subtotal: Number(r.subtotal || 0),
    id: cleanBomText(r.tubeId), kind: 'tubes',
    kitContents: cleanBomText(r.kitContents), designAssumption: r.designAssumption === true, loadVerified: r.loadVerified,
  }))
  const connectors = ((raw.connectors as AnyRec[]) || []).map(r => ({
    key: `connectors:${r.type}`, name: cleanBomText(r.name), count: Number(r.count),
    subtotal: Number(r.subtotal || 0), id: cleanBomText(r.type), kind: 'connectors',
  }))
  const panels = ((raw.panels as AnyRec[]) || []).map(r => ({
    key: String(r.key ?? `${r.panelId}|${r.color}`), name: cleanBomText(r.name), count: Number(r.count),
    color: (r.color as string) || null, colorName: (r.colorName as string) || null, subtotal: Number(r.subtotal || 0),
    id: cleanBomText(r.panelId), kind: 'panels',
    kitContents: cleanBomText(r.kitContents), designAssumption: r.designAssumption === true, loadVerified: r.loadVerified,
  }))
  const textiles: BomRow[] = []
  const wheels: BomRow[] = []
  const fittings: BomRow[] = []
  for (const r of ((raw.fittings as AnyRec[]) || [])) {
    const id = cleanBomText(r.id) || cleanBomText(r.kind)
    const row: BomRow = {
      key: `fittings:${cleanBomText(r.key) || id}`, name: cleanBomText(r.name), count: Number(r.count),
      subtotal: Number(r.subtotal || 0), id, kind: 'fittings',
      w: Number(r.w) || undefined, h: Number(r.h) || undefined,
      kitContents: cleanBomText(r.kitContents), designAssumption: r.designAssumption === true, loadVerified: r.loadVerified,
    }
    const qdf = cleanBomText(r.qdf) || cleanBomText(r.kind)
    if (TEXTIL.has(qdf) || TEXTIL.has(id)) textiles.push({ ...row, kind: 'textiles' })
    else if (WHEEL.has(qdf) || WHEEL.has(id)) wheels.push({ ...row, kind: 'wheels' })
    else fittings.push(row)
  }
  for (const r of ((raw.textiles as AnyRec[]) || [])) {
    const w = Number(r.w) || undefined
    const h = Number(r.h) || undefined
    textiles.push({
      key: String(r.key ?? r.id ?? `${w}x${h}|${r.color || ''}`),
      name: cleanBomText(r.name),
      count: Number(r.count),
      color: (r.color as string) || null,
      subtotal: Number(r.subtotal || 0),
      id: cleanBomText(r.id) || 'textile',
      kind: 'textiles',
      w, h,
      kitContents: cleanBomText(r.kitContents), designAssumption: r.designAssumption === true, loadVerified: r.loadVerified,
    })
  }
  const slides = ((raw.slides as AnyRec[]) || []).map(r => ({
    key: `slides:${r.id || r.kind}`, name: cleanBomText(r.name), count: Number(r.count),
    subtotal: Number(r.subtotal || 0), id: cleanBomText(r.id) || cleanBomText(r.kind), kind: 'slides',
  }))
  const reinforcements = ((raw.reinforcements as AnyRec[]) || []).map(r => ({
    key: `reinforcements:${r.id}`, name: cleanBomText(r.name), count: Number(r.count),
    subtotal: Number(r.subtotal || 0), id: cleanBomText(r.id), kind: 'reinforcements',
  }))
  const screws = ((raw.screws as AnyRec[]) || []).map(r => ({
    key: `screws:${r.id}|${r.color || ''}`, name: cleanBomText(r.name), count: Number(r.count),
    color: (r.color as string) || null, subtotal: Number(r.subtotal || 0), id: cleanBomText(r.id), kind: 'screws',
  }))
  const sum = (rows: BomRow[]) => rows.reduce((s, r) => s + r.count, 0)
  const totals = (raw.totals as AnyRec) || {}
  const price = Number(totals.price ?? (
    [...tubes, ...connectors, ...panels, ...textiles, ...slides, ...wheels, ...fittings, ...reinforcements, ...screws]
      .reduce((s, r) => s + (r.subtotal || 0), 0)
  ))
  return {
    tubes, connectors, panels, textiles, slides, wheels, fittings, reinforcements, screws,
    totals: {
      tubes: Number(totals.tubes ?? sum(tubes)),
      connectors: Number(totals.connectors ?? sum(connectors)),
      panels: Number(totals.panels ?? sum(panels)),
      screws: Number(totals.screws ?? sum(screws)),
      other: Number(totals.other ?? (sum(textiles) + sum(slides) + sum(wheels) + sum(fittings) + sum(reinforcements))),
      price,
    },
    openEnds: Number(raw.openEnds || 0),
  }
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const eng = useRef<{ scene: E; model: E; builder: E } | null>(null)
  const thumbBatch = useRef<{ json: unknown; camera: unknown; sceneOn: boolean; mode: string } | null>(null)
  // 截图一次只做一件：存下时截的封面、开启共享时截的封面、发布前截的画面可能同时来，
  // 两批叠在一起，先结束的那一批会把场景复位，后一批截到的就是错的
  const shotTurn = useRef<Promise<unknown>>(Promise.resolve())
  function inTurn<T>(job: () => Promise<T>): Promise<T> {
    const run = shotTurn.current.then(job)
    shotTurn.current = run.then(() => undefined, () => undefined)
    return run
  }
  const tabsRef = useRef<Tab[]>([])
  const activeRef = useRef<string | null>(null)
  // 料表导出在回调里跑，用 ref 取当下的料表、尺寸、库存和语言
  const bomRef = useRef<BomView | null>(null)
  const sizeRef = useRef<[number, number, number] | null>(null)
  const invRowsRef = useRef<InvRow[]>([])
  const langRef = useRef<'zh' | 'en' | 'de'>('zh')
  const switching = useRef(false)
  // 整座换进来（官方造型、导入文件）的那一下不算用户在搭，见 markDirty 里的「搭完一座」
  const loadingModel = useRef(false)
  const builtTabs = useRef(new Set<string>())
  const clipboard = useRef<unknown>(null)
  const sessionTimer = useRef<number | null>(null)
  const highlightKey = useRef<string | null>(null)

  const [ready, setReady] = useState(false)
  const [entryReady, setEntryReady] = useState(false)
  const completeEntry = useCallback(() => setEntryReady(true), [])
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null)
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [inventory, setInventory] = useState<Inventory>(loadInv)
  const [room, setRoomState] = useState<RoomSettings>(loadRoom)
  const [side, setSide] = useState<SidePanel>('bom')
  const [exportingManual, setExportingManual] = useState<{ page: number; total: number } | null>(null)
  const [exportManualConfirm, setExportManualConfirm] = useState(false)
  const [manualPreview, setManualPreview] = useState<ManualPreview | null>(null)
  const manualPreviewRef = useRef<ManualPreview | null>(null)
  function putManualPreview(preview: ManualPreview | null) {
    manualPreviewRef.current = preview
    setManualPreview(preview)
  }
  const exportingManualRef = useRef(false)
  const [nameAsk, setNameAsk] = useState<NameAsk | null>(null)
  const [accountAsk, setAccountAsk] = useState<EngineApi['accountAsk']>(null)
  const nameAskRef = useRef<NameAsk | null>(null)
  const [catalog, setCatalog] = useState<EngineApi['catalog']>({
    tubes: [], curved: [], panels: [], colors: [], connectors: [], accessories: [],
  })

  const bump = useCallback(() => setTick(n => n + 1), [])
  const notify = useCallback((message: string, kind: ToastKind = 'ok') => {
    setToast({ message, kind })
  }, [])

  /**
   * 模型里有、文档里还没有的改动写进文档。编辑都经 Builder 的 recordHistory 交给文档，
   * 这里兜住没走那条路的改动，保证刷新以后还在。拖动、粘贴、截缩略图、换标签页的
   * 过程中模型里是中间状态，不写。
   */
  const flushModel = useCallback(() => {
    const e = eng.current
    const tab = tabsRef.current.find(x => x.tabId === activeRef.current)
    if (!e || !tab || switching.current || thumbBatch.current || e.builder.busy()) return
    if (e.builder.history !== tab.local.history) return
    tab.local.history.commit(JSON.stringify(tab.local.history.toJSON()), JSON.stringify(e.model.toJSON()))
  }, [])

  /**
   * 把标签页记进本机，下次打开接着来。造型本身已经在各页的 Yjs 文档里，这里记名字、
   * 存档和界面状态。只看、共享方案、交付、画房间这几种打开方式不记：它们不是这个人
   * 自己的标签页，不能盖掉。
   */
  const saveSessionNow = useCallback(() => {
    if (SESSIONLESS) return Promise.resolve()
    if (sessionTimer.current) window.clearTimeout(sessionTimer.current)
    sessionTimer.current = null
    const e = eng.current
    const active = tabsRef.current.find(x => x.tabId === activeRef.current)
    if (e && active) {
      flushModel()
      active.view = { ...(e.builder.uiState() as AnyRec), camera: e.scene.cameraState() }
    }
    return docs.saveSession({
      tabs: tabsRef.current.map(tb => ({
        tabId: tb.tabId, docId: tb.docId, name: tb.name, dirty: tb.dirty, planId: tb.planId, view: tb.view,
        baseRev: tb.baseRev, savedContent: tb.savedContent, editGeneration: tb.editGeneration, saveId: tb.saveId,
        saveState: tb.saveState, conflictDocId: tb.conflictDocId,
      })),
      activeTabId: activeRef.current,
    }) as Promise<void>
  }, [flushModel])

  const persistSession = useCallback(() => {
    if (SESSIONLESS) return
    if (sessionTimer.current) window.clearTimeout(sessionTimer.current)
    sessionTimer.current = window.setTimeout(() => { void saveSessionNow() }, 400)
  }, [saveSessionNow])

  const syncTabs = useCallback(() => {
    for (const tab of tabsRef.current) persistPersonal(tab)
    setTabs(tabsRef.current.map(({ tabId, docId, name, dirty, planId, baseRev, savedContent, editGeneration, saveId, saveState, conflictDocId }) =>
      ({ tabId, docId, name, dirty, planId, baseRev, savedContent, editGeneration, saveId, saveState, conflictDocId })))
    setActiveTabId(activeRef.current)
    persistSession()
  }, [persistSession])

  const markDirty = useCallback(() => {
    if (switching.current) return
    const tab = tabsRef.current.find(x => x.tabId === activeRef.current)
    // 共享方案随改随同步，没有「没保存」这回事
    if (tab && !tab.planId && !tab.readOnly) {
      tab.editGeneration = (tab.editGeneration || 0) + 1
      tab.dirty = true
      if (tab.saveState !== 'conflict') tab.saveState = 'unsaved'
      syncTabs()
    } else {
      persistSession()
    }
    // 每个标签页只记一次，打开官方造型、导入文件那一下不算：那是换进来的，
    // 在它上面接着改一步才算用户自己搭出来的。
    const e2 = eng.current
    if (tab && e2 && !loadingModel.current && !builtTabs.current.has(tab.tabId)) {
      const parts = modelPartCount(e2.model.toJSON())
      if (parts >= BUILT_MIN_PARTS) {
        builtTabs.current.add(tab.tabId)
        track('builder.design.built', { parts })
      }
    }
    bump()
  }, [bump, persistSession, syncTabs])

  const applyTab = useCallback((tab: Tab) => {
    const e = eng.current
    if (!e) return
    switching.current = true
    e.builder.modelReplaced()
    e.builder.setHistory(tab.local.history)
    e.builder.setReadOnly(!!tab.readOnly)
    e.model.idTag = tab.idTag || ''
    const res = e.model.loadJSON(tab.local.history.toJSON())
    if (!res.ok) throw new Error(`tab ${tab.tabId} does not load: ${res.reason}`)
    e.builder.setUiState(tab.view || {})
    e.builder.setMode((tab.view?.mode as string) || 'select')
    if (tab.view?.camera) e.scene.restoreCameraState(tab.view.camera)
    else e.scene.resetCamera(e.model, { animate: true, swoop: true })
    e.builder.refresh()
    switching.current = false
    bump()
  }, [bump])

  /** 标签页的造型，从它的 Yjs 文档导出。当前页先把模型里没交出去的改动写进文档。 */
  const exportTab = useCallback((tab: Tab): ModelJSON => {
    if (tab.tabId === activeRef.current) flushModel()
    return tab.local.history.toJSON()
  }, [flushModel])

  const snapshotActive = useCallback(() => {
    const e = eng.current
    const tab = tabsRef.current.find(x => x.tabId === activeRef.current)
    if (!e || !tab) return
    flushModel()
    tab.view = { ...(e.builder.uiState() as AnyRec), camera: e.scene.cameraState() }
  }, [flushModel])

  const reconcilePersonalNow = useCallback(async (tab: Tab, supplied?: AnyRec | null) => {
    if (!tab.docId || tab.planId || tab.readOnly || SESSIONLESS) return
    if (tab.tabId === activeRef.current && eng.current?.builder.busy()) return
    if (tab.tabId === activeRef.current) snapshotActive()
    const originalId = tab.docId
    const binding = { docId: originalId, saveId: tab.saveId }
    const stored = supplied === undefined ? await docs.getDoc(originalId) as AnyRec | null : supplied
    const record = stored?.pendingRemote || stored
    if (!tabsRef.current.includes(tab) || !samePersonalBinding(tab, binding)) return
    // 未确认的旧本机内容不是云端快照，不能赋予工作基线或作为“最新”标签。
    const unconfirmed = personalRecordUnconfirmed(stored)
    const remoteData = record?.data && (!unconfirmed || stored?.pendingRemote) ? normalizeModel(record.data) : null
    const current = tab.local.history.toJSON()
    const decision = personalDecision(tab, tab.dirty, current, remoteData ? { ...record, data: remoteData, rev: Number(record?.rev || 0) } : null)
    if (decision === 'same') {
      if (remoteData && modelContent(current) === modelContent(remoteData)) {
        tab.baseRev = Number(record?.rev || 0)
        tab.savedContent = modelContent(remoteData)
        if (!tab.dirty) {
          tab.name = String(record?.name || tab.name)
          tab.saveId = record?.saveId
          const nextState = savedRecordState(record || {})
          const retrying = record?.dirty && (tab.saveState === 'syncing' || tab.saveState === 'failed')
          if (tab.saveState !== 'conflict' && !retrying) tab.saveState = nextState
        }
      }
      persistPersonal(tab)
      return
    }
    if (decision === 'refresh' && remoteData) {
      // 文档变化通知和清撤销会同步调用引擎；整个替换期间禁止反向 flush/markDirty。
      switching.current = true
      try { replaceTabModel(tab, remoteData) } finally { switching.current = false }
      tab.name = String(record?.name || tab.name)
      tab.baseRev = Number(record?.rev || 0)
      tab.savedContent = modelContent(remoteData)
      tab.saveId = record?.saveId
      tab.saveState = 'synced'
      tab.dirty = false
      if (tab.tabId === activeRef.current) applyTab(tab)
    } else {
      // 不可靠历史基线、未保存工作或墓碑：保全工作副本，原设计另开最新内容。
      const copyName = t('sync.recoveryName', { name: tab.name })
      const generation = tab.editGeneration || 0
      const preservedId = tab.saveId ? stored?.conflictCopies?.[tab.saveId] : stored?.legacyRecoveryId
      const preserved = preservedId ? await docs.getDoc(preservedId) as AnyRec | null : null
      const preservedData = preserved?.data ? normalizeModel(preserved.data) : null
      // 历史副本的建立/选择交给同一存储事务，避免与真实 GET 并发时重复保全或覆盖别的草稿。
      const legacySource = unconfirmed || !!stored?.legacyRecoveryId && !tab.saveId
      const copy = preserved && preservedData && modelContent(preservedData) === modelContent(current)
        ? preserved : await docs.saveDoc({ docId: legacySource ? originalId : null, name: copyName,
          data: structuredClone(current), ...(legacySource ? personalSaveBaseline(tab) : { baseRev: 0 }) })
      if (!tabsRef.current.includes(tab) || !samePersonalBinding(tab, binding)) return
      tab.docId = String(copy.id)
      if ((tab.editGeneration || 0) === generation) tab.name = String(copy.name)
      tab.baseRev = Number(copy.rev || 0)
      tab.savedContent = modelContent(current)
      tab.saveId = String(copy.saveId)
      tab.dirty = !savedGenerationUnchanged(tab, generation, current, tab.local.history.toJSON())
      tab.saveState = 'conflict'
      tab.conflictDocId = remoteData ? originalId : undefined
      if (remoteData && !tabsRef.current.some(x => x.docId === originalId)) {
        const latest = makeTab(remoteData, String(record?.name || ''), originalId)
        Object.assign(latest, { baseRev: Number(record?.rev || 0), savedContent: modelContent(remoteData), saveId: record?.saveId, saveState: 'synced' })
        tabsRef.current.push(latest)
      }
      notify(t(remoteData || unconfirmed ? 'sync.conflictProtected' : 'sync.deletedProtected'), 'warn')
    }
    persistPersonal(tab)
  }, [applyTab, notify, snapshotActive, t])

  const reconcilingTabs = useRef(new Map<string, Promise<void>>())
  const reconcilePersonal = useCallback((tab: Tab, supplied?: AnyRec | null): Promise<void> => {
    const pending = reconcilingTabs.current.get(tab.tabId)
    if (pending) return pending
    const next = reconcilePersonalNow(tab, supplied).finally(() => {
      reconcilingTabs.current.delete(tab.tabId)
    })
    reconcilingTabs.current.set(tab.tabId, next)
    return next
  }, [reconcilePersonalNow])

  const reconcileRef = useRef(reconcilePersonal)
  reconcileRef.current = reconcilePersonal

  useEffect(() => {
    if (!ready || SESSIONLESS) return
    let dead = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let queued = Promise.resolve()
    const reconcile = () => {
      if (dead) return
      if (eng.current?.builder.busy()) {
        timer = setTimeout(reconcile, 150)
        return
      }
      queued = queued.then(async () => {
        if (dead) return
        for (const tab of [...tabsRef.current]) await reconcileRef.current(tab)
        if (!dead) syncTabsRef.current()
      }).catch(error => {
        console.warn('[personal tabs]', error)
        if (!dead) notifyRef.current(t('sync.failed'), 'warn')
      })
    }
    const stop = onSyncEvent(event => {
      if (event.type === 'legacy-deletion') notifyRef.current(t('sync.legacyDeletion'), 'warn')
      if (event.type === 'pushed') {
        for (const tab of tabsRef.current) {
          if (tab.docId !== event.id || !event.saveId || tab.saveId !== event.saveId) continue
          tab.baseRev = event.rev
          if (!tab.dirty && tab.saveState !== 'conflict') tab.saveState = 'synced'
        }
        syncTabsRef.current()
        // 较早保存的回执可以推进同一工作链中较新保存的基线；存档事务负责核对因果关系。
        queued = queued.then(async () => {
          for (const tab of tabsRef.current) {
            if (tab.docId !== event.id || !tab.saveId) continue
            const doc = await docs.getDoc(event.id) as AnyRec | null
            if (doc?.saveId === tab.saveId && !doc.pendingRemote) tab.baseRev = Number(doc.rev || 0)
          }
          if (!dead) syncTabsRef.current()
        }).catch(error => console.warn('[save baseline]', error))
      }
      if (event.type === 'error' || event.type === 'quota') {
        for (const tab of tabsRef.current) {
          if (tab.saveState === 'syncing' || tab.saveState === 'local') tab.saveState = 'failed'
        }
        syncTabsRef.current()
        notifyRef.current(t('sync.failed'), 'warn')
      }
      if (event.type === 'pulled' || event.type === 'idle' || event.type === 'conflict') reconcile()
    })
    reconcile()
    return () => { dead = true; stop(); if (timer) clearTimeout(timer) }
  }, [ready, t])

  const markDirtyRef = useRef(markDirty)
  const bumpRef = useRef(bump)
  const notifyRef = useRef(notify)
  const applyTabRef = useRef(applyTab)
  const syncTabsRef = useRef(syncTabs)
  const persistSessionRef = useRef(persistSession)
  markDirtyRef.current = markDirty
  bumpRef.current = bump
  notifyRef.current = notify
  applyTabRef.current = applyTab
  syncTabsRef.current = syncTabs
  persistSessionRef.current = persistSession

  useEffect(() => {
    let dead = false
    const host = hostRef.current
    if (!host) {
      setError('Canvas host missing')
      return
    }

    ;(async () => {
      try {
        await loadCatalog()
        if (dead) return
        setCatalog({
          tubes: buildableTubes(),
          curved: buildableCurvedTubes(),
          panels: buildablePanels(),
          colors: tubeColors(),
          connectors: allConnectors(),
          accessories: accessories(),
        })
        const scene = new SceneManager(host)
        scene.setMotion(MOTION)
        scene.setTheme(false)
        // 默认开草地。没存过偏好（null）算开，只有显式关过（'0'）才关——
        // 原来写的是 === '1'，等于新用户第一次打开是一片空白网格。
        // localStorage 读不到（隐私模式）也按开处理。
        try { scene.setScene(localStorage.getItem('quadro.scene.v1') !== '0') }
        catch { scene.setScene(true) }
        const savedTune = loadTune()
        applyFrameHex(savedTune.frame)
        scene.applyColorTune(savedTune)
        setEngineLang(lang)
        scene.setViewCubeLabels(cubeLabels())
        const model = new BuildModel()
        const builder = new Builder(scene, model, { onChange: () => {} })
        builder.onChange = () => {
          if (!switching.current) persistSessionRef.current()
          bumpRef.current()
        }
        builder.onPreview = () => bumpRef.current()
        builder.onHistoryChange = () => markDirtyRef.current()
        builder.onNotice = ((msg: string, kind?: string) => notifyRef.current(String(msg), kind === 'warn' ? 'warn' : 'ok')) as E
        scene.onMeshesReady = () => builder.refresh()
        eng.current = { scene, model, builder }
        // 开发模式下把引擎挂到 window 上，浏览器测试脚本靠它摆相机、查手柄
        if (import.meta.env.DEV) (window as unknown as { __quadroDev?: unknown }).__quadroDev = eng.current

        // 只看、交付、画房间：只放这一座，不读这台设备上记着的标签页。
        // 交付由 CollabProvider 取到以后 attachDoc 换进来。
        if (!SESSIONLESS) await docs.migrateOldDrafts()
        const session = SESSIONLESS ? null : await docs.loadSession()
        if (dead) return
        if (session?.tabs?.length) {
          const mapped: Tab[] = []
          for (const tb of session.tabs as AnyRec[]) {
            const tabId = String(tb.tabId)
            // 旧版本把造型 JSON 记在会话里：本机还没有这一页的文档时，拿它生成一份
            const legacy = tb.model ? normalizeModel(tb.model) : null
            const local = await openTabDoc(tabId, legacy)
            if (dead) return
            const restored: Tab = {
              tabId,
              docId: (tb.docId as string) || null,
              name: String(tb.name || t('tab.untitled')),
              dirty: !!tb.dirty,
              planId: (tb.planId as string) || null,
              view: (tb.view as AnyRec) || {},
              local,
              baseRev: typeof tb.baseRev === 'number' ? tb.baseRev : undefined,
              savedContent: typeof tb.savedContent === 'string' ? tb.savedContent : undefined,
              editGeneration: Number(tb.editGeneration || 0),
              saveId: tb.saveId,
              saveState: tb.saveState,
              conflictDocId: tb.conflictDocId,
            }
            mapped.push(restored.planId || restored.readOnly || SESSIONLESS ? restored
              : restorePersonalBinding(restored, readPersonalState(local)))
          }
          for (const tb of mapped) {
            if (!tb.planId && tb.savedContent && tb.savedContent !== modelContent(tb.local.history.toJSON())) {
              tb.dirty = true
              if (tb.saveState !== 'conflict') tb.saveState = 'unsaved'
            }
          }
          tabsRef.current = mapped
          for (const tb of [...mapped]) {
            await reconcileRef.current(tb)
            if (dead) return
          }
          const { keep, gone } = pruneSessionTabs(tabsRef.current)
          for (const tb of gone) await dropTabDoc(tb.tabId, tb.local)
          tabsRef.current = keep
          const wanted = session.activeTabId && tabsRef.current.some(x => x.tabId === session.activeTabId)
            ? session.activeTabId
            : tabsRef.current[0].tabId
          activeRef.current = wanted
          applyTabRef.current(tabsRef.current.find(x => x.tabId === wanted)!)
        } else {
          const tab = makeTab(EMPTY_MODEL, t('tab.untitled'), null)
          tabsRef.current = [tab]
          activeRef.current = tab.tabId
          applyTabRef.current(tab)
        }
        syncTabsRef.current()
        setReady(true)
        // 画布这时才露面，第一次载入的动画从这一刻开始放
        scene.releaseLoadGate()
        bumpRef.current()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => { dead = true }
  }, [])

  useEffect(() => {
    setEngineLang(lang)
    const e = eng.current
    if (e) {
      e.scene.setViewCubeLabels(cubeLabels())
      e.builder.refresh()
    }
    const untitled = t('tab.untitled')
    let changed = false
    for (const tb of tabsRef.current) {
      if (isUntitledName(tb.name) && tb.name !== untitled) {
        tb.name = untitled
        changed = true
      }
    }
    if (changed) syncTabsRef.current()
  }, [lang, t])

  const e = eng.current
  const builder = e?.builder
  const model = e?.model
  const scene = e?.scene

  const bom = useMemo(() => {
    if (!model || !ready) return null
    try { return asBom(computeBOM(model) as AnyRec) } catch { return null }
  }, [model, ready, tick, lang])

  const safety = useMemo<SafetyResult | null>(() => {
    if (!model || !ready) return null
    return computeSafety(model, {
      room: room.visible ? { w: room.w, d: room.d } : null,
      indoor: room.visible,
    }) as SafetyResult
  }, [model, ready, tick, room])

  const cmp = useMemo(() => {
    if (!model || !ready) return { rows: [] as InvRow[], feasible: null as boolean | null }
    try {
      const raw = compareInventory(computeBOM(model), inventory) as { rows: InvRow[]; feasible: boolean }
      return { rows: raw.rows, feasible: inventoryUsed(inventory) ? raw.feasible : null }
    } catch { return { rows: [], feasible: null } }
  }, [model, ready, tick, inventory, lang])

  const sizeCm = useMemo<[number, number, number] | null>(() => {
    if (!model || !ready) return null
    const b = model.bounds?.(2.5) as { size: number[] } | null
    if (!b) return null
    return [Math.round(b.size[0]), Math.round(b.size[2]), Math.round(b.size[1])]
  }, [model, ready, tick])

  bomRef.current = bom
  sizeRef.current = sizeCm
  // 没填库存时不导出拥有和还缺两列
  invRowsRef.current = cmp.feasible == null ? [] : cmp.rows
  langRef.current = lang

  const roomOverflow = useMemo(() => {
    const extra = { w: 0, d: 0, h: 0 }
    if (!room.visible || !sizeCm) return extra
    extra.w = Math.max(0, sizeCm[0] - room.w)
    extra.d = Math.max(0, sizeCm[1] - room.d)
    extra.h = Math.max(0, sizeCm[2] - room.h)
    return extra
  }, [room, sizeCm])

  const setRoom = useCallback((p: Partial<RoomSettings>) => {
    setRoomState(prev => {
      const next: RoomSettings = {
        w: p.w !== undefined ? clampRoomCm(p.w) : prev.w,
        d: p.d !== undefined ? clampRoomCm(p.d) : prev.d,
        h: p.h !== undefined ? clampRoomCm(p.h) : prev.h,
        visible: p.visible !== undefined ? p.visible : prev.visible,
        showExtents: p.showExtents !== undefined ? p.showExtents : prev.showExtents,
      }
      try { localStorage.setItem(ROOM_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  useEffect(() => {
    if (!scene || !ready) return
    const b = model?.bounds?.(2.5) ?? null
    scene.setRoomOverlay?.({
      visible: room.visible,
      showExtents: room.showExtents,
      w: room.w, d: room.d, h: room.h,
      bounds: b,
    })
  }, [scene, model, ready, tick, room])

  const clearBomHighlight = useCallback(() => {
    highlightKey.current = null
    builder?.setHighlight(null)
  }, [builder])

  const setMode = useCallback((mode: string) => {
    clearBomHighlight()
    builder?.setMode(mode)
    bump()
  }, [builder, bump, clearBomHighlight])
  const setColor = useCallback((id: string) => { track('builder.color.set', { id }); builder?.setColor(id); bump() }, [builder, bump])
  const setTube = useCallback((id: string) => {
    pickPart('tubes', id)
    clearBomHighlight()
    builder?.setTube(id)
    builder?.setMode('add')
    bump()
  }, [builder, bump, clearBomHighlight])
  const setPanel = useCallback((id: string) => {
    pickPart('panels', id)
    clearBomHighlight()
    builder?.setPanel(id)
    builder?.setMode('panel')
    bump()
  }, [builder, bump, clearBomHighlight])
  const setSlide = useCallback((kind: string) => {
    pickPart('slides', kind)
    clearBomHighlight()
    if (builder) builder.slideKind = kind
    builder?.setMode('slide')
    bump()
  }, [builder, bump, clearBomHighlight])
  const setFitting = useCallback((kind: string, partId?: string) => {
    pickPart('fittings', partId || kind)
    clearBomHighlight()
    builder?.setFitting(kind, partId)
    builder?.setMode('fitting')
    bump()
  }, [builder, bump, clearBomHighlight])
  const setClamp = useCallback((id: string) => {
    pickPart('clamps', id)
    clearBomHighlight()
    builder?.setClampPart(id)
    builder?.setMode('clamp')
    bump()
  }, [builder, bump, clearBomHighlight])
  const startPool = useCallback((id: string) => {
    pickPart('pools', id)
    clearBomHighlight()
    builder?.startPool?.(id)
    bump()
  }, [builder, bump, clearBomHighlight])
  const startC45 = useCallback(() => { pickPart('tubes', 'c45'); clearBomHighlight(); builder?.setMode('c45'); bump() }, [builder, bump, clearBomHighlight])
  const startReinforce = useCallback(() => { pickPart('reinforcements', 'reinforce'); clearBomHighlight(); builder?.setMode('reinforce'); bump() }, [builder, bump, clearBomHighlight])
  const placeConnector = useCallback((id: string) => { pickPart('connectors', id); clearBomHighlight(); builder?.placeConnector?.(id); bump() }, [builder, bump, clearBomHighlight])

  const highlight = useCallback((kind: string, id: string, color?: string | null) => {
    if (!builder || !model) return
    const key = `${kind}:${id}:${color || ''}`
    if (highlightKey.current === key) {
      builder.setHighlight(null)
      highlightKey.current = null
      bump()
      return
    }
    const ids = new Set<string>()
    const colorOk = (el: AnyRec) => !color || el.color === color
    if (kind === 'tubes') {
      for (const tb of model.tubes.values()) {
        if (!tb.arm && !tb.link && tb.tubeId === id && colorOk(tb)) ids.add(tb.id)
      }
    } else if (kind === 'panels') {
      for (const p of model.panels.values()) if (p.panelId === id && colorOk(p)) ids.add(p.id)
    } else if (kind === 'connectors') {
      for (const n of model.nodes.values()) {
        if (n.unused) continue
        for (const typ of connectorsForNode(model, n) as string[]) if (typ === id) { ids.add(n.id); break }
      }
    } else if (kind === 'slides') {
      for (const sl of model.slides.values()) if (sl.kind === id) ids.add(sl.id)
    } else if (kind === 'reinforcements') {
      for (const tb of model.tubes.values()) if (tb.reinforced) ids.add(tb.id)
    } else if (kind === 'textiles') {
      // 普通布面、短布面、彩虹带各是一行：按这块布认出来的零件比对
      for (const tx of model.textiles.values()) {
        const def = textilePart(model.textileSpan(tx), tx.variant)
        if (colorOk(tx) && (!id || (def && def.id) === id)) ids.add(tx.id)
      }
    } else {
      for (const f of model.fittings.values()) {
        if (f.kind === id || partIdOf(f) === id) ids.add(f.id)
      }
    }
    builder.setHighlight(ids.size ? ids : null)
    highlightKey.current = ids.size ? key : null
    bump()
  }, [builder, model, bump])

  const highlightIds = useCallback((key: string, list: string[]) => {
    if (!builder) return
    const k = `safety:${key}`
    if (highlightKey.current === k || !list.length) {
      builder.setHighlight(null)
      highlightKey.current = null
      bump()
      return
    }
    builder.setHighlight(new Set(list))
    highlightKey.current = k
    bump()
  }, [builder, bump])

  const setInv = useCallback((group: keyof Inventory, key: string, value: number) => {
    setInventory(prev => {
      const next = { ...prev, [group]: { ...prev[group] } }
      if (value > 0) next[group][key] = value
      else delete next[group][key]
      storage.saveInventory(next)
      return next
    })
  }, [])

  const newTab = useCallback(() => {
    track('builder.design.new')
    snapshotActive()
    const e2 = eng.current
    if (!e2) return
    const tab = makeTab(EMPTY_MODEL, t('tab.untitled'), null)
    const next = appendTab(tabsRef.current, tab)
    tabsRef.current = next.tabs
    activeRef.current = next.active
    applyTab(tab)
    syncTabs()
  }, [applyTab, snapshotActive, syncTabs, t])

  const activateTab = useCallback((tabId: string) => {
    if (tabId === activeRef.current) return
    snapshotActive()
    const tab = tabsRef.current.find(x => x.tabId === tabId)
    if (!tab) return
    activeRef.current = tabId
    applyTab(tab)
    syncTabs()
    void reconcilePersonal(tab).then(syncTabs).catch(error => {
      console.warn('[personal tabs]', error)
      notify(t('sync.failed'), 'warn')
    })
  }, [applyTab, notify, reconcilePersonal, snapshotActive, syncTabs, t])

  const attachDoc = useCallback((o: { local: LocalDoc; name: string; readOnly: boolean }) => {
    const old = tabsRef.current
    const tab: Tab = { tabId: docs.newTabId(), docId: null, name: o.name, dirty: false, planId: null, view: {}, local: o.local, readOnly: o.readOnly }
    tabsRef.current = [tab]
    activeRef.current = tab.tabId
    applyTab(tab)
    for (const tb of old) if (tb.local !== o.local) tb.local.history.destroy()
    syncTabs()
  }, [applyTab, syncTabs])

  /**
   * 要整座换掉的时候（导入文件、打开分享链接）用的标签页：当前页是自己的就用它，
   * 是共享方案就新开一页——换掉方案里的造型等于替所有人改了。
   */
  const ownActiveTab = useCallback((): Tab | null => {
    const active = tabsRef.current.find(x => x.tabId === activeRef.current)
    if (!active || !active.planId) return active || null
    snapshotActive()
    const tab = makeTab(EMPTY_MODEL, t('tab.untitled'), null)
    tabsRef.current = [...tabsRef.current, tab]
    activeRef.current = tab.tabId
    applyTab(tab)
    syncTabs()
    return tab
  }, [applyTab, snapshotActive, syncTabs, t])

  /** 打开共享方案：已经有这个方案的标签页就切过去，没有就新开一个。 */
  const openPlanTab = useCallback((planId: string, name: string, preserveOriginal = false) => {
    const existing = tabsRef.current.find(x => x.planId === planId)
    if (existing) {
      if (name && existing.name !== name) existing.name = name
      if (existing.tabId !== activeRef.current) {
        snapshotActive()
        activeRef.current = existing.tabId
        applyTab(existing)
      }
      syncTabs()
      return existing.tabId
    }
    snapshotActive()
    const tab = makePlanTab(planId, name)
    // 刚打开的空白「未命名」页让给方案，不多留一个空标签
    const active = tabsRef.current.find(x => x.tabId === activeRef.current)
    const reuse = !preserveOriginal && active && !active.planId && !active.docId && !active.dirty && tabParts(active) === 0 && isUntitledName(active.name)
    tabsRef.current = reuse
      ? tabsRef.current.map(x => (x === active ? tab : x))
      : [...tabsRef.current, tab]
    if (reuse && active) void dropTabDoc(active.tabId, active.local)
    activeRef.current = tab.tabId
    applyTab(tab)
    syncTabs()
    return tab.tabId
  }, [applyTab, snapshotActive, syncTabs])

  /** 共享方案标签页的权限：能不能改、新建零件 id 的本端标记。 */
  const setTabAccess = useCallback((tabId: string, o: { readOnly: boolean; idTag: string }) => {
    const tab = tabsRef.current.find(x => x.tabId === tabId)
    if (!tab) return
    tab.readOnly = o.readOnly
    tab.idTag = o.idTag
    const e2 = eng.current
    if (!e2 || tabId !== activeRef.current) return
    e2.builder.setReadOnly(o.readOnly)
    e2.model.idTag = o.idTag
    e2.builder.refresh()
    bump()
  }, [bump])

  /** 标签页的文档（共享方案要连上服务器） */
  const tabLocal = useCallback((tabId: string) => tabsRef.current.find(x => x.tabId === tabId)?.local || null, [])
  const engine = useCallback(() => eng.current, [])

  const closeTab = useCallback((tabId: string) => {
    const closing = tabsRef.current.find(x => x.tabId === tabId)
    const rest = tabsRef.current.filter(x => x.tabId !== tabId)
    if (closing) void dropTabDoc(closing.tabId, closing.local)
    if (!rest.length) {
      const empty = makeTab(EMPTY_MODEL, t('tab.untitled'), null)
      tabsRef.current = [empty]
      activeRef.current = empty.tabId
      applyTab(empty)
      syncTabs()
      return
    }
    if (activeRef.current === tabId) {
      snapshotActive()
      activeRef.current = rest[rest.length - 1].tabId
      tabsRef.current = rest
      applyTab(rest[rest.length - 1])
    } else {
      tabsRef.current = rest
    }
    syncTabs()
  }, [applyTab, snapshotActive, syncTabs, t])

  const renameTab = useCallback((tabId: string, name: string) => {
    const tab = tabsRef.current.find(x => x.tabId === tabId)
    if (!tab) return
    tab.name = name.trim() || t('tab.untitled')
    tab.editGeneration = (tab.editGeneration || 0) + 1
    tab.dirty = true
    tab.saveState = 'unsaved'
    syncTabs()
  }, [syncTabs, t])

  /** 共享方案的标签页跟着方案的名字走：名字随文档同步，不算没保存。 */
  const setTabName = useCallback((tabId: string, name: string) => {
    const tab = tabsRef.current.find(x => x.tabId === tabId)
    if (!tab || tab.name === name) return
    tab.name = name
    syncTabs()
  }, [syncTabs])

  /** 弹出起名框，等用户填完：点确定得到填的字，取消得到 null。 */
  const askName = useCallback((title: string, ok: string, value: string) => {
    nameAskRef.current?.resolve(null)
    return new Promise<string | null>(resolve => {
      const ask = { title, ok, value, resolve }
      nameAskRef.current = ask
      setNameAsk(ask)
    })
  }, [])

  const answerName = useCallback((name: string | null) => {
    const ask = nameAskRef.current
    nameAskRef.current = null
    setNameAsk(null)
    ask?.resolve(name)
  }, [])

  const localSaveSequence = useRef(new Map<string, number>())
  function beginLocalSave(tab: Tab) {
    const sequence = (localSaveSequence.current.get(tab.tabId) || 0) + 1
    localSaveSequence.current.set(tab.tabId, sequence)
    const binding = { docId: tab.docId, saveId: tab.saveId }
    return () => tabsRef.current.includes(tab) && samePersonalBinding(tab, binding)
      && localSaveSequence.current.get(tab.tabId) === sequence
  }

  async function saveSnapshot(tab: Tab, options: Parameters<typeof docs.saveDoc>[0]) {
    try { return await docs.saveDoc(options) }
    catch (error) {
      console.warn('[save local]', error)
      if (tabsRef.current.includes(tab)) {
        tab.dirty = true
        tab.saveState = 'unsaved'
        syncTabs()
      }
      notify(t('sync.localFailed'), 'err')
      return null
    }
  }

  const saveCurrent = useCallback(async (name?: string) => {
    const e2 = eng.current
    const tab = tabsRef.current.find(x => x.tabId === activeRef.current)
    if (!e2 || !tab || tab.readOnly) return null
    if (tab.planId) {
      notify(t('collab.autoSynced'))
      return null
    }
    if (tab.docId && tab.saveId) {
      const binding = { docId: tab.docId, saveId: tab.saveId }
      const current = await docs.getDoc(tab.docId) as AnyRec | null
      if (!tabsRef.current.includes(tab)) return null
      if (samePersonalBinding(tab, binding) && current?.saveId === tab.saveId && !current.pendingRemote) tab.baseRev = Number(current.rev || 0)
    }
    if (e2.builder.busy()) {
      tab.saveState = 'waiting'
      syncTabs()
      notify(t('sync.waiting'), 'warn')
      return null
    }
    let saveName = name || tab.name
    if (!name && !tab.docId && isUntitledName(tab.name)) {
      const typed = await askName(t('saves.saveTitle'), t('saves.saveOk'), '')
      if (typed == null) return null
      saveName = typed.trim() || t('tab.untitled')
    }
    if (!tabsRef.current.includes(tab)) return null
    if (tab.tabId === activeRef.current && e2.builder.busy()) { notify(t('sync.waiting'), 'warn'); return null }
    const data = structuredClone(exportTab(tab))
    const generation = tab.editGeneration || 0
    const stillCurrent = beginLocalSave(tab)
    // 没有可靠基线时只能保存成新设计，不能借存档库最新 rev 覆盖原设计。
    const targetId = tab.baseRev === undefined && tab.docId ? null : tab.docId
    const baseline = personalSaveBaseline(tab)
    const saved = await saveSnapshot(tab, { docId: targetId, name: saveName, data, ...baseline,
      parentSaveId: targetId ? baseline.parentSaveId : undefined })
    if (!saved) return null
    tabSavedAs(tab.tabId, saved.id)
    const attached = stillCurrent()
    if (attached) {
      tab.docId = saved.id
      if ((tab.editGeneration || 0) === generation) tab.name = saved.name
      tab.baseRev = Number(saved.rev || 0)
      tab.savedContent = modelContent(data)
      tab.saveId = String(saved.saveId)
      tab.conflictDocId = targetId && String(saved.id) !== targetId ? targetId : undefined
      tab.dirty = !savedGenerationUnchanged(tab, generation, data, tab.local.history.toJSON())
      tab.saveState = syncStarted() ? 'syncing' : 'local'
      if (tab.dirty) tab.saveState = 'unsaved'
      if (tab.conflictDocId) tab.saveState = 'conflict'
    }
    syncTabs()
    track('builder.design.save', { ...modelShape(data), named: !!name })
    if (attached && tab.conflictDocId) notify(t('sync.conflictProtected'), 'warn')
    else notify(t(syncStarted() ? 'sync.syncing' : 'sync.local'))
    void pushSaved(String(saved.id), String(saved.name), data, String(saved.saveId), attached ? tab : undefined)
    void coverSaved(String(saved.id), data, saved.updatedAt, String(saved.saveId)).catch(error => {
      console.warn('[cover]', error)
      notify(t('sync.coverFailed'), 'warn')
    })
    return { docId: String(saved.id), name: String(saved.name), data }
    // coverSaved、pushSaved 每次渲染重建，只在回调里调用，不进依赖表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askName, exportTab, notify, syncTabs, t])

  /**
   * 使用独立场景给已保存快照生成封面；JSON 无需等待，晚到封面按 saveId 核对内容。
   */
  async function coverSaved(docId: string, data: ModelJSON, updatedAt: number, saveId: string) {
    if (!syncStarted()) return
    const cover = await renderModelCover(data)
    if (!cover && modelPartCount(data) > 0) throw new Error('saved cover unavailable')
    if (cover) {
      await docs.setDocCover(docId, cover, updatedAt, saveId)
      void syncNow()
    }
  }

  /**
   * 存下以后推上去；送到服务器以后发一个 quadro:design-saved 事件，
   * 托管页面接着做它的事（比如提示去发布），Builder 自己不管。
   */
  async function pushSaved(docId: string, name: string, data: ModelJSON, saveId: string, tab?: Tab) {
    if (!syncStarted()) return
    let result: Awaited<ReturnType<typeof syncSavedDoc>>
    try { result = await syncSavedDoc(docId, saveId) }
    catch (error) {
      console.warn('[save sync]', error)
      result = { status: 'pending', id: docId, saveId, error }
    }
    const binding = { docId, saveId }
    if (tab && tabsRef.current.includes(tab) && samePersonalBinding(tab, binding)) {
      if (result.status === 'synced') {
        tab.baseRev = result.rev
        if (!tab.dirty) tab.saveState = 'synced'
      } else if (result.status === 'conflict') {
        const read = await readPersonalBinding(tab, binding, () => tabsRef.current.includes(tab),
          () => docs.getDoc(result.copyId) as Promise<AnyRec | null>)
        if (!read) return
        const copy = read.value
        if (copy) {
          tab.docId = result.copyId
          if (!tab.dirty) tab.name = String(copy.name)
          tab.baseRev = Number(copy.rev || 0)
          tab.saveId = copy.saveId
        }
        tab.saveState = 'conflict'
        tab.conflictDocId = docId
        notify(t('sync.conflictProtected'), 'warn')
      } else {
        if (!tab.dirty) tab.saveState = 'failed'
        notify(t('sync.failed'), 'warn')
      }
      syncTabs()
    }
    if (result.status !== 'synced') return
    window.dispatchEvent(new CustomEvent('quadro:design-saved', {
      detail: { docId, name, parts: modelPartCount(data) },
    }))
  }

  /** 存档里没人用的名字：原名空着就用原名，否则在后面加「副本」，还重名就往后编号。 */
  const freeDocName = useCallback(async (name: string) => {
    const taken = new Set((await docs.listDocs()).map((d: AnyRec) => String(d.name).trim().toLowerCase()))
    const own = name.trim()
    if (!taken.has(own.toLowerCase())) return own
    const base = t('saves.copyName', { name: own })
    if (!taken.has(base.toLowerCase())) return base
    for (let i = 2; ; i++) {
      const next = `${base} ${i}`
      if (!taken.has(next.toLowerCase())) return next
    }
  }, [t])

  /** 当前这一座存成一份新的存档，标签页从此跟着新的那一份走，原来那份保持不动。 */
  const saveCurrentAs = useCallback(async () => {
    const e2 = eng.current
    const tab = tabsRef.current.find(x => x.tabId === activeRef.current)
    if (!e2 || !tab) return
    if (e2.builder.busy()) { notify(t('sync.waiting'), 'warn'); return }
    const suggested = isUntitledName(tab.name) ? '' : await freeDocName(tab.name)
    const typed = await askName(t('saves.saveAsTitle'), t('saves.saveOk'), suggested)
    if (typed == null) return
    if (!tabsRef.current.includes(tab)) return
    if (tab.tabId === activeRef.current && e2.builder.busy()) { notify(t('sync.waiting'), 'warn'); return }
    const data = structuredClone(exportTab(tab))
    const generation = tab.editGeneration || 0
    const stillCurrent = beginLocalSave(tab)
    const saved = await saveSnapshot(tab, { docId: null, name: typed.trim() || t('tab.untitled'), data })
    if (!saved) return
    tabSavedAs(tab.tabId, saved.id)
    // 共享方案另存一份到「我的设计」：标签页还是那个方案
    const attached = !tab.planId && stillCurrent()
    if (attached) {
      tab.docId = saved.id
      if ((tab.editGeneration || 0) === generation) tab.name = saved.name
      tab.baseRev = Number(saved.rev || 0)
      tab.savedContent = modelContent(data)
      tab.saveId = String(saved.saveId)
      tab.conflictDocId = undefined
      tab.dirty = !savedGenerationUnchanged(tab, generation, data, tab.local.history.toJSON())
      tab.saveState = syncStarted() ? 'syncing' : 'local'
      if (tab.dirty) tab.saveState = 'unsaved'
    }
    syncTabs()
    track('builder.design.saveAs', { ...modelShape(data) })
    notify(t(syncStarted() ? 'sync.syncing' : 'sync.local'))
    void pushSaved(String(saved.id), String(saved.name), data, String(saved.saveId), attached ? tab : undefined)
    void coverSaved(String(saved.id), data, saved.updatedAt, String(saved.saveId)).catch(error => {
      console.warn('[cover]', error)
      notify(t('sync.coverFailed'), 'warn')
    })
    // coverSaved、pushSaved 每次渲染重建，只在回调里调用，不进依赖表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askName, freeDocName, notify, syncTabs, t])

  const duplicateDoc = useCallback(async (docId: string) => {
    const doc = await docs.getDoc(docId) as AnyRec | null
    if (!doc) return
    const saved = await docs.saveDoc({ docId: null, name: await freeDocName(String(doc.name)), data: doc.data })
    track('builder.design.duplicate', { ...modelShape(doc.data) })
    notify(t('toast.duplicated', { name: saved.name }))
    void syncNow()
  }, [freeDocName, notify, t])

  /**
   * 把这一座送到服务器上，送到了才返回 true。
   *
   * 社区入口只接受指定 saveId 的模型回执；已同步模型的异步封面可继续等待。
   */
  const pushDoc = useCallback(async (docId: string) => {
    const doc = await docs.getDoc(docId) as AnyRec | null
    if (!doc) return false
    if (!doc.saveId) return Number(doc.rev) > 0 && !doc.dirty
    return (await syncSavedDoc(docId, String(doc.saveId))).status === 'synced'
  }, [])

  const retrySave = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find(x => x.tabId === tabId)
    if (!tab?.docId || !tab.saveId || tab.planId || tab.readOnly) return
    if (!syncStarted()) { notify(t('sync.local')); return }
    const binding = { docId: tab.docId, saveId: tab.saveId }
    const doc = await docs.getDoc(tab.docId) as AnyRec | null
    if (!doc?.data || !tabsRef.current.includes(tab) || !samePersonalBinding(tab, binding) || doc.saveId !== tab.saveId) return
    tab.saveState = 'syncing'
    syncTabs()
    await pushSaved(tab.docId, String(doc.name), doc.data as ModelJSON, tab.saveId, tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, syncTabs, t])

  const openDoc = useCallback(async (docId: string) => {
    await syncNow()
    if (syncStarted()) {
      try { await pullDoc(import.meta.env.VITE_SYNC_BASE as string, docId) }
      catch (error) {
        console.warn('[open design]', error)
        notify(t('sync.failed'), 'warn')
      }
    }
    const doc = await docs.getDoc(docId)
    if (!doc) return
    snapshotActive()
    const existing = tabsRef.current.find(x => x.docId === docId)
    if (existing) {
      await reconcilePersonal(existing, doc as AnyRec)
      let latest = tabsRef.current.find(x => x.docId === docId)
      if (!latest && tabsRef.current.includes(existing)) latest = existing
      if (!latest) return
      activeRef.current = latest.tabId
      applyTab(latest)
      syncTabs()
      return
    }
    const data = normalizeModel(doc.data)
    if (!data) { notify(t('lib.loadFailed'), 'err'); return }
    const tab = makeTab(data, String(doc.name), String(doc.id))
    const unconfirmed = personalRecordUnconfirmed(doc)
    if (!unconfirmed) Object.assign(tab, { baseRev: Number(doc.rev || 0), savedContent: modelContent(data), saveId: doc.saveId,
      saveState: savedRecordState(doc) })
    tabsRef.current = [...tabsRef.current, tab]
    if (unconfirmed) await reconcilePersonal(tab, doc as AnyRec)
    if (!tabsRef.current.includes(tab)) return
    activeRef.current = tab.tabId
    applyTab(tab)
    syncTabs()
  }, [applyTab, notify, reconcilePersonal, snapshotActive, syncTabs, t])

  const openLibraryId = useCallback(async (id: string) => {
    const official = parseOfficialId(id)
    let qdfText: string | null = null
    let name = t('tab.untitled')

    if (official) {
      const libId = officialLibId(official)
      const cached = await storage.libGet(libId) as { name?: string; qdf?: string | null } | null
      name = OFFICIAL_BY_ID.get(official)?.name || cached?.name || official
      if (cached?.qdf) qdfText = cached.qdf
      else {
        notify(t('lib.loading', { name }))
        try {
          qdfText = await fetchOfficialQdf(official)
          const built = designEntry(libId, `${official}.qdf`, qdfText) as { name?: string; qdf?: string } | null
          if (built) {
            built.name = name
            await storage.libPut([built])
          }
        } catch {
          notify(t('lib.fetchFailed', { id: official }), 'err')
          return
        }
      }
    } else {
      const entry = await storage.libGet(id) as { name?: string; qdf?: string | null } | null
      if (!entry?.qdf) {
        notify(t('lib.loadFailed'), 'err')
        return
      }
      qdfText = entry.qdf
      name = String(entry.name || t('tab.untitled'))
    }

    if (!qdfText) {
      notify(t('lib.loadFailed'), 'err')
      return
    }
    const data = parseDesign(qdfText)
    if (!data) {
      notify(t('lib.loadFailed'), 'err')
      return
    }
    const e2 = eng.current
    if (!e2) return
    snapshotActive()
    const active = tabsRef.current.find(x => x.tabId === activeRef.current)
    const json = normalizeModel(data)
    if (!json) {
      notify(t('lib.loadFailed'), 'err')
      return
    }
    // 共享方案的标签页不让给别的造型
    const reuse = !!active && !active.planId && !active.docId && !active.dirty && modelPartCount(e2.model.toJSON()) === 0
    if (reuse && active) {
      active.name = name
      active.dirty = false
      replaceTabModel(active, json)
      applyTab(active)
    } else {
      const tab = makeTab(json, name, null)
      tabsRef.current = [...tabsRef.current, tab]
      activeRef.current = tab.tabId
      applyTab(tab)
    }
    syncTabs()
    notify(t('lib.loaded', { name }))
  }, [applyTab, notify, snapshotActive, syncTabs, t])

  const importFile = useCallback(async (file: File) => {
    const e2 = eng.current
    if (!e2) return
    try {
      const text = await file.text()
      const trimmed = text.trim()
      const looksJson = trimmed.startsWith('{') || file.name.toLowerCase().endsWith('.json')
      let data: unknown
      if (looksJson) {
        data = JSON.parse(trimmed)
        if (data && typeof data === 'object' && 'design' in (data as AnyRec)) data = (data as AnyRec).design
      } else {
        data = parseQDF(text, {
          tubes: buildableTubes(),
          panels: panels(),
          connectorSize: geometry().connectorSize,
          mergeEps: 2,
        })
      }
      const json = normalizeModel(data)
      if (!json) throw new Error('data')
      const tab = ownActiveTab()
      if (!tab) return
      switching.current = true
      e2.builder.modelReplaced()
      replaceTabModel(tab, json)
      e2.scene.resetCamera(e2.model, { animate: true, swoop: true })
      switching.current = false
      {
        tab.dirty = true
        tab.name = file.name.replace(/\.(qdf|json)$/i, '') || tab.name
      }
      syncTabs()
      track('builder.design.import', { kind: looksJson ? 'json' : 'qdf', ok: true })
      notify(t('toast.imported', { name: file.name }))
      bump()
    } catch (err) {
      switching.current = false
      // 导入失败的比例说明格式支持得够不够。只记格式，不记文件名——
      // 文件名是用户起的，属于自由文本。
      track('builder.design.import', { kind: 'unknown', ok: false })
      notify(t('toast.importFailed', { err: err instanceof Error ? err.message : String(err) }), 'err')
    }
  }, [bump, notify, syncTabs, t])

  const exportQdf = useCallback(() => {
    const e2 = eng.current
    if (!e2) return
    if (needAccount('qdf')) return
    const out = buildQDF(e2.model, { camera: e2.scene.cameraForQdf?.() }) as { text?: string; warnings?: Array<{ code: string; partId: string; id: string }> } | string
    track('builder.export.qdf')
    download(`${activeName()}.qdf`, typeof out === 'string' ? out : (out.text || ''), 'text/plain')
    const warnings = typeof out === 'string' ? undefined : out.warnings
    const separator = lang === 'zh' ? '、' : ', '
    const omitted = [...new Set(warnings?.filter(w => w.code === 'omitted_accessory').map(w => nameLabel(w.partId)) || [])].join(separator)
    const simplified = [...new Set(warnings?.filter(w => w.code === 'simplified_component').map(w => nameLabel(w.partId)) || [])].join(separator)
    if (omitted && simplified) notify(t('accessory.qdf.both', { omitted, simplified }), 'warn')
    else if (omitted) notify(t('accessory.qdf.omitted', { parts: omitted }), 'warn')
    else if (simplified) notify(t('accessory.qdf.simplified', { parts: simplified }), 'warn')
    else if (!warnings && [...e2.model.fittings.values()].some((f: AnyRec) => ACCESSORY_IDS.has(f.kind))) notify(t('toast.exportedQdfNoAccessories'), 'warn')
    else notify(t(qdfWillMapColors(e2.model) ? 'toast.exportedQdfMapped' : 'toast.exported'))
    // needAccount 每次渲染重建，只在回调里调用，不进依赖表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, t])

  const exportJson = useCallback(() => {
    const e2 = eng.current
    if (!e2) return
    if (needAccount('json')) return
    track('builder.export.json')
    download(`${activeName()}.json`, JSON.stringify(e2.model.toJSON(), null, 2), 'application/json')
    notify(t('toast.exported'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, t])

  function activeName() {
    return tabsRef.current.find(x => x.tabId === activeRef.current)?.name || 'design'
  }

  const copy = useCallback(() => {
    const frag = builder?.copySelection?.()
    if (!frag) { notify(t('toast.copyEmpty'), 'warn'); return }
    clipboard.current = frag
    const n = ['tubes', 'panels', 'textiles', 'slides', 'fittings', 'clamps']
      .reduce((s, k) => s + ((((frag as AnyRec)[k] as unknown[] | undefined)?.length) ?? 0), 0)
    notify(t('toast.copied', { n }))
    bump()
  }, [builder, bump, notify, t])

  const paste = useCallback(() => {
    if (!clipboard.current) { notify(t('toast.pasteEmpty'), 'warn'); return }
    builder?.startPaste?.(clipboard.current)
    notify(t('toast.pasteHint'))
    bump()
  }, [builder, bump, notify, t])

  const selectAll = useCallback(() => {
    if (!builder) return
    if (builder.mode !== 'select') builder.setMode('select')
    const n = builder.selectAll?.() ?? 0
    if (!n) notify(t('toast.selectEmpty'), 'warn')
    bump()
  }, [builder, bump, notify, t])

  const selectConnected = useCallback(() => {
    if (!builder) return
    if (builder.mode !== 'select') builder.setMode('select')
    const n = builder.selectConnected?.() ?? 0
    if (!n) notify(t('toast.blockEmpty'), 'warn')
    bump()
  }, [builder, bump, notify, t])

  const placeModule = useCallback((key: string) => {
    const data = geometricPreset(key)
    const frag = data ? jsonToFragment(data) : null
    if (!frag) { notify(t('toast.presetFailed'), 'err'); return }
    // 单元里的板用当前选中色，管子保留四色轮换
    if (builder && frag.panels.length) {
      const panelColor = builder.colorFor('panel') as string
      frag.panels = frag.panels.map(p => ({ ...p, color: panelColor }))
    }
    clipboard.current = frag
    track('builder.model.module', { key })
    builder?.startPaste?.(frag)
    notify(t('toast.moduleHint'))
    bump()
  }, [builder, bump, notify, t])

  const cancelPaste = useCallback(() => {
    if (builder?.cancelPaste?.()) bump()
  }, [builder, bump])

  const setAssemblyOrder = useCallback((order: string) => {
    track('builder.assembly.order', { key: order })
    builder?.setAssemblyOrder?.(order)
    bump()
  }, [builder, bump])

  const exportInventory = useCallback(() => {
    track('builder.inventory.export')
    download('quadro-inventory.json', JSON.stringify({ format: 'quadro.inventory.v1', inventory }, null, 2), 'application/json')
    notify(t('toast.invExported'))
  }, [inventory, notify, t])

  const importInventory = useCallback(async (file: File) => {
    try {
      const next = parseInventory(JSON.parse(await file.text()))
      if (!next) { track('builder.inventory.import', { ok: false }); notify(t('toast.invInvalid'), 'err'); return }
      storage.saveInventory(next)
      setInventory(next)
      track('builder.inventory.import', { ok: true, rows: inventoryRows(next) })
      notify(t('toast.invImported'))
    } catch {
      track('builder.inventory.import', { ok: false })
      notify(t('toast.invInvalid'), 'err')
    }
  }, [notify, t])

  const applyModelJson = useCallback((data: unknown, opts?: { undoable?: boolean; frame?: boolean }) => {
    const e2 = eng.current
    if (!e2) return false
    const run = () => {
      e2.builder.modelReplaced()
      const res = e2.model.loadJSON(data)
      if (res && res.ok === false) throw new Error(String(res.reason || 'data'))
    }
    const tab = opts?.undoable ? tabsRef.current.find(x => x.tabId === activeRef.current) : ownActiveTab()
    if (!tab) return false
    loadingModel.current = true
    try {
      if (opts?.undoable) e2.builder.recordHistory(run)
      else {
        const json = normalizeModel(data)
        if (!json) return false
        e2.builder.modelReplaced()
        replaceTabModel(tab, json)
      }
    } catch {
      return false
    } finally {
      loadingModel.current = false
    }
    e2.builder.refresh()
    if (opts?.frame !== false) e2.scene.resetCamera(e2.model, { animate: true, swoop: true })
    tab.dirty = true
    syncTabs()
    bump()
    return true
  }, [bump, syncTabs])

  const loadPreset = useCallback((key: string) => {
    const e2 = eng.current
    if (!e2) return
    if (modelPartCount(e2.model.toJSON()) > 0 && !window.confirm(t('confirm.loadPreset'))) return
    let data: unknown = geometricPreset(key)
    if (key === 'pyramid') {
      data = parseQDF(pyramidQdf, {
        tubes: buildableTubes(),
        panels: panels(),
        connectorSize: geometry().connectorSize,
        mergeEps: 2,
      })
    }
    if (!data || !applyModelJson(data, { undoable: true })) {
      notify(t('toast.presetFailed'), 'err')
      return
    }
    track('builder.model.preset', { key })
    notify(t('toast.preset', { name: t(`preset.${key}`) }))
  }, [applyModelJson, notify, t])

  /**
   * 导出文件要先有账号：部署设了注册页、这个人又还没登录，就弹框问要不要去注册，
   * 返回 true 表示这次导出先停下。开源本地版不设注册页，永远放行。
   */
  function needAccount(kind: ResumeExport) {
    if (!import.meta.env.VITE_REGISTER_URL || syncStarted()) return false
    track('builder.export.gate', { kind })
    setAccountAsk({ kind, phase: 'register' })
    return true
  }

  /** 成品图：空背景、3/4 视角，和模型库封面同一条截图通路，截完复位。 */
  function coverShot(): Promise<string | null> {
    return inTurn(async () => {
      const e2 = eng.current
      if (!e2) return null
      // 选中的零件画成高亮色：截图前清掉重画（startThumbBatch 已经清了选择），截完把选择还回去
      const kept = new Map(e2.builder.selection)
      const keptNode = e2.builder.selectedNodeId
      startThumbBatch()
      try {
        e2.builder.refresh()
        await waitSceneReady(e2.scene)
        const url = await takeModelThumb(e2.scene, e2.model)
        return typeof url === 'string' && url.startsWith('data:image') ? url : null
      } finally {
        endThumbBatch()
        for (const [id, kind] of kept) e2.builder.selection.set(id, kind)
        e2.builder.selectedNodeId = keptNode
        e2.builder.refresh()
      }
    })
  }

  /**
   * 导出前把这一座存成方案页，拿到印在文件上的网址和二维码。部署没接方案页就是 null。
   * 存不上就抛错：印一个打不开的二维码没有意义，这次导出跟着停下。
   */
  async function makeStamp(kind: ExportKind, cover: string, preview?: ManualPreview): Promise<Stamp | null> {
    if (!sharePagesEnabled()) return null
    const e2 = eng.current
    const tab = tabsRef.current.find(x => x.tabId === activeRef.current)
    if (!e2 || !tab) throw new Error('no design')
    const stampModel = preview ? new BuildModel() : e2.model
    if (preview && !stampModel.loadJSON(preview.data).ok) throw new Error('invalid frozen design')
    const b = stampModel.bounds(geometry().connectorSize / 2) as { size: number[] }
    const url = await publishSharePage({
      key: preview ? `${preview.tabId || 'manual'}-manual` : tab.docId || tab.tabId,
      title: preview?.name || tab.name,
      model: stampModel.toJSON(),
      parts: partsOfModel(stampModel) as Record<string, Record<string, number>>,
      size: [Math.round(b.size[0]), Math.round(b.size[2]), Math.round(b.size[1])],
      steps: preview?.plan.steps.length ?? (computeBuildPlan(e2.model, e2.builder.assemblyOrder || 'y+') as { steps: unknown[] }).steps.length,
      cover,
      stats: statsOfModel(stampModel),
    })
    return stampFor(url, kind)
  }

  const exportPng = useCallback(async () => {
    const e2 = eng.current
    if (!e2) return
    if (needAccount('shareimg')) return
    const shot = e2.scene.snapshot?.() as string | null
    if (!shot) { notify(t('toast.pngFailed'), 'err'); return }
    let stamp: Stamp | null = null
    if (sharePagesEnabled()) {
      if (modelPartCount(e2.model.toJSON()) === 0) { notify(t('toast.manualEmpty'), 'warn'); return }
      const cover = await coverShot()
      if (!cover) { notify(t('toast.pngFailed'), 'err'); return }
      try {
        stamp = await makeStamp('shareimg', cover)
      } catch {
        notify(t('toast.stampFailed'), 'err')
        return
      }
    }
    const url = stamp ? await shareImageDataUrl(shot, activeName(), stamp, t) : shot
    track('builder.export.png', { stamp: !!stamp })
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeName()}.png`
    a.click()
    notify(t('toast.pngSaved'))
    // needAccount、coverShot、makeStamp 每次渲染重建，只在回调里调用，不进依赖表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, t])

  /** 料表导出用到的几样东西，回调里取当下的值。 */
  const bomExportInput = () => ({
    bom: bomRef.current as BomView,
    name: activeName(),
    sizeCm: sizeRef.current,
    invRows: invRowsRef.current,
    lang: langRef.current,
    t,
  })

  const exportBomCsv = useCallback(async () => {
    if (!bomRef.current) { notify(t('toast.manualEmpty'), 'warn'); return }
    if (needAccount('bom')) return
    let stamp: Stamp | null = null
    if (sharePagesEnabled()) {
      const cover = await coverShot()
      if (!cover) { notify(t('toast.pngFailed'), 'err'); return }
      try {
        stamp = await makeStamp('bom', cover)
      } catch {
        notify(t('toast.stampFailed'), 'err')
        return
      }
    }
    track('builder.export.bom.csv', { stamp: !!stamp })
    download(`${activeName()} ${t('bomx.file')}.csv`, bomToCsv({ ...bomExportInput(), stamp }), 'text/csv;charset=utf-8')
    notify(t('toast.exported'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, t])

  const exportBomPng = useCallback(async () => {
    const e2 = eng.current
    if (!e2 || !bomRef.current) { notify(t('toast.manualEmpty'), 'warn'); return }
    if (needAccount('bompng')) return
    // 抬头那张缩略图走模型库封面同一条截图通路（空背景，截完复位），
    // 方案页的封面也用它
    const cover = await coverShot()
    if (!cover) { notify(t('toast.pngFailed'), 'err'); return }
    let stamp: Stamp | null = null
    try {
      stamp = await makeStamp('bom', cover)
    } catch {
      notify(t('toast.stampFailed'), 'err')
      return
    }
    let data: string | null
    try {
      const thumb = await loadImage(cover)
      data = await bomToPngDataUrl({ ...bomExportInput(), stamp }, thumb)
    } catch (error) {
      console.error('BOM PNG export failed', error)
      notify(t('toast.bomPngFailed'), 'err')
      return
    }
    if (!data) { notify(t('toast.manualEmpty'), 'warn'); return }
    track('builder.export.bom.png', { stamp: !!stamp })
    const a = document.createElement('a')
    a.href = data
    a.download = `${activeName()} ${t('bomx.file')}.png`
    a.click()
    notify(t('toast.pngSaved'))
    // startThumbBatch / endThumbBatch 在下面定义，只在回调里调用，不进依赖表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, t])

  const cancelExportManual = useCallback(() => { if (exportingManualRef.current) return; setExportManualConfirm(false); putManualPreview(null) }, [])

  function makeManualPreview(data: ModelJSON, previous?: ManualPreview): ManualPreview {
    const frozen = new BuildModel()
    if (!frozen.loadJSON(data).ok) throw new Error('invalid assembly snapshot')
    const order = previous?.order || eng.current?.builder.assemblyOrder || 'y+'
    const plan = computeAssemblyPlan(frozen, frozen.assemblyConfig || {}, order)
    const config: AssemblyConfig = frozen.assemblyConfig || {
      version: 1,
      regions: plan.regions.map((r: E) => ({ id: r.id, name: r.name, partIds: [...r.partIds] })),
      order: plan.regions.map((r: E) => r.id),
    }
    return { data: { ...frozen.toJSON(), assemblyConfig: structuredClone(config) } as ModelJSON, plan, config, order, source: previous?.source || JSON.stringify(data), tabId: previous?.tabId ?? activeRef.current, name: previous?.name || activeName(), repair: previous?.repair || null }
  }

  function updateManualConfig(config: AssemblyConfig) {
    const prev = manualPreviewRef.current
    if (!prev || !validAssemblyConfig(config)) return
    putManualPreview(makeManualPreview({ ...prev.data, assemblyConfig: structuredClone(config) }, prev))
  }
  function updateManualOrder(order: string) {
    const prev = manualPreviewRef.current
    if (!prev || !BUILD_ORDERS.includes(order)) return
    putManualPreview(makeManualPreview(prev.data, { ...prev, order }))
  }
  function saveManualConfig() {
    const prev = manualPreviewRef.current
    const e2 = eng.current
    if (!prev || !e2 || e2.builder.readOnly || prev.tabId !== activeRef.current || JSON.stringify(e2.model.toJSON()) !== prev.source || prev.repair) return false
    e2.builder.recordHistory(() => { e2.model.assemblyConfig = structuredClone(prev.config) })
    e2.builder.refresh()
    putManualPreview({ ...prev, source: JSON.stringify(e2.model.toJSON()) })
    bump()
    return true
  }
  function reviewManualRepairs(nodeIds: string[]) {
    const prev = manualPreviewRef.current
    if (!prev) return
    const frozen = new BuildModel()
    if (!frozen.loadJSON(prev.data).ok) throw new Error('invalid assembly snapshot')
    const result = proposeAssemblyRepairs(frozen, nodeIds)
    if (!result.changes.length) { notify(assemblyStrings[lang].noRepair, 'warn'); return }
    const withRepair = { ...prev, repair: { ...result, before: prev.data } }
    putManualPreview(result.data ? makeManualPreview(result.data as ModelJSON, withRepair) : withRepair)
  }
  function discardManualRepairs() {
    const prev = manualPreviewRef.current
    if (prev?.repair) putManualPreview(makeManualPreview(prev.repair.before, { ...prev, repair: null }))
  }
  function applyManualRepairs() {
    const prev = manualPreviewRef.current
    const e2 = eng.current
    if (!prev?.repair?.canApply || !e2 || e2.builder.readOnly || prev.tabId !== activeRef.current || JSON.stringify(e2.model.toJSON()) !== prev.source) return false
    e2.builder.recordHistory(() => {
      if (!e2.model.loadJSON(prev.data).ok) throw new Error('invalid assembly repair')
    })
    e2.builder.refresh()
    putManualPreview({ ...prev, source: JSON.stringify(e2.model.toJSON()), repair: null })
    bump()
    return true
  }

  const exportAssemblyPdf = useCallback(async () => {
    const e2 = eng.current
    if (!e2 || exportingManualRef.current) return
    if (modelPartCount(e2.model.toJSON()) === 0) {
      notify(t('toast.manualEmpty'), 'warn')
      return
    }
    if (needAccount('manual')) return
    putManualPreview(makeManualPreview(structuredClone(e2.model.toJSON()) as ModelJSON))
    track('builder.export.manual.ask', { parts: modelPartCount(e2.model.toJSON()) })
    setExportManualConfirm(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, t])

  const confirmExportManual = useCallback(async (previewCover?: string | null) => {
    const e2 = eng.current
    const preview = manualPreviewRef.current
    if (!e2 || !preview || !preview.plan.canExport || exportingManualRef.current) return
    if (needAccount('manual')) return
    const frozen = new BuildModel()
    if (!frozen.loadJSON(preview.data).ok) throw new Error('invalid assembly snapshot')
    track('builder.export.manual.go')
    exportingManualRef.current = true
    setExportingManual({ page: 0, total: 1 })
    let stamp: Stamp | null = null
    if (sharePagesEnabled()) {
      const cover = previewCover
      try {
        if (!cover) throw new Error('cover')
        stamp = await makeStamp('manual', cover, preview)
      } catch (err) {
        console.error('Assembly manual share page failed', err)
        exportingManualRef.current = false
        setExportingManual(null)
        notify(t('toast.stampFailed'), 'err')
        return
      }
    }
    const locale = lang === 'zh' ? 'zh-CN' : lang === 'de' ? 'de-DE' : 'en-US'
    const b = frozen.bounds?.(2.5) as { size: number[] } | null
    const sizeLine = b
      ? t('manual.size', { w: Math.round(b.size[0]), d: Math.round(b.size[2]), h: Math.round(b.size[1]) })
      : ''
    const fileBase = (preview.name || 'design').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'design'
    try {
      const bomNow = asBom(computeBOM(frozen) as AnyRec)
      await runAssemblyPdf({
        model: frozen,
        modelJSON: preview.data,
        plan: preview.plan,
        assemblyConfig: preview.config,
        order: preview.order,
        name: preview.name,
        bom: bomNow,
        filename: `${fileBase}-${t('manual.fileSuffix')}.pdf`,
        onProgress: (p: { page: number; total: number }) => setExportingManual(p),
        stamp: stamp && { ...stamp, hint: t('stamp.hint') },
        copy: {
          ...assemblyPdfStrings[lang],
          product: t('app.title'),
          coverTitle: t('manual.coverTitle'),
          date: new Date().toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }),
          stepsLine: t('manual.stepsLine'),
          sizeLine,
          hint: t('manual.hint'),
          front: t('manual.front'),
          back: t('manual.back'),
          bomTitle: t('manual.bomTitle'),
          thisStep: t('manual.thisStep'),
          none: t('manual.none'),
          kindFrame: t('manual.kindFrame'),
          kindRisers: t('manual.kindRisers'),
          kindPanels: t('manual.kindPanels'),
          stepHeading: t('manual.stepHeading'),
          gTubes: t('bom.tubes'),
          gConnectors: t('bom.connectors'),
          gPanels: t('bom.panels'),
          gTextiles: t('bom.textiles'),
          gSlides: t('bom.slides'),
          gWheels: t('bom.wheels'),
          gFittings: t('bom.fittings'),
          gReinforcements: t('bom.reinforcements'),
          gScrews: t('bom.screws'),
        },
      })
      track('builder.export.manual.done')
      notify(t('toast.manualSaved'))
    } catch (err) {
      console.error('Assembly manual export failed', err)
      if ((err as { code?: string })?.code === 'empty') notify(t('toast.manualEmpty'), 'warn')
      else notify(t('toast.manualFailed'), 'err')
    } finally {
      exportingManualRef.current = false
      setExportingManual(null)
      bump()
    }
    // coverShot、makeStamp 每次渲染重建，只在回调里调用，不进依赖表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump, lang, notify, snapshotActive, t])

  const shareCurrent = useCallback(async () => {
    const e2 = eng.current
    if (!e2) return
    // 托管版：存成方案页，复制它的短地址。没登录和导出文件一样先去注册
    if (sharePagesEnabled()) {
      if (needAccount('link')) return
      if (modelPartCount(e2.model.toJSON()) === 0) { notify(t('toast.linkEmpty'), 'warn'); return }
      // 剪贴板要在这一次点击里就开始写（Safari 过了这一下就不让写），地址还在路上，
      // 先交给它一个会兑现的 Promise
      const link = (async () => {
        const cover = await coverShot()
        if (!cover) throw new Error('cover shot failed')
        const stamp = await makeStamp('link', cover)
        if (!stamp) throw new Error('share pages disabled')
        return stamp.url
      })()
      const wrote = navigator.clipboard.write([new ClipboardItem({
        'text/plain': link.then(u => new Blob([u], { type: 'text/plain' })),
      })])
      // 方案页没存上和剪贴板不让写是两回事，分开说。方案页没存上时浏览器那头的写入
      // 可能一直不结束，所以先等地址，不等剪贴板
      let url: string
      try {
        url = await link
      } catch {
        notify(t('toast.linkFailed'), 'err')
        // 已经说过没存上；剪贴板那头随后被拒是同一件事，不再另报
        void wrote.then(() => undefined, () => undefined)
        return
      }
      try {
        await wrote
      } catch {
        notify(t('toast.shareFailed'), 'err')
        return
      }
      track('builder.design.share', { short: true })
      notify(t('toast.linkCopied'))
      // 托管页面接这一声（例如提示去发布），Builder 自己不管后面的事
      window.dispatchEvent(new CustomEvent('quadro:share-link', { detail: { url } }))
      return
    }
    try {
      const url = await shareUrl(e2.model.toJSON())
      if (!url) { notify(t('toast.shareTooBig'), 'warn'); return }
      await navigator.clipboard.writeText(url)
      track('builder.design.share')
      notify(t('toast.shareCopied'))
    } catch {
      notify(t('toast.shareFailed'), 'err')
    }
    // needAccount、coverShot、makeStamp 每次渲染重建，只在回调里调用，不进依赖表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, t])

  /**
   * 「复制到我的账号」：当前这一座存成一份新的存档。登录了就跟着同步进账号；
   * 还没登录的只存在这台设备上，登录以后同步会把它带上去。
   */
  const copyToAccount = useCallback(async () => {
    const e2 = eng.current
    const tab = tabsRef.current.find(x => x.tabId === activeRef.current)
    if (!e2 || !tab) return
    if (e2.builder.busy()) { notify(t('sync.waiting'), 'warn'); return }
    const data = exportTab(tab)
    const generation = tab.editGeneration || 0
    const stillCurrent = beginLocalSave(tab)
    const saved = await saveSnapshot(tab, { docId: null, name: await freeDocName(tab.name), data })
    if (!saved) return
    tabSavedAs(tab.tabId, saved.id)
    const attached = stillCurrent()
    if (attached) {
      tab.docId = saved.id
      if ((tab.editGeneration || 0) === generation) tab.name = saved.name
      tab.baseRev = Number(saved.rev || 0)
      tab.savedContent = modelContent(data)
      tab.saveId = String(saved.saveId)
      tab.dirty = !savedGenerationUnchanged(tab, generation, data, tab.local.history.toJSON())
      tab.saveState = syncStarted() ? 'syncing' : 'local'
      if (tab.dirty) tab.saveState = 'unsaved'
    }
    syncTabs()
    track('builder.design.copy', { ...modelShape(data) })
    await pushSaved(String(saved.id), String(saved.name), data, String(saved.saveId), attached ? tab : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportTab, freeDocName, notify, syncTabs, t])

  // 地址上带着一座进来的：#s= 分享链接，或者 ?src= 造型文件（方案页、帖子、官方造型页）。
  // 打开它；带了 &copy=1 的再存一份到自己的存档里。
  const entryOpened = useRef(false)
  useEffect(() => {
    if (!ready || entryOpened.current) return
    const ent = bootEntry()
    if (ent.version) { entryOpened.current = true; setEntryReady(true); return }
    const payload = peekSharePayload()
    if (!payload && !ent.src) { if (!ent.doc) setEntryReady(true); return }
    entryOpened.current = true
    void (async () => {
      let data: unknown = null
      if (payload) {
        data = await decodeShare(payload)
        clearSharePayload()
      } else {
        const res = await fetch(ent.src as string, { credentials: 'include' })
        if (!res.ok) { notify(t('toast.srcFailed'), 'err'); return }
        try { data = designFromText(await res.text()) } catch { data = null }
      }
      if (!data) { notify(t('toast.shareInvalid'), 'err'); return }
      const e2 = eng.current
      if (!e2) return
      if (modelPartCount(e2.model.toJSON()) > 0) newTab()
      // 当前是共享方案的标签页时 applyModelJson 自己会新开一个
      if (!applyModelJson(data, { undoable: false })) { notify(t('toast.shareInvalid'), 'err'); return }
      const tab = tabsRef.current.find(x => x.tabId === activeRef.current)
      if (tab && ent.name) {
        tab.name = ent.name
        syncTabs()
      }
      if (tab && ent.origin) tabOpenedFrom(tab.tabId, ent.origin)
      track('builder.design.open', { from: payload ? 'share' : 'src', view: VIEW_ONLY, copy: ent.copy })
      if (ent.copy && !VIEW_ONLY) await copyToAccount()
      setEntryReady(true)
    })().catch(err => notify(err instanceof Error ? err.message : String(err), 'err'))
  }, [ready, applyModelJson, copyToAccount, newTab, notify, syncTabs, t])

  // 注册完从注册页回来（?export=）：确认登录上了，问一句要不要接着导出。
  // 下载要由一次点击触发，浏览器才不会拦，所以不直接开始。
  const resumed = useRef(false)
  useEffect(() => {
    if (!ready || resumed.current || VIEW_ONLY) return
    const kind = bootEntry().resume
    if (!kind) return
    resumed.current = true
    void syncProbe().then(ok => { if (ok) setAccountAsk({ kind, phase: 'resume' }) })
  }, [ready])

  const exporters = useRef<Record<ResumeExport, () => void>>({} as Record<ResumeExport, () => void>)
  exporters.current = {
    manual: () => { void exportAssemblyPdf() },
    bom: () => { void exportBomCsv() },
    bompng: () => { void exportBomPng() },
    shareimg: () => { void exportPng() },
    qdf: () => exportQdf(),
    json: () => exportJson(),
    link: () => { void shareCurrent() },
  }

  const answerAccount = useCallback((go: boolean) => {
    const ask = accountAsk
    setAccountAsk(null)
    if (!go || !ask) return
    if (ask.phase === 'resume') {
      exporters.current[ask.kind]()
      return
    }
    // 去注册之前把标签页记下，注册完回来还是这一座
    track('builder.export.register', { kind: ask.kind })
    const next = `${location.pathname}?export=${ask.kind}`
    void saveSessionNow().then(() => {
      location.href = `${import.meta.env.VITE_REGISTER_URL}?next=${encodeURIComponent(next)}`
    })
  }, [accountAsk, saveSessionNow])

  const setViewCubePad = useCallback((right: number, bottom: number, size?: number) => {
    eng.current?.scene?.setViewCubePad?.(right, bottom, size)
  }, [])
  const setViewCubeEnabled = useCallback((on: boolean) => {
    eng.current?.scene?.setViewCubeEnabled?.(on)
  }, [])

  const applyColorTune = useCallback((tune: { scene: Record<string, unknown>; frame: Record<string, string>; grade?: Record<string, number> }) => {
    applyFrameHex(tune.frame)
    const e = eng.current
    e?.scene?.applyColorTune?.(tune)
    e?.builder?.refresh?.()
    bump()
  }, [bump])

  const startThumbBatch = useCallback(() => {
    const e = eng.current
    if (!e || thumbBatch.current) return
    flushModel()
    switching.current = true
    e.builder.held = true
    thumbBatch.current = {
      json: e.model.toJSON(),
      camera: e.scene.cameraState(),
      sceneOn: !!e.scene._sceneOn,
      mode: String(e.builder.mode || 'select'),
    }
    e.builder.cancelPaste?.()
    e.builder.setMode('select')
    e.builder.modelReplaced()
    e.scene.setScene(false)
  }, [flushModel])

  const endThumbBatch = useCallback(() => {
    const e = eng.current
    const prev = thumbBatch.current
    thumbBatch.current = null
    if (e && prev) {
      e.builder.held = false
      e.builder._externalPending = false
      e.builder.modelReplaced()
      // 截图期间文档可能被别人改过：按文档现在的样子放回去
      const tab = tabsRef.current.find(x => x.tabId === activeRef.current)
      e.model.loadJSON(tab ? tab.local.history.toJSON() : prev.json)
      e.builder.setMode(prev.mode || 'select')
      e.scene.setScene(prev.sceneOn)
      if (prev.camera) e.scene.restoreCameraState(prev.camera)
      e.builder.refresh()
    }
    switching.current = false
    bump()
  }, [bump])

  const captureThumb = useCallback((job: ThumbJob) => inTurn(async () => {
    const e = eng.current
    if (!e) return null
    let data: unknown = null
    try {
      if (job.kind === 'model') {
        data = job.data
      } else if (job.kind === 'official') {
        const text = await fetchOfficialQdf(job.id)
        data = parseDesign(text)
      } else if (job.id === 'pyramid') {
        data = parseQDF(pyramidQdf, {
          tubes: buildableTubes(),
          panels: panels(),
          connectorSize: geometry().connectorSize,
          mergeEps: 2,
        })
      } else {
        data = geometricPreset(job.id)
      }
    } catch {
      return null
    }
    if (!data) return null
    const batched = !!thumbBatch.current
    if (!batched) startThumbBatch()
    try {
      e.builder.modelReplaced()
      const res = e.model.loadJSON(data)
      if (res && res.ok === false) return null
      if (!e.model.nodes?.size) return null
      e.builder.refresh()
      const meshesOk = await waitSceneReady(e.scene)
      if (!meshesOk) return null
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const url = await takeModelThumb(e.scene, e.model)
      return typeof url === 'string' && url.startsWith('data:image') ? url : null
    } catch {
      return null
    } finally {
      if (!batched) endThumbBatch()
    }
    // inTurn 只碰 ref，不进依赖表
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [endThumbBatch, startThumbBatch])

  const value: EngineApi = {
    ready, entryReady, completeEntry, error, hostRef, tick,
    mode: (builder?.mode as string) || 'select',
    color: (builder?.color as string) || 'random',
    recolorAll: (colors) => { track('builder.color.all', { n: colors.length }); builder?.recolorAll?.(colors); bump() },
    tubeId: (builder?.tubeId as string) || 'T35',
    panelId: (builder?.panelId as string) || '',
    slideKind: (builder?.slideKind as string) || 'slide-new2',
    fittingKind: (builder?.fittingKind as string) || 'multi-wheel2',
    fittingPart: (builder?.fittingPart as string) || null,
    poolLinerId: (builder?.poolLinerId as string) || null,
    clampPart: (builder?.clampPart as string) || 'double_tube',
    canUndo: !!builder?.canUndo?.(),
    canRedo: !!builder?.canRedo?.(),
    selectionCount: builder?.selection?.size ?? 0,
    installationPreview: builder?.installationPreview ?? null,
    insetScrewAxis: builder?.insetScrewAxis || 'vertical',
    setInsetScrewAxis: axis => { if (!builder || builder.readOnly) return; builder.setInsetScrewAxis(axis); bump() },
    canFlipAccessory: !builder?.readOnly && !!builder?.canFlipSelectedAccessory?.(),
    confirmInstallation: () => { if (!builder || builder.readOnly) return; builder.confirmInstallation(); bump() },
    cancelInstallation: () => { if (!builder) return; builder.cancelInstallation(); bump() },
    flipAccessory: () => {
      if (!builder || builder.readOnly) return
      if (builder?.installationPreview?.canFlip) builder.flipInstallationFacing()
      else builder.flipSelectedAccessory()
      bump()
    },
    toast,
    tabs, activeTabId, bom, inventory,
    invRows: cmp.rows, feasible: cmp.feasible, sizeCm, room, setRoom, roomOverflow,
    loadPreset, placeModule, exportPng, exportBomCsv, exportBomPng, exportAssemblyPdf, confirmExportManual, cancelExportManual, exportManualConfirm, exportingManual, shareCurrent,
    manualPreview, updateManualConfig, updateManualOrder, saveManualConfig, reviewManualRepairs, applyManualRepairs, discardManualRepairs,
    accountAsk, answerAccount,
    assembly: {
      step: builder?.assemblyStep ?? 0,
      max: Math.max(0, (builder?.buildPlan?.steps?.length ?? 1) - 1),
      active: builder?.mode === 'assembly',
      order: (builder?.assemblyOrder as string) || 'y+',
    },
    assemblyOrders: BUILD_ORDERS,
    setAssemblyOrder, exportInventory, importInventory,
    canPaste: !!clipboard.current,
    pasting: !!builder?.pasting,
    pasteHeightCm: builder?.pasteHeightCm ?? null,
    side, setSide, notify,
    dismissToast: () => setToast(null),
    placingConnector: (builder?.placeConnectorId as string) || null,
    bump, setMode, setColor, setTube, setPanel, setSlide, setFitting, setClamp, startPool, startC45, startReinforce, placeConnector,
    buildStep: (dir) => { bumpCount('builder.edit.step'); builder?.buildStep?.(dir); bump() },
    moveSelection: (dir) => { bumpCount('builder.edit.move'); builder?.moveSelectionBy?.(dir); bump() },
    cameraAxes: () => ({
      axes: scene?.getHorizontalAxes?.() || { forward: [0, 0, -1], right: [1, 0, 0] },
      frontal: !!scene?.isFrontalView?.(),
    }),
    undo: () => { bumpCount('builder.edit.undo'); builder?.undo(); bump() },
    redo: () => { bumpCount('builder.edit.redo'); builder?.redo(); bump() },
    rotate: (dir) => { bumpCount('builder.edit.rotate'); builder?.rotateSelectionBy?.(dir); bump() },
    mirror: (dir) => {
      bumpCount('builder.edit.mirror')
      // 「左右」= 垂直于相机右方向的镜面；取右方向里占主导的世界轴
      const axes = scene?.getHorizontalAxes?.() || { forward: [0, 0, -1], right: [1, 0, 0] }
      const v = dir === 'lr' ? axes.right : axes.forward
      builder?.mirrorSelectionBy?.(Math.abs(v[0]) >= Math.abs(v[2]) ? 'x' : 'z')
      bump()
    },
    group: () => { bumpCount('builder.edit.group'); builder?.groupSelection?.(); bump() },
    ungroup: () => { bumpCount('builder.edit.ungroup'); builder?.ungroupSelection?.(); bump() },
    selectionGroups: builder?.groupsInSelection?.() ?? 0,
    deleteSel: () => { bumpCount('builder.edit.delete'); builder?.deleteSelection(); bump() },
    copy, paste, cancelPaste, selectAll, selectConnected,
    nudgePasteY: (steps) => { builder?.nudgePasteY?.(steps); bump() },
    setViewCubePad, setViewCubeEnabled,
    frame: () => { scene?.resetCamera?.(model, { animate: true }); bump() },
    toggleGrass: () => {
      const next = !scene?._sceneOn
      track('builder.scene.grass', { on: next })
      scene?.setScene?.(next)
      try { localStorage.setItem('quadro.scene.v1', next ? '1' : '0') } catch { /* ignore */ }
      bump()
    },
    grassOn: !!scene?._sceneOn,
    highlight, highlightIds, safety, setInv, newTab, closeTab, activateTab, renameTab, setTabName, saveCurrent, saveCurrentAs, askName, answerName, nameAsk, openDoc, retrySave,
    listDocs: async () => (await docs.listDocs()).map((d: AnyRec) => ({ id: String(d.id), name: String(d.name), updatedAt: Number(d.updatedAt || 0), local: !Number(d.rev) || !!d.dirty || (!!d.saveId && d.syncedSaveId !== d.saveId) })),
    removeDoc: async (id) => { await docs.removeDoc(id); bump() },
    renameDoc: async (id, name) => { await docs.renameDoc(id, name); bump() },
    duplicateDoc: async (id) => { await duplicateDoc(id); bump() },
    pushDoc,
    importFile, openLibraryId, exportQdf, exportJson,
    // 装配模式是"图纸能不能照着搭"的唯一信号：进去了、翻到第几步、
    // 中途退出还是翻到底，说明的事完全不同。
    setAssembly: (on) => {
      track(on ? 'builder.assembly.on' : 'builder.assembly.off', {
        steps: builder?.buildPlan?.steps?.length ?? 0,
        at: (builder?.assemblyStep as number) || 0,
      })
      setMode(on ? 'assembly' : 'select')
    },
    stepAssembly: (delta) => { bumpCount('builder.assembly.step'); builder?.setAssemblyStep?.((builder.assemblyStep || 0) + delta); bump() },
    engineLang: (l) => setEngineLang(l),
    catalog,
    applyColorTune,
    startThumbBatch, endThumbBatch, captureThumb,
    // 正在给模型库、批量导入截图时，画面上是别的造型，这一张不截
    coverShot: async () => (thumbBatch.current ? null : coverShot()),
    attachDoc, openPlanTab, setTabAccess, tabLocal,
    readOnly: !!builder?.readOnly,
    engine,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function partIdOf(f: AnyRec) {
  return String(f.partId || f.id || '')
}

export function useEngine() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEngine')
  return ctx
}

export { RANDOM_COLOR }

export function labelOf(id: string, fallback?: string) {
  return nameLabel(id, fallback)
}
