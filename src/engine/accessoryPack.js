export const ACCESSORY_PACK = [
  { id: 'swing', name: '秋千', name_en: 'Swing', name_de: 'Schaukel', mount: 'horizontal', drop: 48, width: 28 },
  { id: 'gym_rings', name: '吊环', name_en: 'Gym rings', name_de: 'Turnringe', mount: 'horizontal', drop: 40, width: 30 },
];

export const ACCESSORY_IDS = new Set(ACCESSORY_PACK.map(part => part.id));

export function accessorySpec(kind) {
  const spec = ACCESSORY_PACK.find(part => part.id === kind);
  if (!spec) throw new Error(`未知配件：${kind}`);
  return spec;
}

export function accessoryMount(model, kind, tubeId) {
  const spec = accessorySpec(kind);
  const tube = model.tubes.get(tubeId);
  if (!tube || tube.arm || tube.link) return null;
  const a = model.nodes.get(tube.a), b = model.nodes.get(tube.b);
  if (!a || !b) throw new Error('配件承载管缺少端点');
  if (spec.mount === 'bow') {
    if (!tube.bow || !tube.bowCenter) return null;
    const c = tube.bowCenter;
    return { tube: tubeId, pos: [(a.x + b.x + c[0]) / 3, (a.y + b.y + c[1]) / 3, (a.z + b.z + c[2]) / 3] };
  }
  if (tube.bow || Math.abs(a.y - b.y) > 0.01) return null;
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  if (span < spec.width + 5 || a.y < spec.drop + 8) return null;
  return { tube: tubeId, pos: [(a.x + b.x) / 2, a.y, (a.z + b.z) / 2] };
}
