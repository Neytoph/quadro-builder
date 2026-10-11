import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { validHomeContext } from './context.js';
import { createHomeVisuals } from './visuals.js';

const visuals = createHomeVisuals(THREE, RoundedBoxGeometry);

export function setHomeZonesVisible(root, { obstacles = true, usable = true }) {
  for (const object of root.children) {
    const kind = object.userData.homeItemKind;
    if (kind === 'usable') object.visible = usable;
    else if (kind === 'reserved') object.visible = obstacles;
  }
}

export function disposeHome(group) {
  if (!group) return;
  const materials = new Set();
  group.traverse(o => { o.geometry?.dispose(); o.shadow?.dispose(); if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); });
  for (const m of materials) m.dispose(); group.removeFromParent();
}

export function createHomeEnvironment(context) {
  if (!validHomeContext(context)) throw new Error('Invalid home context');
  const root = new THREE.Group(), { room: r, items } = context.snapshot;
  root.name = 'my-home-environment';
  const shell = visuals.roomShell(r), lights = visuals.lighting();
  root.add(shell, lights);
  for (const i of items) {
    const object = i.kind === 'furniture' ? visuals.furniture(i.type, i.d > i.w) : visuals.zone(i);
    object.name = i.name; object.userData.homeItemId = i.id; object.userData.homeItemKind = i.kind;
    object.position.set(i.x, i.elevation, i.z); object.scale.set(i.w, i.h, i.d); root.add(object);
  }
  const p = context.placement;
  if (p) {
    root.matrixAutoUpdate = false;
    root.matrix.makeTranslation(...p.pivot).multiply(new THREE.Matrix4().makeRotationY(-p.rotation * Math.PI / 180)).multiply(new THREE.Matrix4().makeTranslation(...p.position.map(n => -n)));
  }
  root.updateMatrixWorld(true);
  visuals.fitLighting(lights.userData.sun, r, root);
  root.userData.updateWalls = camera => {
    const local = root.worldToLocal(camera.getWorldPosition(new THREE.Vector3()));
    for (const object of shell.children) if (object.userData.wall) object.visible = local[object.userData.wall] >= 0;
  };
  root.userData.frame = { center: root.localToWorld(new THREE.Vector3(r.w / 2, r.h * .25, r.d / 2)), size: Math.max(r.w, r.d, r.h) };
  return root;
}
