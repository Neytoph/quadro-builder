// 用户确认稿的安装口径；数值是框格设计假设，未经实测或承载认证。
import { INSET_PANEL_IDS, INSET_MOUNT_LAYOUT } from './insetPanelMounts.js';
const panel = (id, name, feature, w = 40, h = 40, mountType = 'frame') => ({ id, name, feature, w, h, width: w, height: h, depth: 1.2, placement: 'panel', mountType, verifiedLoad: false, appearanceVersion: 2, kitContents: ['component', 'retainers'] });
const fitting = (id, name, mountType, feature, width = 40, height = 40) => ({ id, name, mountType, feature, width, height, depth: 1.2, placement: 'fitting', verifiedLoad: false, appearanceVersion: 2, kitContents: ['component', 'retainers'] });
const EN=['Square panel','Small panel','30 cm square panel','Quarter-circle panel','Clear panel','Small clear panel','Long acrylic panel','Perforated acrylic panel','Clock panel','Number maze panel','Green brick baseplate','Nine-hole panel','Magnetic panel','Honeycomb panel','Large climbing panel','Medium climbing panel','Small climbing panel','Flat climbing net','Curved climbing net','Basketball hoop','Rainbow bridge','Trampoline','Soft roller','Fabric panel','Long fabric panel','Curved climbing fabric','Curved fabric with joint clearance','Sensory basin','Gel sensory mat','Clear hemisphere','Clear platform','Felt activity panel','Castle panel','Rope','Grid panel'];
const DE=['Quadratische Platte','Kleine Platte','Quadratische 30-cm-Platte','Viertelkreisplatte','Transparente Platte','Kleine transparente Platte','Lange Acrylplatte','Acryl-Lochplatte','Uhrentafel','Zahlenlabyrinth','Grüne Bausteinplatte','Neunlochplatte','Magnettafel','Wabenplatte','Große Kletterplatte','Mittlere Kletterplatte','Kleine Kletterplatte','Flaches Kletternetz','Gebogenes Kletternetz','Basketballkorb','Regenbogenbrücke','Trampolin','Weiche Rolle','Stofffläche','Lange Stofffläche','Gebogener Kletterstoff','Gebogener Stoff mit Anschlussfreiheit','Sensorikwanne','Gel-Sensorikmatte','Transparente Halbkugel','Transparente Plattform','Filztafel','Burgplatte','Seil','Gitterplatte'];
export const CONFIRMED_COMPONENTS = [
  panel('panel_40x40', '普通方板', 'plain'), panel('panel_40x20', '小板', 'plain', 40, 20), panel('panel_30x30', '30厘米方板', 'plain', 30, 30),
  fitting('panel_sector_40', '扇形小板', 'corner', 'sector'),
  panel('acrylic_panel_40x40', '透明大板', 'acrylic'), panel('acrylic_panel_40x20', '透明小板', 'acrylic', 40, 20),
  panel('acrylic_panel_40x60', '亚克力长板', 'acrylic', 40, 60), panel('acrylic_hole_panel_40x40', '亚克力九洞板', 'acrylic_holes'),
  panel('panel_40x40_clock', '时钟板', 'clock', 40, 40, 'vertical-frame'), panel('panel_40x40_maze', '数字迷宫板', 'maze', 40, 40, 'vertical-frame'),
  { ...panel('panel_40x40_lego', '积木板', 'lego'), studHeight: 1.25 }, panel('hole_panel_40x40', '九洞板', 'holes'),
  panel('panel_40x40_magnet', '磁吸板', 'magnet', 40, 40, 'vertical-frame'), { ...panel('panel_40x40_honeycomb', '蜂窝板', 'honeycomb'), defaultColor:'blue', paletteVersion:2 },
  panel('panel_40x40_climbing', '大板攀岩板', 'climbing', 40, 40, 'vertical-frame'),
  panel('panel_40x30_climbing', '中板攀岩板', 'climbing', 40, 30, 'vertical-frame'), panel('panel_40x20_climbing', '小板攀岩板', 'climbing', 40, 20, 'vertical-frame'),
  fitting('lattice', '平面攀爬网', 'net-frame', 'net'), fitting('lattice_curved', '曲面攀爬网', 'curved-frame', 'net'),
  { ...panel('panel_40x40_basketball', '篮球框', 'basketball', 40, 40, 'vertical-frame'), depth: 32 },
  fitting('textile_bridge', '彩虹桥', 'rails', 'bridge', 40, 80),
  {...fitting('trampoline', '蹦床', 'horizontal-frame', 'trampoline',80,80),sizes:[[40,40],[40,80],[80,40],[80,80]]}, { ...fitting('sleeve', '软体滚筒', 'tube', 'roller'), radius: 9 },
  fitting('textile', '普通布片', 'rails', 'cloth'), fitting('textile_long', '长布片', 'rails', 'cloth', 40, 80),
  fitting('textile_round', '弯管攀爬布', 'curved-frame', 'cloth'), fitting('textile_round_fourway', '弯管四通布', 'curved-frame', 'cloth-fourway'),
  { ...panel('panel_40x40_basin', '感官盆', 'basin', 40, 40, 'horizontal-frame'), depth: 8 },
  panel('panel_40x40_sensory', '感官垫', 'sensory', 40, 40, 'horizontal-frame'),
  { ...panel('panel_40x40_capsule', '太空舱', 'capsule', 40, 40, 'vertical-frame'), depth: 16 },
  panel('acrylic_platform_40x40', '透明平台', 'acrylic', 40, 40, 'horizontal-frame'),
  panel('panel_40x40_felt', '毛毡板', 'felt', 40, 40, 'vertical-frame'), panel('panel_40x20_castle', '长城板', 'castle', 40, 20, 'vertical-frame'),
  fitting('rope', '绳子', 'rope', 'rope'),
  panel('panel_40x40_grid', '格子板', 'grid'),
].map((spec,index) => ({ ...spec, ...(INSET_PANEL_IDS.has(spec.id)?{mountLayout:INSET_MOUNT_LAYOUT,kitContents:['component','transparent-screw-4']}:{}), name_en: EN[index], name_de: DE[index], fixedColor:({panel_40x40_climbing:'#39a7df',panel_40x30_climbing:'#64b66b',panel_40x20_climbing:'#ed5b49'})[spec.id] || ({lego:'#2FCB5A',basketball:'#008ce7',magnet:'#f3f3ed',felt:'#efc947',clock:'#f6d334',maze:'#77bf64',basin:'#a9acb0',roller:'#f0d33f',trampoline:'#26292b',rope:'#f0e8d6',grid:'#f6f2e7',capsule:'#eaf7fa',acrylic:'#eaf7fa',acrylic_holes:'#eaf7fa',sensory:'#f5ba33'})[spec.feature] || null, mount:spec.mountType, designAssumption:true, assumption: 'frame-grid-unmeasured', qdfSupported:spec.placement==='panel', qdfSimplified:spec.placement==='panel' }));
export const CONFIRMED_PANEL_IDS = new Set(CONFIRMED_COMPONENTS.filter(p => p.placement === 'panel').map(p => p.id));
export const CONFIRMED_FITTING_IDS = new Set(CONFIRMED_COMPONENTS.filter(p => p.placement === 'fitting').flatMap(p => [p.id, p.kind || p.id]));
export function confirmedSpec(id) { return CONFIRMED_COMPONENTS.find(p => p.id === id || p.kind === id) || null; }
export function confirmedColor(part) {
  if(part?.appearanceVersion!==2)return part?.color;
  const spec=confirmedSpec(part.panelId || part.partId || part.kind);
  // 旧固定粉色蜂窝仍保留存档字段，呈现与清单共用经典蓝回退。
  if(spec?.feature==='honeycomb' && part.params?.paletteVersion!==2 && part.color==='#ec9eb2')return 'blue';
  return spec?.fixedColor || part.color || spec?.defaultColor;
}
export function legoStudHeight(part) { return part.params?.studHeight ?? 0.7; }
