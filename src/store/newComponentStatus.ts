// XMF-BUILDER-ACCESSORIES-20261003本轮接入与新实现，独立于品牌来源。
// 基于20fa407原目录比对；同ID新实现指当前选件，不迁移旧模型记录。
export const NEW_COMPONENT_IDS = [
  'panel_sector_40',
  'acrylic_panel_40x20', 'acrylic_panel_40x60', 'acrylic_hole_panel_40x40',
  'panel_40x40_clock', 'panel_40x40_maze',
  'panel_40x30_climbing', 'panel_40x20_climbing',
  'lattice_curved', 'panel_40x40_basketball', 'trampoline',
  'textile_long', 'textile_round_fourway',
  'panel_40x40_capsule', 'acrylic_platform_40x40', 'panel_40x20_castle',
  'rope', 'panel_40x40_grid', 'steering_wheel', 'TA35', 'TA75',
] as const

export const UPDATED_COMPONENT_IDS = [
  'acrylic_panel_40x40',
  'panel_40x40_lego', 'panel_40x40_magnet', 'panel_40x40_honeycomb', 'panel_40x40_climbing',
  'lattice', 'textile_bridge', 'sleeve', 'textile', 'textile_round',
  'panel_40x40_basin', 'panel_40x40_sensory', 'panel_40x40_felt',
  'panel_40x40_busy', 'panel_40x40_pocket',
] as const

export const NEW_COMPONENT_STATUS: ReadonlySet<string> = new Set([...NEW_COMPONENT_IDS, ...UPDATED_COMPONENT_IDS])
export function isNewComponent(id: string): boolean { return NEW_COMPONENT_STATUS.has(id) }
