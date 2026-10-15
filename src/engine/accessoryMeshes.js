import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js';
import { accessorySpec, componentFrame, mountPoint } from './accessoryPack.js';
import { confirmedComponentMeshes } from './confirmedComponentMeshes.js';
import { insetScrewMeshes } from './insetPanelMeshes.js';

const PALETTE = { blue: '#238fe4', yellow: '#ffd33c', cream: '#eee5d0', orange: '#f88929', green: '#48af63', red: '#eb4641', dark: '#363a3f', metal: '#b8bec2', rope: '#cdbc96', cloth: '#d8c8a9' };

function meshFactory(scene, frame) {
  const result = [], rotation = new THREE.Quaternion(...frame.quat), origin = new THREE.Vector3(...frame.pos);
  const material = (type, hex) => {
    const key = `accessory:${type}:${hex}`;
    if (!scene._materials[key]) scene._materials[key] = new THREE.MeshStandardMaterial({ color: hex, roughness: type === 'metal' ? 0.3 : type === 'cloth' || type === 'rope' ? 0.95 : 0.48, metalness: type === 'metal' ? 0.7 : 0, side: type === 'cloth' ? THREE.DoubleSide : THREE.FrontSide });
    return scene._materials[key];
  };
  const add = (key, create, type, color, pos = [0, 0, 0], quat = null) => {
    const geo = scene._cachedGeo ? scene._cachedGeo(`original:${key}`, create) : create();
    const mesh = new THREE.Mesh(geo, material(type, PALETTE[color] || color));
    mesh.position.fromArray(pos).applyQuaternion(rotation).add(origin);
    mesh.quaternion.copy(rotation);
    if (quat) mesh.quaternion.multiply(quat);
    mesh.castShadow = true; mesh.receiveShadow = true; result.push(mesh); return mesh;
  };
  const box = (key, size, color, pos, radius = 0.6, quat = null, type = 'plastic') => add(key, () => new RoundedBoxGeometry(...size, 3, radius), type, color, pos, quat);
  const disc = (key, radius, depth, color, pos, type = 'plastic') => add(key, () => { const g = new THREE.CylinderGeometry(radius, radius, depth, 40); g.rotateX(Math.PI / 2); return g; }, type, color, pos);
  const curve = (key, points, radius, color, type = 'rope') => add(key, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), Math.max(12, points.length * 8), radius, 8, false), type, color);
  return { result, add, box, disc, curve };
}

function cuffs(factory, spacing, hang = false) {
  const { add, box, disc } = factory;
  for (const side of [-1, 1]) {
    const x = side * spacing / 2;
    add('dark-cuff', () => { const g = new THREE.TorusGeometry(2.7, 0.55, 10, 36); g.rotateY(Math.PI / 2); g.scale(1.8, 1, 1); return g; }, 'plastic', 'dark', [x, 0, 0]);
    box('cuff-front', [2.3, 4.5, 1], 'dark', [x, -0.5, 2.65], 0.45);
    disc('cuff-bolt', 0.55, 0.26, 'metal', [x, 0, 3.25], 'metal');
    disc('cuff-bolt-center', 0.2, 0.28, 'dark', [x, 0, 3.4]);
    if (hang) {
      box('hanger', [2.2, 4.6, 1.5], 'dark', [x, -3.7, 0], 0.6);
      add('hanger-eye', () => new THREE.TorusGeometry(0.8, 0.3, 8, 24), 'metal', 'metal', [x, -4.5, 0.85]);
    }
  }
}

function steeringMeshes(scene, model, fitting) {
  const frame = componentFrame(model, fitting);
  if (!frame) return [];
  const f = meshFactory(scene, frame), { add, box, disc } = f;
  cuffs(f, 8);
  box('steering-base', [10.5, 7.2, 2.4], 'dark', [0, 0, 3.2], 1.2);
  disc('steering-shaft', 1.45, 5.6, 'dark', [0, 0, 6.2]);
  add('steering-wheel', () => new THREE.TorusGeometry(10.65, 1.35, 18, 80), 'plastic', 'blue', [0, 0, 9.4]);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + Math.PI / 2;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a - Math.PI / 2);
    box(`steering-spoke:${i}`, [2.4, 9.8, 1.7], 'cream', [Math.cos(a) * 5, Math.sin(a) * 5, 9.4], 0.85, q);
  }
  disc('steering-hub', 3.7, 2.2, 'cream', [0, 0, 9.7]);
  disc('steering-orange', 2.75, 1.15, 'orange', [0, 0, 11.1]);
  return f.result;
}

function gearGeometry(radius, teeth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth * 4; i++) {
    const a = i / (teeth * 4) * Math.PI * 2, r = (i % 4 === 0 || i % 4 === 3) ? radius * 0.78 : radius;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (!i) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 1.35, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.25, bevelSegments: 3, steps: 1, curveSegments: 12 });
}

