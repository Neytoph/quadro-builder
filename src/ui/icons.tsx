/** 16×16 图标。inner 是静态 SVG（来自 vokako 工具栏）。 */
export function Svg16({ inner, size = 18 }: { inner: string; size?: number }) {
  return <svg viewBox="0 0 16 16" width={size} height={size} fill="none" dangerouslySetInnerHTML={{ __html: inner }} />
}

export const TOOL_ICON = {
  select: '<path d="M3.5 2 L12.8 8.2 L8.4 9 L10.7 13.6 L8.9 14.5 L6.5 9.9 L3 12.4 Z" fill="currentColor"/>',
  tube: '<rect x="1.6" y="6.4" width="12.8" height="3.2" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  panel: '<rect x="3" y="3" width="10" height="10" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  slide: '<path d="M3 13 C7 13 5 4 13 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  wheel: '<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><path d="M8 2.4 L8 13.6 M2.4 8 L13.6 8 M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="0.9"/>',
  textile: '<path d="M2.5 4 L13.5 4 L13.5 12 L2.5 12 Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 6.5 C5 5.4 6.5 7.6 8 6.5 C9.5 5.4 11 7.6 13.5 6.5" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2.5 9.5 C5 8.4 6.5 10.6 8 9.5 C9.5 8.4 11 10.6 13.5 9.5" fill="none" stroke="currentColor" stroke-width="1"/>',
  pool: '<path d="M2.5 4 L2.5 12.5 L13.5 12.5 L13.5 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M3.5 8.5 C5.2 7.4 6.6 9.6 8.2 8.5 C9.8 7.4 11.2 9.6 12.8 8.5" fill="none" stroke="currentColor" stroke-width="1"/>',
  reinforce: '<rect x="1.6" y="4.8" width="12.8" height="6.4" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>',
} as const

const connBody = '<rect x="5.6" y="5.6" width="4.8" height="4.8" rx="1.1" fill="currentColor"/>'
const arm = (x: number, y: number) => `<line x1="8" y1="8" x2="${x}" y2="${y}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`
const connIcon = (...a: string[]) => connBody + a.join('')

