import { getLang } from './engine/i18n.js'
import type { Lang } from './i18n'

/** 目录显示名。德/英优先用 parts.json，缺项再用这一层。 */
export const PART_ZH: Record<string, string> = {
  '6way': '6通·空间',
  '5way': '5通',
  '4way': '4通',
  '3way': '三通角',
  cross: '十字·平面',
  t: 'T型三通',
  straight: '直通',
  elbow: '弯头',
  diagonal: '45°斜角',
  flexi: '柔性接头',
  flexi_hinge: '柔性铰链',
  flexi_bolt: '柔性栓',
  hole_t: 'T孔锁扣',
  hole_2: '双孔锁扣',
  hole_1: '单孔锁扣',
  bearing: '轴承座',
  double_tube: '双管连接',
  tube_clamp: '管夹',
  wheel: '多向轮',
  wheel_floating: '浮动轮',
  caster: '脚轮',
  steering_lock: '方向锁',
  hub_cap: '轮盖',
  wheel_bearing: '轮轴承',
  wheel_adapter: '脚轮适配',
  textile: '布面',
  textile_round: '圆弧布墙',
  roof_large: '大顶棚布',
  lattice: '网',
  bag: '玩具袋',
  slide_integral: '一体滑梯',
  slide_module: '经典滑梯',
  slide_curved: '弯滑梯',
  slide_end: '滑梯末端',
  pool_liner_xs: '泳池衬 XS',
  pool_liner_s: '泳池衬 S',
  pool_liner_l: '泳池衬 L',
  pool_liner_xxl: '泳池衬 XXL',
  tube_cap: '管帽',
  open_end: '开口套管',
  T10: '管 10 cm',
  T15: '管 15 cm',
  T20: '管 20 cm',
  T25: '管 25 cm',
  T35: '管 35 cm',
  T52: '管 52 cm',
  T75: '管 75 cm',
  TC1: '弯管',
  screw_tube: '管螺丝',
  screw_panel: '板螺丝',
}

export const PART_EN: Record<string, string> = {
  '6way': '6-way',
  '5way': '5-way',
  '4way': '4-way',
  '3way': '3-way corner',
  cross: 'Cross',
  t: 'T-joint',
  straight: 'Straight',
  elbow: 'Elbow',
  diagonal: '45°',
  flexi: 'Flexi',
  flexi_hinge: 'Flexi hinge',
  flexi_bolt: 'Flexi bolt',
  hole_t: 'T-hole clip',
  hole_2: 'Two-hole clip',
  hole_1: 'One-hole clip',
  bearing: 'Bearing',
  double_tube: 'Double-tube',
  tube_clamp: 'Tube clamp',
  wheel: 'Multi wheel',
  wheel_floating: 'Floating wheel',
  caster: 'Caster',
  steering_lock: 'Steering lock',
  hub_cap: 'Hub cap',
  wheel_bearing: 'Wheel bearing',
  wheel_adapter: 'Caster adapter',
  textile: 'Textile',
  textile_round: 'Curved textile',
  roof_large: 'Large roof cloth',
  lattice: 'Net',
  bag: 'Play bag',
  slide_integral: 'Integral slide',
  slide_module: 'Modular slide',
  slide_curved: 'Curved slide',
  slide_end: 'Slide run-out',
  pool_liner_xs: 'Pool liner XS',
  pool_liner_s: 'Pool liner S',
  pool_liner_l: 'Pool liner L',
  pool_liner_xxl: 'Pool liner XXL',
  tube_cap: 'Tube cap',
  open_end: 'Open sleeve',
  T10: 'Tube 10 cm',
  T15: 'Tube 15 cm',
  T20: 'Tube 20 cm',
  T25: 'Tube 25 cm',
  T35: 'Tube 35 cm',
  T52: 'Tube 52 cm',
  T75: 'Tube 75 cm',
  TC1: 'Curved tube',
  screw_tube: 'Tube screw',
  screw_panel: 'Panel screw',
}