function busyMeshes(scene, model, panel) {
  const frame = componentFrame(model, panel);
  if (!frame) return [];
  const f = meshFactory(scene, frame), { box, disc, add } = f;
  box('busy-green-outline', [35.4, 35.4, 1.8], 'green', [0, 0, 0], 2.3);
  box('busy-cream-board', [33.4, 33.4, 1.6], 'cream', [0, 0, 0.45], 1.8);
  add('busy-blue-gear', () => gearGeometry(6.5, 12), 'plastic', 'blue', [-7.5, 7, 1.3]);
  add('busy-yellow-gear', () => gearGeometry(4.5, 10), 'plastic', 'yellow', [3.3, 7, 1.3]);
  disc('busy-gear-center-big', 1.1, 0.7, 'metal', [-7.5, 7, 3.2], 'metal');
  disc('busy-gear-center-small', 0.75, 0.7, 'metal', [3.3, 7, 3.2], 'metal');
  disc('busy-green-knob', 2.65, 1.6, 'green', [11.5, 5, 2.2]);
  box('busy-knob-handle', [1, 3.5, 1.1], 'green', [11.5, 5, 3.4], 0.45, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.5));
  box('busy-slide-shadow', [12.5, 1.9, 0.22], 'dark', [-7, -8, 1.35], 0.7);
  disc('busy-red-slider', 2.25, 1.3, 'red', [-11, -8, 2.1]);
  disc('busy-blue-disc', 4.3, 1.6, 'blue', [8, -8.2, 2.2]);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7);
  box('busy-crank', [2.2, 5.7, 1.5], 'orange', [9.2, -9.8, 3.4], 0.85, q);
  disc('busy-crank-pivot', 0.6, 0.45, 'metal', [8, -8.2, 4.3], 'metal');
  disc('busy-crank-tip', 0.45, 0.45, 'metal', [10.5, -11.3, 4.3], 'metal');
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; box(`busy-disc-mark:${i}`, [0.32, 0.8, 0.16], '#066caf', [8 + Math.sin(a) * 3.1, -8.2 + Math.cos(a) * 3.1, 3.1], 0.12, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -a)); }
  return [...f.result,...insetScrewMeshes(scene,model,panel,frame)];
}

function pocketMeshes(scene, model, panel) {
  const frame = componentFrame(model, panel);
  if (!frame) return [];
  const f = meshFactory(scene, frame), { add, curve } = f;
  const depth = panel.params?.depth || 25, half = 17.3;
  // 四面布从开放口沿向中心收拢，底部弧度和褶皱由参数曲面构成。
  const clothWall = side => new ParametricGeometry((u, v, target) => {
    const along = (u - 0.5) * 2 * half, inward = 1 - v * 0.13;
    const fold = Math.sin(u * Math.PI * 8) * 0.42 * Math.sin(v * Math.PI);
    const y = -depth * v - Math.sin(u * Math.PI) * (1 - v) * 1.1;
    if (side < 2) target.set(along * inward, y, (side === 0 ? 1 : -1) * (half * inward + fold));
    else target.set((side === 2 ? 1 : -1) * (half * inward + fold), y, along * inward);
  }, 40, 26);
  for (let side = 0; side < 4; side++) add(`pocket-wall:${side}:${depth}`, () => clothWall(side), 'cloth', 'cloth');
  add(`pocket-curved-floor:${depth}`, () => new ParametricGeometry((u, v, target) => {
    const x = (u - 0.5) * half * 1.74, z = (v - 0.5) * half * 1.74;
    target.set(x, -depth - 1.6 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI), z);
  }, 30, 30), 'cloth', 'cloth');
  for (const sign of [-1, 1]) {
    const lipX = [], lipZ = [];
    for (let k = 0; k <= 24; k++) { const x = -half + k * half / 12, y = -Math.sin(k / 24 * Math.PI) * 1.1; lipX.push([x, y, sign * half]); lipZ.push([sign * half, y, x]); }
    curve(`pocket-lip-x:${sign}`, lipX, 0.4, 'cloth', 'cloth'); curve(`pocket-lip-z:${sign}`, lipZ, 0.4, 'cloth', 'cloth');
    curve(`pocket-seam-x:${sign}`, lipX.map(p => [p[0], p[1] - 1.2, p[2] + sign * 0.05]), 0.075, '#f2e8d2', 'cloth');
    curve(`pocket-seam-z:${sign}`, lipZ.map(p => [p[0] + sign * 0.05, p[1] - 1.2, p[2]]), 0.075, '#f2e8d2', 'cloth');
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    curve(`pocket-corner-seam:${x}:${z}:${depth}`, [[x * half, 0, z * half], [x * half * 0.94, -depth / 2, z * half * 0.94], [x * half * 0.87, -depth, z * half * 0.87]], 0.12, '#b6a382', 'cloth');
  }
  for (const mount of Array.isArray(panel.mounts) ? panel.mounts : []) {
    const pos = mountPoint(model, mount), rail = model._rail(mount.tube);
    if (!pos || !rail) continue;
    const x = new THREE.Vector3(...rail.dir), y = new THREE.Vector3(0, 1, 0), z = x.clone().cross(y);
    const inward = new THREE.Vector3(...frame.pos).sub(new THREE.Vector3(...pos)).dot(z) < 0 ? -1 : 1;
    const carrierFrame = { pos, quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).toArray() };
    const strap = meshFactory(scene, carrierFrame);
    strap.add('pocket-actual-wrap', () => { const g = new THREE.TorusGeometry(2.75, 0.38, 12, 40); g.rotateY(Math.PI / 2); g.scale(3.3, 1, 1); return g; }, 'cloth', 'orange');
    strap.box('pocket-actual-tab', [2.3, 5, 0.45], 'orange', [0, -3.4, inward * 2.45], 0.23, null, 'cloth');
    for (const diagonal of [-1, 1]) strap.curve(`pocket-actual-stitch:${diagonal}:${inward}`, [[diagonal * 0.8, -5.1, inward * 2.73], [-diagonal * 0.8, -1.7, inward * 2.73]], 0.055, 'cream', 'cloth');
    f.result.push(...strap.result);
  }
  return f.result;
}

