import { BuildModel } from '../src/engine/model.js';
import { confirmedCandidates, confirmedFrame } from '../src/engine/confirmedComponentModel.js';

// 隔离复现截图中的正面板、上下平台与侧面空框，不读取用户存档。
export function panelCornerFrame({ depth = 40, split = 40 } = {}) {
  const model = new BuildModel(), nodes = new Map();
  const node = point => {
    const key = point.join(',');
    if (!nodes.has(key)) nodes.set(key, model.addNode(...point));
    return nodes.get(key);
  };
  const edge = (a, b) => {
    const length = Math.hypot(...b.map((value, i) => value - a[i]));
    for (let start = 0; start < length; start += split) {
      const end = Math.min(length, start + split), span = end - start;
      const first = node(a.map((value, i) => value + (b[i] - value) * start / length));
      const second = node(a.map((value, i) => value + (b[i] - value) * end / length));
      if (!model.addTube(first.id, second.id, span === 40 ? 'T35' : 'T15', 'red', span - 5)) throw new Error('转角框架建管失败');
    }
  };
  for (const y of [42.5, 82.5]) {
    edge([0, y, 0], [40, y, 0]); edge([0, y, depth], [40, y, depth]);
    edge([0, y, 0], [0, y, depth]); edge([40, y, 0], [40, y, depth]);
  }
  for (const x of [0, 40]) for (const z of [0, depth]) edge([x, 42.5, z], [x, 82.5, z]);
  const at = (point, target) => Math.hypot(...point.map((value, i) => value - target[i])) < .01;
  const candidates = id => confirmedCandidates(model, id, { screwAxis: 'vertical', deduplicate: false }).flatMap(probe => [probe, { ...probe, side: -(probe.side || 1) }]).map(probe => model.confirmedDiagnostics(probe));
  const front = candidates('panel_40x40').find(part => part.valid && at(part.pos, [20, 62.5, 0]) && confirmedFrame(model, part).axes[2][2] < -.99);
  if (!front || !model.addNativePanel(front, 'green')) throw new Error('转角正面板安装失败');
  const panelId = depth === 40 ? 'panel_40x40' : 'panel_40x20';
  for (const y of [82.5, 42.5]) {
    const platform = candidates(panelId).find(part => part.valid && at(part.pos, [20, y, depth / 2]) && confirmedFrame(model, part).axes[2][1] > .99);
    if (!platform || !model.addNativePanel(platform, 'blue')) throw new Error('转角平台安装失败');
  }
  const isSide = part => part.pos && at(part.pos, [0, 62.5, depth / 2]);
  return { model, panelId, isSide };
}
