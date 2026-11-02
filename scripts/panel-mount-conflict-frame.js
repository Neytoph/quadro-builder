import { BuildModel } from '../src/engine/model.js';

// 按截图建立隔离复现框架，不替代用户原存档。
export function screenshotFrame() {
  const model = new BuildModel();
  const node = (x, y, z) => model.findNodeNear(x, y, z) || model.addNode(x, y, z);
  const tube = (a, b) => {
    const first = node(...a), second = node(...b), span = Math.hypot(...a.map((v, i) => v - b[i]));
    const part = model.addTube(first.id, second.id, span === 20 ? 'T15' : 'T35', 'orange', span - 5);
    if (!part) throw new Error('复现框架建管失败');
    return part;
  };
  for (const y of [2.5, 22.5, 42.5, 82.5]) {
    for (const z of [0, 40, 80]) for (const x of [0, 40]) tube([x, y, z], [x + 40, y, z]);
    for (const x of [0, 40, 80]) for (const z of [0, 40]) tube([x, y, z], [x, y, z + 40]);
  }
  for (const x of [0, 40, 80]) for (const z of [0, 40, 80]) for (const y of [2.5, 22.5, 42.5, 82.5]) {
    tube([x, y, z], [x, y + (y < 42.5 ? 20 : 40), z]);
  }
  const candidate = (panelId, pos) => model.confirmedMounts(panelId).find(p => p.pos && Math.hypot(...p.pos.map((v, i) => v - pos[i])) < .1);
  return { model, candidate };
}
