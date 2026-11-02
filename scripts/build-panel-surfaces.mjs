import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../public/data/models/surfaces.json', import.meta.url);
const surfaces = JSON.parse(readFileSync(file, 'utf8'));
const catalog = JSON.parse(readFileSync(new URL('../public/data/parts.json', import.meta.url), 'utf8'));
const thickness = catalog.geometry.panelThickness * 100;
assert(thickness > 0, '板身厚度必须大于零');

for (const [key, record] of Object.entries(surfaces)) {
  if (!key.startsWith('panel2_') && key !== 'hole_panel_40x40') continue;
  const top = Math.max(...record.pos.filter((_, i) => i % 3 === 2));
  const pos = [], nrm = [], idx = [], edges = new Map();
  const addTriangle = (points, normal) => {
    const start = pos.length / 3;
    points.forEach(point => { pos.push(...point); nrm.push(...normal); });
    idx.push(start, start + 1, start + 2);
  };
  for (let i = 0; i < record.idx.length; i += 3) {
    const triangle = record.idx.slice(i, i + 3).map(vertex => record.pos.slice(vertex * 3, vertex * 3 + 3));
    if (triangle.some(point => point[2] < 0)) {
      // 包管唇边保留原位及法线，板身厚度单独统一。
      const start = pos.length / 3;
      record.idx.slice(i, i + 3).forEach(vertex => {
        pos.push(...record.pos.slice(vertex * 3, vertex * 3 + 3));
        nrm.push(...record.nrm.slice(vertex * 3, vertex * 3 + 3));
      });
      idx.push(start, start + 1, start + 2);
      continue;
    }
    if (!triangle.every(point => point[2] === top)) continue;
    const [a,b,c] = triangle;
    if ((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]) < 0) triangle.reverse();
    addTriangle(triangle, [0,0,1000]);
    addTriangle(triangle.map(([x,y,z]) => [x,y,z-thickness]).reverse(), [0,0,-1000]);
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle[edge], b = triangle[(edge+1)%3];
      const id = [a.join(','),b.join(',')].sort().join(':');
      const entry = edges.get(id) || { a,b,count:0 };
      entry.count++; edges.set(id,entry);
    }
  }
  assert(edges.size > 0, `${key} 缺少板面`);
  for (const { a,b,count } of edges.values()) {
    assert(count <= 2, `${key} 板面存在重叠边`);
    if (count !== 1) continue;
    const down = ([x,y,z]) => [x,y,z-thickness];
    const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
    assert(len > 0, `${key} 存在零长度边`);
    const normal = [Math.round(dy/len*1000),Math.round(-dx/len*1000),0];
    addTriangle([a,down(a),b],normal);
    addTriangle([b,down(a),down(b)],normal);
  }
  surfaces[key] = { ...record,pos,nrm,idx };
  console.log(`${key}：板身 ${thickness/100} cm，包管唇边保留`);
}
writeFileSync(file, JSON.stringify(surfaces) + '\n');
