import { BuildModel } from './model.js';
import { getTube, geometry } from './catalog.js';

// 示例通过真实安装API生成，可在Builder中继续编辑；承载能力没有实物验证。
export function createOriginalAccessoryExample() {
  const model = new BuildModel();
  const nodes = new Map();
  const ground = geometry().connectorSize / 2;
  const colors = ['red', 'green', 'blue', 'yellow'];
  let colorIndex = 0;
  const node = (x, y, z) => {
    const key = [x, y, z].join(',');
    if (!nodes.has(key)) nodes.set(key, model.addNode(x, ground + y, z));
    return nodes.get(key);
  };
  const tube = (from, to, color = null) => {
    const a = node(...from), b = node(...to);
    const span = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const id = span > 60 ? 'T75' : 'T35';
    const spec = getTube(id);
    if (!spec) throw new Error(`示例缺少管件：${id}`);
    const result = model.addTube(a.id, b.id, id, color || colors[colorIndex++ % colors.length], spec.length_cm);
    if (!result) throw new Error('示例框架管件无法创建');
    return result;
  };

  for (const x of [0, 40, 80]) for (const y of [0, 40, 80]) for (const z of [0, 40, 80]) {
    if (x < 80) tube([x, y, z], [x + 40, y, z]);
    if (y < 80) tube([x, y, z], [x, y + 40, z]);
    if (z < 80) tube([x, y, z], [x, y, z + 40]);
  }
  for (const x of [140, 220]) {
    for (const z of [0, 80]) for (const y of [0, 40, 80]) tube([x, y, z], [x, y + 40, z]);
    for (const y of [0, 40, 80]) tube([x, y, 0], [x, y, 80]);
    tube([x, 120, 0], [x, 120, 40]);
    tube([x, 120, 40], [x, 120, 80]);
  }
  for (const z of [0, 80]) tube([140, 0, z], [220, 0, z]);
  const beam = tube([140, 120, 40], [220, 120, 40], 'yellow');
  beam.reinforced = true;

  const near = (a, b) => Math.abs(a - b) < 0.1;
  const findPanelMount = (id, wanted) => {
    const mount = model.panelAccessoryMounts(id).find(m => {
      const corners = m.corners || model.panelCorners(m);
      if (!corners) return false;
      const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]), zs = corners.map(p => p[2]);
      return wanted({ xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys), zmin: Math.min(...zs), zmax: Math.max(...zs) });
    });
    if (!mount) throw new Error(`示例找不到安装位置：${id}`);
    return mount;
  };
  const busy = findPanelMount('panel_40x40_busy', p => near(p.xmin, 0) && near(p.xmax, 40) && near(p.ymin, ground + 40) && near(p.ymax, ground + 80) && near(p.zmin, 80) && near(p.zmax, 80));
  if (!model.addPanel(busy.a, busy.b, busy.t0, busy.len, 'panel_40x40_busy', 'green')) throw new Error('示例忙碌板安装失败');

  const steeringTube = [...model.tubes.values()].find(t => {
    const a = model.nodes.get(t.a), b = model.nodes.get(t.b);
    return a && b && near(a.x, 40) && near(b.x, 80) && near(a.y, ground + 80) && near(b.y, ground + 80) && near(a.z, 80) && near(b.z, 80);
  });
  if (!steeringTube || !model.addAccessory('steering_wheel', steeringTube.id, 'blue', { facing: 1 })) throw new Error('示例方向盘安装失败');

  const pocket = findPanelMount('panel_40x40_pocket', p => near(p.xmin, 40) && near(p.xmax, 80) && near(p.ymin, ground + 40) && near(p.ymax, ground + 40) && near(p.zmin, 40) && near(p.zmax, 80));
  if (!model.addPanel(pocket.a, pocket.b, pocket.t0, pocket.len, 'panel_40x40_pocket', 'yellow')) throw new Error('示例布兜安装失败');
  if (!model.addAccessory('swing', beam.id, 'blue')) throw new Error('示例秋千安装失败');
  return model;
}
