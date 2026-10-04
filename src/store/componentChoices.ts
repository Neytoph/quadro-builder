import type { useEngine } from './EngineContext'
import type { CustomComponent, ComponentFragment } from './customComponents'
import { labelOf } from '../names'
import { ACC_CAT_ICON, CONN_CAT_ICON, TOOL_ICON, partIcon, tubeIcon } from '../ui/icons'
import { MODULE_GROUPS, presetThumbPath } from '../data/presets'
import { builderComponents } from './builderComponents'

type EngineApi = ReturnType<typeof useEngine>
type PartAction = { kind: 'panel' | 'tube' | 'slide' | 'clamp' | 'connector' | 'fitting' | 'pool' | 'c45' | 'module'; id: string; partId?: string }
export type ComponentChoice = {
  key: string
  label: string
  group: string
  partId?: string
  image?: string
  icon: string
  fragment?: ComponentFragment
  action?: PartAction
}

export const DEFAULT_COMPONENT_KEYS = [
  'panel:panel_40x40', 'panel:hole_panel_40x40', 'panel:panel_40x20',
  'connector:double_tube', 'slide:slide_integral', 'accessory:textile_rainbow',
]
const REGULAR_JOINT = new Set(['6way', '5way', '4way', '3way', 'cross', 't', 'straight', 'elbow'])
const SLIDE_KINDS = new Set(['slide-new2', 'slide2', 'curved-slide2', 'slide-end2'])
const WHEEL_KINDS = new Set(['multi-wheel2', 'floating-wheel2', 'casters2', 'steering-lock2', 'hub-cap2', 'bearing2', 'adapter2'])

export function componentChoices(api: EngineApi, saved: CustomComponent[], t: (key: string) => string): ComponentChoice[] {
  const choices: ComponentChoice[] = api.catalog.panels.map(p => ({
    key: `panel:${p.id}`, label: labelOf(p.id, p.name), group: t('tool.panels'), partId: p.id,
    icon: partIcon(p.id, 'panels'), action: { kind: 'panel', id: p.id },
  }))
  for (const part of api.catalog.connectors) {
    let action: PartAction | null = null
    if (REGULAR_JOINT.has(part.id)) action = { kind: 'connector', id: part.id }
    else if (part.id === 'diagonal') action = { kind: 'c45', id: part.id }
    else if (part.id === 'double_tube' || part.id === 'tube_clamp') action = { kind: 'clamp', id: part.id }
    else if (part.id === 'bearing') action = { kind: 'fitting', id: 'bearing-clamp' }
    else if (['hole_1', 'hole_2', 'hole_t', 'flexi_bolt', 'flexi_hinge', 'flexi'].includes(part.id)) action = { kind: 'fitting', id: part.id === 'flexi' ? 'flexi_bolt' : part.id }
    if (action) choices.push({ key: `connector:${part.id}`, label: labelOf(part.id, part.name), group: t('tool.connections'), partId: part.id, icon: CONN_CAT_ICON[part.id] || CONN_CAT_ICON['6way'], action })
  }
  for (const part of api.catalog.accessories) {
    if (part.id.startsWith('pool_liner') || part.id === 'balls') {
      choices.push({ key: `pool:${part.id}`, label: labelOf(part.id, part.name), group: t('tool.pools'), partId: part.id, icon: TOOL_ICON.pool, action: { kind: 'pool', id: part.id } })
    } else if (part.qdf && SLIDE_KINDS.has(part.qdf)) {
      choices.push({ key: `slide:${part.id}`, label: labelOf(part.id, part.name), group: t('tool.slides'), partId: part.id, icon: TOOL_ICON.slide, action: { kind: 'slide', id: part.qdf } })
    } else if (part.qdf || part.id === 'sleeve') {
      const kind = part.qdf || 'sleeve'
      choices.push({ key: `accessory:${part.id}`, label: labelOf(part.id, part.name), group: t(WHEEL_KINDS.has(kind) ? 'tool.wheels' : 'tool.textiles'), partId: part.id,
        icon: ACC_CAT_ICON[kind] || TOOL_ICON.textile, action: { kind: 'fitting', id: kind, partId: part.variant || part.rail || part.id === 'sleeve' || part.compat ? part.id : undefined } })
    }
  }
  for (const part of [...api.catalog.tubes, ...api.catalog.curved]) {
    const length = 'length_cm' in part && typeof part.length_cm === 'number' ? part.length_cm : undefined
    choices.push({ key: `tube:${part.id}`, label: labelOf(part.id, part.name), group: t('tool.tubes'), partId: part.id, icon: tubeIcon(part.id, length), action: { kind: 'tube', id: part.id } })
  }
  for (const part of builderComponents()) {
    const key = `${part.placement === 'panel' ? 'panel' : 'accessory'}:${part.id}`
    const choice: ComponentChoice = { key, label: labelOf(part.id, part.name), group: t(part.placement === 'panel' ? 'tool.panels' : 'tool.accessories'), partId: part.id,
      icon: partIcon(part.id, part.placement === 'panel' ? 'panels' : 'fittings'), action: part.placement === 'panel' ? { kind: 'panel', id: part.id } : { kind: 'fitting', id: part.kind || part.id, partId: part.id } }
    const existing = choices.findIndex(candidate => candidate.key === key)
    if (existing >= 0) choices[existing] = choice
    else choices.push(choice)
  }
  for (const group of MODULE_GROUPS) for (const part of group.items) choices.push({ key: `module:${part.key}`, label: t(part.labelKey), group: t('section.modules'), image: presetThumbPath(part.key), icon: CONN_CAT_ICON['6way'], action: { kind: 'module', id: part.key } })
  for (const part of saved) choices.push({ key: `saved:${part.id}`, label: part.name, group: t('tool.customSaved'), icon: TOOL_ICON.panel, fragment: part.fragment })
  return choices
}

export function activateComponent(choice: ComponentChoice, api: EngineApi): boolean {
  if (api.readOnly) return false
  if (choice.fragment) {
    if (!api.engine()?.builder.startPaste(structuredClone(choice.fragment))) return false
    api.bump()
    return true
  }
  const action = choice.action
  if (!action) throw new Error(`Component has no action: ${choice.key}`)
  switch (action.kind) {
    case 'panel': api.setPanel(action.id); break
    case 'tube': api.setTube(action.id); break
    case 'slide': api.setSlide(action.id); break
    case 'clamp': api.setClamp(action.id); break
    case 'connector': api.placeConnector(action.id); break
    case 'fitting': api.setFitting(action.id, action.partId); break
    case 'pool': api.startPool(action.id); break
    case 'c45': api.startC45(); break
    case 'module': api.placeModule(action.id); break
  }
  return true
}
