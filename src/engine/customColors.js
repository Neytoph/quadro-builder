import { colorHex } from './catalog.js';
import { fixedTubeColor, fixedFittingColor } from './model.js';
import { confirmedSpec, usesCustomClimbingColor } from './componentPack.js';

export const COLOR_MAPS = ['tubes', 'panels', 'textiles', 'slides', 'fittings'];

function partColor(map, part) {
  let value = part.color;
  if (map === 'tubes') value = fixedTubeColor(part.tubeId) || value;
  if (map === 'fittings') value = fixedFittingColor(part.kind) || value;
  if (part.appearanceVersion === 2 && !usesCustomClimbingColor(part)) value = confirmedSpec(part.panelId || part.partId || part.kind)?.fixedColor || value;
  return value ? normalizeColor(colorHex(value)) : null;
}

export function normalizeColor(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (/^[a-f\d]{3}$/i.test(hex)) return '#' + [...hex].map(c => c + c).join('').toUpperCase();
  return /^[a-f\d]{6}$/i.test(hex) ? '#' + hex.toUpperCase() : null;
}

export function customColorSlots(values) {
  return Array.from({ length: 4 }, (_, index) => normalizeColor(values[index]));
}

export function modelColors(model) {
  if (!model) return [];
  const colors = new Set();
  for (const key of COLOR_MAPS) for (const part of model[key].values()) {
    if (part.arm || part.link) continue;
    const color = partColor(key, part);
    if (color) colors.add(color);
  }
  return [...colors];
}

export function selectionColor(model, selection) {
  if (!model || !selection) return null;
  const maps = { tube: 'tubes', panel: 'panels', textile: 'textiles', slide: 'slides', fitting: 'fittings' };
  const colors = new Set();
  for (const [id, kind] of selection) {
    const part = model[maps[kind]]?.get(id);
    if (part) { const color = partColor(maps[kind], part); if (color) colors.add(color); }
  }
  return colors.size === 1 ? [...colors][0] : null;
}

// 仅复制可着色记录供渲染使用；原模型、历史与协作文档始终保留确认前的颜色。
export function colorPreviewModel(model, selection, hex) {
  const preview = Object.assign(Object.create(Object.getPrototypeOf(model)), model);
  for (const key of COLOR_MAPS) preview[key] = new Map([...model[key]].map(([id, part]) => [id, { ...part }]));
  for (const [id, kind] of selection) preview.setColorOf(kind, id, hex);
  return preview;
}
