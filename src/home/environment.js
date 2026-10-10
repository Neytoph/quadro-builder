import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { validHomeContext } from './context.js';

function furniture(i) {
  const root = new THREE.Group(), shape = new THREE.Group(); root.add(shape);
  const materials = new Map();
  const part = (color, size, position, round = false) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .83 }));
    const geometry = round ? new RoundedBoxGeometry(...size, 2, .025) : new THREE.BoxGeometry(...size);
    const mesh = new THREE.Mesh(geometry, materials.get(color)); mesh.position.set(...position); mesh.receiveShadow = true; shape.add(mesh);
  };
  const oak = '#b99060', pale = '#d4b184';
  if (i.type === 'cabinet') {
    for (const x of [.09, .91]) for (const z of [.12, .88]) part('#795841', [.055, .07, .08], [x, .035, z]);
    part(oak, [.93, .84, .035], [.5, .535, .0175]);
    for (const x of [.0175, .9825]) part(oak, [.035, .93, 1], [x, .535, .5]);
    for (const y of [.0925, .9775]) part(oak, [1, .045, 1], [.5, y, .5]);
    for (const x of [.265, .735]) part(pale, [.45, .83, .035], [x, .535, .9625]);
    for (const x of [.46, .54]) part('#6d563b', [.013, .105, .02], [x, .57, .99]);
  } else if (i.type === 'sofa') {
    part('#d9b486', [.94, .25, .94], [.5, .235, .5], true);
    part('#d9b486', [.96, .66, .15], [.5, .67, .075], true);
    for (const x of [.06, .94]) part('#d9b486', [.12, .56, .9], [x, .53, .55], true);
    for (const x of [.295, .705]) part('#eee0c3', [.395, .16, .72], [x, .44, .59], true);
    if (i.w < i.d) { shape.rotation.y = Math.PI / 2; shape.position.z = 1; }
  } else if (i.type === 'table' || i.type === 'bed') {
    const bed = i.type === 'bed';
    for (const x of [.1, .9]) for (const z of [.12, .88]) part(oak, [.075, bed ? .3 : .85, .075], [x, bed ? .15 : .425, z]);
    part(pale, [1, bed ? .24 : .12, 1], [.5, bed ? .32 : .94, .5], true);
    if (bed) { part('#f3e8d5', [.94, .26, .91], [.5, .57, .53], true); part(pale, [1, .84, .055], [.5, .58, .0275]); part('#a9bda3', [.95, .06, .57], [.5, .73, .715], true); }
  } else part(i.type === 'column' ? '#d9d1c6' : '#b8c1b3', [1, 1, 1], [.5, .5, .5]);
  root.position.set(i.x, i.elevation, i.z); root.scale.set(i.w, i.h, i.d); return root;
}

export function disposeHome(group) {
  if (!group) return;
  const materials = new Set();
  group.traverse(o => { o.geometry?.dispose(); if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); });
  for (const m of materials) m.dispose(); group.removeFromParent();
}

export function createHomeEnvironment(context) {
  if (!validHomeContext(context)) throw new Error('Invalid home context');
  const root = new THREE.Group(), { room: r, items } = context.snapshot;
  root.name = 'my-home-environment';
  const solid = (size, position, color) => { const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 1 })); m.position.set(...position); m.receiveShadow = true; root.add(m); return m; };
  solid([r.w, 1, r.d], [r.w / 2, -.6, r.d / 2], '#eee6d7');
  const walls = [solid([r.w, r.h, 2], [r.w / 2, r.h / 2, -1], '#e4dfd5'), solid([2, r.h, r.d], [-1, r.h / 2, r.d / 2], '#e4dfd5')];
  for (const i of items) {
    if (i.kind === 'furniture') { root.add(furniture(i)); continue; }
    const color = i.kind === 'usable' ? '#6b9e6f' : '#cf8b49', geometry = new THREE.BoxGeometry(i.w, i.h, i.d);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .09, depthWrite: false, side: THREE.DoubleSide }));
    mesh.position.set(i.x + i.w / 2, i.elevation + i.h / 2, i.z + i.d / 2); root.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .65 })); edges.position.copy(mesh.position); root.add(edges);
  }
  const p = context.placement;
  if (p) {
    root.matrixAutoUpdate = false;
    root.matrix.makeTranslation(...p.pivot).multiply(new THREE.Matrix4().makeRotationY(-p.rotation * Math.PI / 180)).multiply(new THREE.Matrix4().makeTranslation(...p.position.map(n => -n)));
  }
  root.updateMatrixWorld(true);
  root.userData.updateWalls = camera => { const local = root.worldToLocal(camera.getWorldPosition(new THREE.Vector3())); walls[0].visible = local.z >= 0; walls[1].visible = local.x >= 0; };
  root.userData.frame = { center: root.localToWorld(new THREE.Vector3(r.w / 2, r.h * .25, r.d / 2)), size: Math.max(r.w, r.d, r.h) };
  return root;
}
