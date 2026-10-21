import fs from 'node:fs';
import { createHash } from 'node:crypto';

// 只提取45°件的原厂精细网格，安装检查无需加载整套拼装资源。
const file = 'public/data/models/fittings-fine.json';
const text = fs.readFileSync(file, 'utf8');
const mesh = JSON.parse(text).connector45_2;
const data = { source: file, sha256: createHash('sha256').update(text).digest('hex'),
  pos: mesh.pos.map(value => value / 100), idx: mesh.idx };
const output = JSON.stringify(data) + '\n';
const target = 'src/engine/c45Mesh.json';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== output) throw new Error('45°件碰撞网格与原厂资源不一致');
} else fs.writeFileSync(target, output);
