import * as THREE from 'three';

function circleHole(shape, x, y, r) {
  const hole = new THREE.Path();
  hole.absarc(x, y, r, 0, Math.PI * 2, true);
  shape.holes.push(hole);
}
function ring(outer, inner, length) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  circleHole(shape, 0, 0, inner);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 48 });
  geo.rotateY(Math.PI / 2);
  return geo;
}
function flange() {
  const shape = new THREE.Shape();
  shape.moveTo(-5.8, -6.85);
  shape.quadraticCurveTo(-6.85, -6.85, -6.85, -5.8);
  shape.lineTo(-6.85, -4.7); shape.quadraticCurveTo(-5.7, 0, -6.85, 4.7);
  shape.lineTo(-6.85, 5.8); shape.quadraticCurveTo(-6.85, 6.85, -5.8, 6.85);
  shape.lineTo(-4.7, 6.85); shape.quadraticCurveTo(0, 5.7, 4.7, 6.85);
  shape.lineTo(5.8, 6.85); shape.quadraticCurveTo(6.85, 6.85, 6.85, 5.8);
  shape.lineTo(6.85, 4.7); shape.quadraticCurveTo(5.7, 0, 6.85, -4.7);
  shape.lineTo(6.85, -5.8); shape.quadraticCurveTo(6.85, -6.85, 5.8, -6.85);
  shape.lineTo(4.7, -6.85); shape.quadraticCurveTo(0, -5.7, -4.7, -6.85);
  shape.closePath();
  circleHole(shape, 0, 0, 4.5);
  for (const x of [-5.25, 5.25]) for (const y of [-5.25, 5.25]) circleHole(shape, x, y, 0.8);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false, curveSegments: 32 });
  geo.rotateY(Math.PI / 2);
  return geo;
}
export function carouselBearingMeshes(scene, fitting) {
  const result = [];
  const rotation = new THREE.Quaternion(...(fitting.quat || [0, 0, 0, 1]));
  const origin = new THREE.Vector3(fitting.x, fitting.y, fitting.z);
  const add = (name, create, color, metalness, roughness, pos, localRotation) => {
    const geometry = scene._cachedGeo(`ucf209:${name}`, create);
    const key = `ucf209:${color}`;
    scene._materials[key] ||= new THREE.MeshStandardMaterial({ color, metalness, roughness });
    const mesh = new THREE.Mesh(geometry, scene._materials[key]);
    mesh.name = `ucf209:${name}`;
    mesh.position.fromArray(pos).applyQuaternion(rotation).add(origin);
    mesh.quaternion.copy(rotation);
    if (localRotation) mesh.quaternion.multiply(localRotation);
    mesh.castShadow = true; mesh.receiveShadow = true;
    result.push(mesh);
  };
  add('flange-four-holes', flange, '#526b4c', 0.25, 0.78, [6.12, 0, 0]);
  add('raised-housing', () => ring(5.4, 4.25, 2.2), '#526b4c', 0.25, 0.78, [3.92, 0, 0]);
  add('outer-race', () => ring(4.25, 3.68, 2.6), '#bec5c9', 0.8, 0.28, [3.62, 0, 0]);
  add('seal', () => ring(3.72, 3.03, 0.16), '#242a2b', 0.1, 0.8, [3.5, 0, 0]);
  add('inner-race-through-bore', () => ring(3.08, 2.25, 4.92), '#d1d5d7', 0.82, 0.24, [2.5, 0, 0]);
  for (const baseAngle of [0, Math.PI * 2 / 3]) {
    const angle = baseAngle + (fitting.params?.angle || 0) * Math.PI / 180;
    const direction = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle));
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    add(`set-screw:${baseAngle}`, () => new THREE.CylinderGeometry(0.27, 0.27, 0.3, 6), '#3a3e40', 0.7, 0.4,
      [3.05, direction.y * 3.03, direction.z * 3.03], quat);
  }
  add('grease-nipple', () => new THREE.CylinderGeometry(0.2, 0.32, 0.65, 6), '#b3ac86', 0.75, 0.32, [5.6, 5.58, 0]);
  if (fitting.params?.tieCount === 4) {
    for (const y of [-5.25, 5.25]) for (const z of [-5.25, 5.25]) {
      const r = Math.hypot(y, z), wy = -z / r, wz = y / r;
      const points = [[5.9, y, z]];
      for (let i = 0; i <= 12; i++) {
        const angle = i / 12 * Math.PI * 1.5, w = Math.sin(angle) * 2.8;
        points.push([10.17 - Math.cos(angle) * 2.8, y + wy * w, z + wz * w]);
      }
      points.push([5.9, y - wy * 2.8, z - wz * 2.8]);
      add(`tie:${y}:${z}`, () => {
        const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), true, 'centripetal');
        return new THREE.TubeGeometry(curve, 56, 0.14, 6, true);
      }, '#e7e1d3', 0, 0.85, [0, 0, 0]);
      add(`tie-lock:${y}:${z}`, () => new THREE.BoxGeometry(0.45, 0.75, 0.65), '#e7e1d3', 0, 0.85, [5.8, y, z]);
    }
  }
  return result;
}