const holeArm: Record<string, [number, number, number, number]> = { r: [11.1, 8, 14.6, 8], l: [1.4, 8, 4.9, 8], d: [8, 11.1, 8, 14.6] }
const holeIcon = (...keys: string[]) =>
  keys.map(k => { const [x1, y1, x2, y2] = holeArm[k]; return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>` }).join('') +
  '<circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.6"/>'

export const CONN_CAT_ICON: Record<string, string> = {
  '6way': connIcon(arm(1.5, 8), arm(14.5, 8), arm(8, 1.5), arm(8, 14.5), arm(13, 3), arm(3, 13)),
  '5way': connIcon(arm(1.5, 8), arm(14.5, 8), arm(8, 1.5), arm(8, 14.5), arm(13, 3)),
  '4way': connIcon(arm(1.5, 8), arm(14.5, 8), arm(8, 14.5), arm(13, 3)),
  '3way': connIcon(arm(1.5, 8), arm(8, 14.5), arm(13, 3)),
  'cross': connIcon(arm(1.5, 8), arm(14.5, 8), arm(8, 1.5), arm(8, 14.5)),
  't': connIcon(arm(1.5, 8), arm(14.5, 8), arm(8, 14.5)),
  'straight': connIcon(arm(1.5, 8), arm(14.5, 8)),
  'elbow': connIcon(arm(1.5, 8), arm(8, 14.5)),
  'diagonal': connIcon(arm(1.5, 8), arm(13.5, 2.5)),
  'flexi': '<circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="8" x2="1.8" y2="10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="8" x2="13.5" y2="3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  'flexi_hinge': '<circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.8 8 L2 8 M10.2 8 L14 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  'flexi_bolt': '<circle cx="4.4" cy="8" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="7" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  'hole_1': holeIcon('r'),
  'hole_2': holeIcon('r', 'l'),
  'hole_t': holeIcon('r', 'l', 'd'),
  'bearing': '<line x1="1.5" y1="10.5" x2="14.5" y2="10.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><rect x="5.4" y="7.4" width="5.2" height="6.2" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="6.6" y="2.4" width="2.8" height="5.4" rx="1.2" fill="currentColor"/>',
  'double_tube': '<line x1="1" y1="5.2" x2="15" y2="5.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><line x1="1" y1="10.8" x2="15" y2="10.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="8" cy="5.2" r="3.1" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="10.8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  'tube_clamp': '<line x1="1" y1="5.2" x2="15" y2="5.2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><line x1="1" y1="10.8" x2="15" y2="10.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M5.4 3.5 A3.1 3.1 0 1 0 10.6 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M5.4 12.5 A3.1 3.1 0 1 1 10.6 12.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
}

export const ACC_CAT_ICON: Record<string, string> = {
  'multi-wheel2': TOOL_ICON.wheel,
  'floating-wheel2': '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2.6"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/>',
  'casters2': '<path d="M8 1.6 L8 5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4.4 5.4 L11.6 5.4 L10.4 9 L5.6 9 Z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="11.6" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  'bearing2': '<rect x="2.2" y="5.2" width="5.6" height="5.6" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="7.8" y="6.6" width="6" height="2.8" rx="1.2" fill="currentColor"/>',
  'hub-cap2': '<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="3" fill="currentColor"/>',
  'steering-lock2': '<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 2.6 L8 8 L11.6 9.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  'adapter2': '<path d="M2.4 6.4 L8.6 6.4 L8.6 9.6 L2.4 9.6" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="8.6" y="4.8" width="5" height="6.4" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  'textil2': TOOL_ICON.textile,
  'textil-round2': '<path d="M3 13 L3 8 A8 8 0 0 1 11 13 Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 8 A8 8 0 0 1 11 13" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  'roof-large2': '<path d="M2 12 L8 4 L14 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><line x1="4.4" y1="12" x2="11.6" y2="12" stroke="currentColor" stroke-width="1.2"/>',
  'lattice2': '<rect x="2.5" y="4" width="11" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 4 L6 12 M9.5 4 L9.5 12 M2.5 6.7 L13.5 6.7 M2.5 9.3 L13.5 9.3" stroke="currentColor" stroke-width="0.8"/>',
  'bag2': '<path d="M3 4 L13 4 L11.6 13 L4.4 13 Z" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="3" y1="4" x2="13" y2="4" stroke="currentColor" stroke-width="1.8"/>',
}

const SCREW_ICON = '<circle cx="8" cy="4" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.2 L8 5.8 M6.2 4 L9.8 4" stroke="currentColor" stroke-width="1.15"/><path d="M8 6.6 L8 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
const CAP_ICON = '<circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" fill="currentColor"/>'

const BY_ID: Record<string, string> = {
  ...CONN_CAT_ICON,
  ...ACC_CAT_ICON,
  wheel: ACC_CAT_ICON['multi-wheel2'],
  wheel_floating: ACC_CAT_ICON['floating-wheel2'],
  caster: ACC_CAT_ICON['casters2'],
  steering_lock: ACC_CAT_ICON['steering-lock2'],
  hub_cap: ACC_CAT_ICON['hub-cap2'],
  wheel_bearing: ACC_CAT_ICON['bearing2'],
  wheel_adapter: ACC_CAT_ICON['adapter2'],
  'bearing-clamp': CONN_CAT_ICON.bearing,
  textile: ACC_CAT_ICON.textil2,
  textile_round: ACC_CAT_ICON['textil-round2'],
  roof_large: ACC_CAT_ICON['roof-large2'],
  lattice: ACC_CAT_ICON.lattice2,
  bag: ACC_CAT_ICON.bag2,
  slide_integral: TOOL_ICON.slide,
  slide_module: TOOL_ICON.slide,
  slide_curved: TOOL_ICON.slide,
  slide_end: TOOL_ICON.slide,
  'slide-new2': TOOL_ICON.slide,
  slide2: TOOL_ICON.slide,
  'curved-slide2': TOOL_ICON.slide,
  'slide-end2': TOOL_ICON.slide,
  tube_cap: CAP_ICON,
  open_end: CAP_ICON,
  safety_clamp: CONN_CAT_ICON.tube_clamp,
  reinforce80: TOOL_ICON.reinforce,
  screw_tube: SCREW_ICON,
  screw_panel: SCREW_ICON,
  screw_slide: SCREW_ICON,
  screw_slide_conical: SCREW_ICON,
  screw_slide_conical_counter: SCREW_ICON,
}

const BY_KIND: Record<string, string> = {
  tubes: TOOL_ICON.tube,
  connectors: CONN_CAT_ICON['6way'],
  panels: TOOL_ICON.panel,
  slides: TOOL_ICON.slide,
  wheels: TOOL_ICON.wheel,
  textiles: TOOL_ICON.textile,
  fittings: TOOL_ICON.wheel,
  reinforcements: TOOL_ICON.reinforce,
  screws: SCREW_ICON,
}

/** 零件清单 / 库存行用的图标：优先零件 id，其次分类。 */
export function partIcon(id?: string | null, kind?: string | null): string {
  const key = String(id || '')
  if (key && BY_ID[key]) return BY_ID[key]
  if (key.startsWith('T') || key.startsWith('TC')) return TOOL_ICON.tube
  if (key.startsWith('panel') || key.startsWith('hole_panel')) return TOOL_ICON.panel
  if (key.startsWith('pool_liner')) return TOOL_ICON.pool
  if (key.startsWith('screw')) return SCREW_ICON
  if (key.startsWith('reinforce')) return TOOL_ICON.reinforce
  if (kind && BY_KIND[kind]) return BY_KIND[kind]
  return TOOL_ICON.tube
}