export const PART_DE: Record<string, string> = {
  '6way': '6-Wege',
  '5way': '5-Wege',
  '4way': '4-Wege',
  '3way': '3-Wege',
  cross: 'Kreuz',
  t: 'T-Stück',
  straight: 'Gerade',
  elbow: 'Winkel',
  diagonal: '45°',
  flexi: 'Flexi',
  flexi_hinge: 'Flexi-Scharnier',
  flexi_bolt: 'Flexi-Bolzen',
  hole_t: 'T-Lochverbinder',
  hole_2: '2-Lochverbinder',
  hole_1: '1-Lochverbinder',
  bearing: 'Lager',
  double_tube: 'Doppelrohr',
  tube_clamp: 'Rohrklemme',
  wheel: 'Multirad',
  wheel_floating: 'Schwimmrad',
  caster: 'Lenkrolle',
  steering_lock: 'Lenkfeststeller',
  hub_cap: 'Radkappe',
  wheel_bearing: 'Radlager',
  wheel_adapter: 'Rollenadapter',
  textile: 'Textil',
  textile_round: 'Bogenwand',
  roof_large: 'Großes Dach',
  lattice: 'Netz',
  bag: 'Spielsack',
  slide_integral: 'Integralrutsche',
  slide_module: 'Modularrutsche',
  slide_curved: 'Bogenrutsche',
  slide_end: 'Rutschenauslauf',
  pool_liner_xs: 'Beckenfolie XS',
  pool_liner_s: 'Beckenfolie S',
  pool_liner_l: 'Beckenfolie L',
  pool_liner_xxl: 'Beckenfolie XXL',
  tube_cap: 'Rohrkappe',
  open_end: 'Offene Hülse',
  T10: 'Rohr 10 cm',
  T15: 'Rohr 15 cm',
  T20: 'Rohr 20 cm',
  T25: 'Rohr 25 cm',
  T35: 'Rohr 35 cm',
  T52: 'Rohr 52 cm',
  T75: 'Rohr 75 cm',
  TC1: 'Bogenrohr',
  screw_tube: 'Rohrschraube',
  screw_panel: 'Plattenschraube',
}

export const CONN_KIND_ZH: Record<string, string> = {
  space: '空间',
  planar: '平面',
  special: '特殊',
}

export const CONN_KIND_EN: Record<string, string> = {
  space: 'Space',
  planar: 'Planar',
  special: 'Special',
}

export const CONN_KIND_DE: Record<string, string> = {
  space: 'Raum',
  planar: 'Fläche',
  special: 'Spezial',
}

export const COLOR_ZH: Record<string, string> = {
  blue: '蓝',
  green: '绿',
  yellow: '黄',
  red: '红',
  petrol: '石油蓝',
  mint: '薄荷绿',
  berry: '莓粉',
  apricot: '杏黄',
}

export const COLOR_EN: Record<string, string> = {
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
  petrol: 'Petrol',
  mint: 'Mint',
  berry: 'Berry',
  apricot: 'Apricot',
}

export const COLOR_DE: Record<string, string> = {
  blue: 'Blau',
  green: 'Grün',
  yellow: 'Gelb',
  red: 'Rot',
  petrol: 'Petrol',
  mint: 'Mint',
  berry: 'Berry',
  apricot: 'Apricot',
}

/** 官方 50 维配件名（quadro_bom），顾问对照表用。 */
export const SKU_ZH = [
  '5向连接件', '4向连接件', '3向连接件', '十字连接件', 'T形连接件', 'L形连接件', '1形连接件', '斜角件',
  '10厘米管', '15厘米管', '20厘米管', '25厘米管', '35厘米管', '135度3洞35厘米管', '75厘米管', '弧形管',
  '大板', '半板', '洞洞板', '方形布', '多用轮', '多用轮垫圈', '多用轮固定件', '轮胎带', '顶棚',
  '双管8字连接件', '铝管', '铝管连接件', '宝宝球池顶棚', '脚轮', '脚轮适配器', '游戏袋', '滑梯',
  '模块式滑梯下板', '弧形滑梯', '小号泳池', '大号泳池', '加大号泳池', '越野轮', '越野轮连接件',
  '6向连接件', '亚克力板', '轴承连接件（母头）', '轴承连接件（公头）', '11厘米管', '17厘米管',
  '软连接件', '开口8字连接件', '软连接件轴', '轴承T连接件',
]

