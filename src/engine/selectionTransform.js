import {xAxisOf} from './util.js';

// 操作轴和数值输入共用选区边界；有接头时以接头范围为准，避免配件原点改变高度含义。
export function selectionBounds(model, selection) {
  const targets = model.moveTargets(selection);
  const points = [...targets.nodes].map(id => model.nodes.get(id));
  if(!points.length)for (const key of ['clamps','slides','fittings']) for (const id of targets[key]) points.push(model[key].get(id));
  const valid = points.filter(point => point && [point.x,point.y,point.z].every(Number.isFinite));
  if (!valid.length) return null;
  const min = ['x','y','z'].map(key => Math.min(...valid.map(point => point[key])));
  const max = ['x','y','z'].map(key => Math.max(...valid.map(point => point[key])));
  return {center:min.map((value,i)=>(value+max[i])/2),height:min[1],targets};
}

export function connectedTransformSelection(model,selection) {
  const selected=new Map();
  for(const [id,kind] of selection)for(const [part,type] of model.connectedSelection(id,kind))selected.set(part,type);
  const nodes=model.moveTargets(selected).nodes;
  for(const [id,kind] of selected) {
    const part=kind==='fitting' && model.fittings.get(id);
    if(!part || !['pool2','pool-small2'].includes(part.kind) || selection.has(id))continue;
    // 泳池的包围范围不能把旁边的独立桥面算作承载架；按实际挂点所在管判断。
    const tube=model._clampTubeAt([part.x,part.y,part.z],xAxisOf(part.quat || [0,0,0,1]));
    if(!tube || !nodes.has(tube.a) || !nodes.has(tube.b))selected.delete(id);
  }
  return selected;
}

// 避免一次局部拖动拆开未选中的板、布或管架。用户可先选整块再操作。
export function incompleteRigidSelection(model, targets) {
  if (model._incompleteComponentMove(targets)) return true;
  for (const tube of model.tubes.values()) if (targets.nodes.has(tube.a) !== targets.nodes.has(tube.b)) return true;
  for (const part of [...model.panels.values(),...model.textiles.values()]) {
    const nodes = [...new Set((part.supportTubes || [part.a,part.b]).flatMap(id => {
      const tube=model.tubes.get(id);return tube ? [tube.a,tube.b] : [];
    }))];
    if (nodes.some(id=>targets.nodes.has(id)) && nodes.some(id=>!targets.nodes.has(id))) return true;
  }
  return false;
}
