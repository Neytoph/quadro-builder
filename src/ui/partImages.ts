import { PART_IMAGE_MANIFEST } from './partImageManifest'
import { publicResourceUrl } from '../engine/publicResources.js'

type PartImage = { src: string; srcLarge?: string }
const images: Readonly<Record<string, PartImage>> = PART_IMAGE_MANIFEST.parts
const aliases: Readonly<Record<string, string>> = PART_IMAGE_MANIFEST.aliases

export function resolvePartImage(idOrKey?: string | null): (PartImage & { id: string }) | null {
  const key = String(idOrKey || '')
  const candidates = [key, key.split('|')[0], ...key.split(':').slice(1), key.split('@')[0]]
  for (const candidate of candidates) {
    const id = aliases[candidate] || candidate
    if (images[id]) return { id, ...images[id] }
  }
  return null
}

export function partImageSrc(idOrKey?: string | null, large = true): string | null {
  const image = resolvePartImage(idOrKey)
  return image ? publicResourceUrl(large && image.srcLarge ? image.srcLarge : image.src) : null
}

// 兼容目录组件现有调用；所有图片定位使用上述公共映射。
const LEGACY_PART_IMAGES: ReadonlySet<string> = new Set([
  'acrylic_hole_panel_40x40',
  'acrylic_panel_40x20',
  'acrylic_panel_40x60',
  'acrylic_platform_40x40',
  'lattice_curved',
  'panel_40x20_castle',
  'panel_40x20_climbing',
  'panel_40x30_climbing',
  'panel_40x40_basketball',
  'panel_40x40_capsule',
  'panel_40x40_clock',
  'panel_40x40_grid',
  'panel_40x40_maze',
  'panel_sector_40',
  'rope',
  'textile_long',
  'textile_round_fourway',
  'trampoline',
  '3way',
  '4way',
  '5way',
  '6way',
  'T10',
  'T15',
  'T20',
  'T25',
  'T35',
  'T52',
  'T75',
  'TA35',
  'TA75',
  'TC1',
  'TS1',
  'TS2',
  'TS3',
  'TS4',
  'TS5',
  'TS6',
  'acrylic_panel_40x40',
  'bag',
  'balls',
  'bearing',
  'caster',
  'cross',
  'diagonal',
  'double_tube',
  'elbow',
  'flexi',
  'flexi_bolt',
  'flexi_hinge',
  'hole_1',
  'hole_2',
  'hole_panel_40x40',
  'hole_t',
  'hub_cap',
  'lattice',
  'panel_30x30',
  'panel_40x20',
  'panel_40x40',
  'panel_40x40_basin',
  'panel_40x40_busy',
  'panel_40x40_climbing',
  'panel_40x40_felt',
  'panel_40x40_honeycomb',
  'panel_40x40_lego',
  'panel_40x40_magnet',
  'panel_40x40_pocket',
  'panel_40x40_sensory',
  'panel_70x120',
  'panel_80x20',
  'panel_80x80',
  'pool_liner_l',
  'pool_liner_s',
  'pool_liner_xs',
  'pool_liner_xxl',
  'roof',
  'sleeve',
  'slide_curved',
  'slide_end',
  'slide_integral',
  'slide_module',
  'steering_lock',
  'steering_wheel',
  'straight',
  'swing',
  't',
  'textile',
  'textile_20x40',
  'textile_bridge',
  'textile_rainbow',
  'textile_round',
  'tube_cap',
  'tube_clamp',
  'wheel',
  'wheel_adapter',
  'wheel_bearing',
])
export const PART_IMAGES: ReadonlySet<string> = new Set([...LEGACY_PART_IMAGES, ...Object.keys(images)])