export const SKU_EN = [
  '5-way', '4-way', '3-way', 'Cross', 'T-joint', 'Elbow', 'Straight', '45°',
  'Tube 10 cm', 'Tube 15 cm', 'Tube 20 cm', 'Tube 25 cm', 'Tube 35 cm', '135° 3-hole 35 cm', 'Tube 75 cm', 'Curved tube',
  'Large panel', 'Half panel', 'Hole panel', 'Square textile', 'Multi wheel', 'Wheel washer', 'Wheel lock', 'Tyre strap', 'Roof',
  'Double-tube', 'Alu tube', 'Alu coupler', 'Baby-pool roof', 'Caster', 'Caster adapter', 'Play bag', 'Slide',
  'Modular slide exit', 'Curved slide', 'Pool S', 'Pool L', 'Pool XXL', 'Off-road wheel', 'Off-road coupler',
  '6-way', 'Acrylic panel', 'Bearing (female)', 'Bearing (male)', 'Tube 11 cm', 'Tube 17 cm',
  'Flexi', 'Open figure-8', 'Flexi bolt', 'Bearing T',
]

export const SKU_DE = [
  '5-Wege', '4-Wege', '3-Wege', 'Kreuz', 'T-Stück', 'Winkel', 'Gerade', '45°',
  'Rohr 10 cm', 'Rohr 15 cm', 'Rohr 20 cm', 'Rohr 25 cm', 'Rohr 35 cm', '135° 3-Loch 35 cm', 'Rohr 75 cm', 'Bogenrohr',
  'Große Platte', 'Halbplatte', 'Lochplatte', 'Textil quadratisch', 'Multirad', 'Radscheibe', 'Radfeststeller', 'Reifengurt', 'Dach',
  'Doppelrohr', 'Alurohr', 'Alu-Kupplung', 'Babybecken-Dach', 'Lenkrolle', 'Rollenadapter', 'Spielsack', 'Rutsche',
  'Modular-Auslauf', 'Bogenrutsche', 'Becken S', 'Becken L', 'Becken XXL', 'Geländerad', 'Gelände-Kupplung',
  '6-Wege', 'Acrylplatte', 'Lager (Buchse)', 'Lager (Zapfen)', 'Rohr 11 cm', 'Rohr 17 cm',
  'Flexi', 'Offene 8', 'Flexi-Bolzen', 'Lager-T',
]

export const CONN_KIND_ORDER = ['space', 'planar', 'special'] as const

export const UNTITLED: Record<Lang, string> = {
  zh: '未命名',
  en: 'Untitled',
  de: 'Unbenannt',
}

const PART_BY_LANG: Record<Lang, Record<string, string>> = { zh: PART_ZH, en: PART_EN, de: PART_DE }
const COLOR_BY_LANG: Record<Lang, Record<string, string>> = { zh: COLOR_ZH, en: COLOR_EN, de: COLOR_DE }
const KIND_BY_LANG: Record<Lang, Record<string, string>> = { zh: CONN_KIND_ZH, en: CONN_KIND_EN, de: CONN_KIND_DE }
const SKU_BY_LANG: Record<Lang, string[]> = { zh: SKU_ZH, en: SKU_EN, de: SKU_DE }

function currentLang(): Lang {
  const l = getLang()
  return l === 'zh' || l === 'de' || l === 'en' ? l : 'en'
}

export function labelOf(id: string, fallback?: string) {
  return PART_BY_LANG[currentLang()][id] ?? fallback ?? id
}

export function zhName(id: string, fallback?: string) {
  return labelOf(id, fallback)
}

export function colorLabel(id: string) {
  return COLOR_BY_LANG[currentLang()][id] ?? id
}

export function connKindLabel(kind: string) {
  return KIND_BY_LANG[currentLang()][kind] ?? kind
}

export function skuLabel(index: number) {
  return SKU_BY_LANG[currentLang()][index] ?? SKU_ZH[index] ?? String(index)
}

export function isUntitledName(name: string) {
  return name === UNTITLED.zh || name === UNTITLED.en || name === UNTITLED.de
}

export function localeOf(lang: Lang) {
  return lang === 'zh' ? 'zh-CN' : lang
}