export function panelAccessoryMeshes(scene, model, panel) {
  if (panel.appearanceVersion === 2) return confirmedComponentMeshes(scene, model, panel);
  return panel.panelId === 'panel_40x40_busy' ? busyMeshes(scene, model, panel) : pocketMeshes(scene, model, panel);
}

export function accessoryMeshes(scene, model, fitting, color) {
  if (fitting.appearanceVersion === 2) return confirmedComponentMeshes(scene, model, fitting);
  if (fitting.kind === 'steering_wheel') return steeringMeshes(scene, model, fitting);
  const spec = accessorySpec(fitting.kind);
  const tube = model.tubes.get(fitting.tube);
  if (!tube) throw new Error('配件缺少承载管');
  const a = model.nodes.get(tube.a), b = model.nodes.get(tube.b);
  if (!a || !b) throw new Error('配件承载管缺少端点');
  const result = [];
  const material = (type, hex) => {
    const key = `accessory:${type}:${hex}`;
    if (!scene._materials[key]) {
      const presets = { plastic: [0.42, 0], rope: [0.95, 0], wood: [0.72, 0], metal: [0.28, 0.8], cloth: [0.9, 0] };
      const [roughness, metalness] = presets[type];
      scene._materials[key] = new THREE.MeshStandardMaterial({ color: hex, roughness, metalness });
    }
    return scene._materials[key];
  };
  const rope = material('rope', '#d5c4a1');
  const metal = material('metal', '#b4bac0');
  const plastic = material('plastic', color);
  const wood = material('wood', '#cba06c');
  const fabric = material('cloth', color);
  const add = (key, create, mat, pos, quat = null) => {
    const mesh = new THREE.Mesh(create(), mat);
    mesh.position.copy(pos);
    if (quat) mesh.quaternion.copy(quat);
    mesh.castShadow = true; mesh.receiveShadow = true; result.push(mesh); return mesh;
  };
  const line = (p, q, radius, mat) => {
    const d = q.clone().sub(p), length = d.length();
    if (length < 0.001) return;
    add(`line:${radius}:${length.toFixed(3)}`, () => new THREE.CylinderGeometry(radius, radius, length, 10), mat,
      p.clone().add(q).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  };
  const origin = new THREE.Vector3((a.x + b.x) / 2, a.y, (a.z + b.z) / 2);
  const x = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  const up = new THREE.Vector3(0, 1, 0), z = x.clone().cross(up);
  const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
  const at = (px, py, pz = 0) => origin.clone().addScaledVector(x, px).addScaledVector(up, py).addScaledVector(z, pz);
  for (const side of [-1, 1]) {
    const px = side * (fitting.kind === 'swing' ? 11 : 9);
    add('cuff', () => new THREE.TorusGeometry(2.75, 0.38, 8, 24), metal, at(px, 0), rotation);
    add('link', () => new THREE.TorusGeometry(1.25, 0.3, 8, 20), metal, at(px, -3.6), rotation);
    if (fitting.kind === 'swing') {
      line(at(px, -4.6), at(px, -spec.drop + 3), 0.45, rope);
      for (const depth of [-5, 5]) line(at(px, -spec.drop + 3), at(px, -spec.drop, depth), 0.42, rope);
    } else {
      const ringY = -spec.drop + 6.5;
      add('strap', () => new RoundedBoxGeometry(1.8, spec.drop - 17, 0.32, 2, 0.12), fabric, at(px, (-5 + ringY + 6.5) / 2), rotation);
      add('ring', () => new THREE.TorusGeometry(5.3, 1.2, 12, 40), wood, at(px, ringY), rotation);
    }
  }
  if (fitting.kind === 'swing') {
    add('seat', () => new RoundedBoxGeometry(28, 2.6, 15, 4, 1.2), plastic, at(0, -spec.drop), rotation);
    for (const side of [-1, 1]) add('seat-edge', () => new RoundedBoxGeometry(2.6, 4, 15, 3, 1), plastic, at(side * 12.7, -spec.drop + 1.3), rotation);
  }
  return result;
}
