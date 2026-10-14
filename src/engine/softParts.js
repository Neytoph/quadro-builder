// 与料表共用软装范围；旧存档的种类名也按同一规则处理。
export const SOFT_PARTS = new Set(['textile', 'textile_20x40', 'textile_long', 'textile_round_fourway', 'textile_bridge', 'textile_rainbow', 'lattice', 'lattice_curved', 'trampoline', 'rope', 'textile_round', 'bag', 'roof', 'roof_large']);
const LEGACY_SOFT_KINDS = new Set(['textil2', 'lattice2', 'textil-round2', 'bag2', 'roof2', 'roof-large2', 'panel_40x40_pocket']);

export function isSoftPart(model, part) {
  const kind = part.panelId || part.partId || part.kind;
  return model.textiles.has(part.id) || SOFT_PARTS.has(kind) || LEGACY_SOFT_KINDS.has(kind);
}
