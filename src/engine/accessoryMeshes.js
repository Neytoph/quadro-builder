import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { accessorySpec } from './accessoryPack.js';

export function accessoryMeshes(scene, model, fitting, color) {
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
