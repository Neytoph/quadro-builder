import { COLOR_HEX, isHexColor } from './colors.js';

const variants = { steering_wheel: 'four_spoke', lattice: 'diamond_net' };

export function readComponentAppearance(part) {
  const appearance = part?.params?.appearance;
  if (appearance == null) return null;
  const id = part.partId || part.panelId || part.kind;
  if (typeof appearance !== 'object' || !Object.hasOwn(variants, id) || appearance.variant !== variants[id]
    || Object.keys(appearance).some(key => key !== 'variant')
    || !(Object.hasOwn(COLOR_HEX, part.color) || isHexColor(part.color))) {
    throw new Error(`组件外观变体无效：${id}`);
  }
  return { variant: appearance.variant, color: part.color };
}

export function applyComponentAppearance(part, appearance) {
  if (appearance == null) return;
  const probe = { ...part, params: { ...part.params, appearance } };
  const validated = readComponentAppearance(probe);
  part.params = { ...part.params, appearance: { variant: validated.variant } };
}

export function diamondNetSegments() {
  const segments = [];
  for (let i = 1; i < 16; i++) {
    const sum = i / 8;
    segments.push([[Math.max(0, sum - 1), Math.min(1, sum)], [Math.min(1, sum), Math.max(0, sum - 1)]]);
  }
  for (let i = -7; i <= 7; i++) {
    const difference = i / 8;
    segments.push([[Math.max(0, difference), Math.max(0, -difference)], [Math.min(1, 1 + difference), Math.min(1, 1 - difference)]]);
  }
  return segments;
}
