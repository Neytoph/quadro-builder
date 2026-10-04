import { CONFIRMED_COMPONENTS } from './componentPack.js';

// 旧编号的顺序保留，新板型追加；材质标记只用于保留种类，QDF仍是平面板。
const existing = ['lego', 'honeycomb', 'busy', 'felt', 'magnet', 'climbing', 'sensory', 'pocket', 'basin', 'rainbow', 'bridge'];
export const QDF_FEATURE_KEYS = [...new Set([...existing, ...CONFIRMED_COMPONENTS.filter(p => p.placement === 'panel').map(p => p.feature)])].filter(key => !['plain', 'holes', 'acrylic'].includes(key));
export const QDF_FEATURE_SUFFIX = new RegExp(` \\((${QDF_FEATURE_KEYS.join('|')})\\)$`);
export function qdfPanelDimensionKey(w, h) {
  const a = Math.round(w), b = Math.round(h);
  return Math.min(a, b) + 'x' + Math.max(a, b);
}
