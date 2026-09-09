import {
  accessories, allConnectors, allTubes, panels, reinforcements, screws,
} from '../engine-api'
import type { Inventory } from '../store/EngineContext'

export type InvSection = 'tubes' | 'connectors' | 'panels' | 'slides' | 'wheels' | 'textiles' | 'fittings' | 'reinforcements' | 'screws'
export type InvGroup = keyof Inventory

export type InvCatalogItem = {
  section: InvSection
  group: InvGroup
  id: string
}

const TEXTIL = new Set(['textile', 'lattice', 'textile_round', 'bag', 'roof', 'roof_large'])
const WHEEL = new Set(['wheel', 'wheel_floating', 'hub_cap', 'caster', 'wheel_adapter', 'wheel_bearing', 'steering_lock'])
const SLIDE = new Set(['slide_integral', 'slide_module', 'slide_curved', 'slide_end'])
const SKIP_PANEL = new Set(['panel_70x120', 'pool_floor'])

type Cat = { id: string; stock?: boolean; buildable?: boolean; price?: number; qdf?: string }

function stockable(p: Cat) {
  if (p.stock === false) return false
  return true
}

function accSection(id: string): InvSection {
  if (SLIDE.has(id)) return 'slides'
  if (WHEEL.has(id)) return 'wheels'
  if (TEXTIL.has(id)) return 'textiles'
  return 'fittings'
}

/** 能买、能对账的目录件。官方文件里才出现、店里不单卖的（stock:false）默认不列出。 */
export function inventoryCatalog(): InvCatalogItem[] {
  const rows: InvCatalogItem[] = []
  const seen = new Set<string>()
  const add = (section: InvSection, group: InvGroup, id: string) => {
    const key = `${group}:${id}`
    if (!id || seen.has(key)) return
    seen.add(key)
    rows.push({ section, group, id })
  }

  for (const p of (allTubes() as Cat[])) {
    if (stockable(p) && (p.buildable || (p.price || 0) > 0)) add('tubes', 'tubes', p.id)
  }
  for (const p of (allConnectors() as Cat[])) {
    if (stockable(p)) add('connectors', 'connectors', p.id)
  }
  const connIds = new Set((allConnectors() as Cat[]).map(p => p.id))
  for (const p of (panels() as Cat[])) {
    if (!stockable(p) || SKIP_PANEL.has(p.id)) continue
    if (p.buildable || (p.price || 0) > 0) add('panels', 'panels', p.id)
  }
  for (const p of (accessories() as Cat[])) {
    if (!stockable(p) || connIds.has(p.id)) continue
    add(accSection(p.id), 'fittings', p.id)
  }
  for (const p of (reinforcements() as Cat[])) add('reinforcements', 'reinforcements', p.id)
  for (const p of (screws() as Cat[])) add('screws', 'screws', p.id)
  return rows
}

export const INV_SECTIONS: InvSection[] = [
  'tubes', 'connectors', 'panels', 'slides', 'wheels', 'textiles', 'fittings', 'reinforcements', 'screws',
]

export const INV_SECTION_TITLE: Record<InvSection, string> = {
  tubes: 'bom.tubes',
  connectors: 'bom.connectors',
  panels: 'bom.panels',
  slides: 'bom.slides',
  wheels: 'bom.wheels',
  textiles: 'bom.textiles',
  fittings: 'bom.fittings',
  reinforcements: 'bom.reinforcements',
  screws: 'bom.screws',
}
