import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { geometry } from './catalog.js';

const PALETTES = {
  grass: { available: new THREE.Color('#fff7df'), hot: new THREE.Color('#ffffff') },
  home: { available: new THREE.Color('#9a451c'), hot: new THREE.Color('#ed7929') },
};
const ORANGE = new THREE.Color('#f88929');

// 安装提示独立于零件材质，只画通过场景深度检查的可见部分。
export class PanelPlacementGuides {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'panel-placement-guides';
    this.group.visible = false;
    scene.add(this.group);
    const geo = new LineSegmentsGeometry();
    this.lines = new LineSegments2(geo, new LineMaterial({
      linewidth: 2, vertexColors: true, transparent: true, opacity: .95, depthWrite: false, toneMapped: false,
    }));
    this.lines.renderOrder = 1001;
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    this.rails = [];
    this.focusId = null;
    this.hoverId = null;
    this.dirty = true;
    this.wasMoving = false;
    this.background = null;
    this.cameraMatrix = new THREE.Matrix4();
  }

  setRails(model, ids, focusId) {
    const { connectorSize, tubeRadius } = geometry();
    this.rails = [];
    for (const id of ids || []) {
      const tube = model.tubes.get(id);
      if (!tube || tube.arm || tube.link || tube.bow) continue;
      const a = model.nodes.get(tube.a), b = model.nodes.get(tube.b);
      if (!a || !b) continue;
      const start = new THREE.Vector3(a.x, a.y, a.z), end = new THREE.Vector3(b.x, b.y, b.z);
      if (tube.geom?.p0 && tube.geom.dir) {
        start.fromArray(tube.geom.p0);
        end.copy(start).addScaledVector(new THREE.Vector3(...tube.geom.dir), tube.geom.len + (tube.geom.pad || 0) + connectorSize);
      }
      const dir = end.clone().sub(start).normalize();
      const len = tube.geom?.len ? tube.geom.len + (tube.geom.pad || 0) : Math.max(1, start.distanceTo(end) - connectorSize);
      const mid = start.add(end).multiplyScalar(.5);
      this.rails.push({ id, mid, dir, len, radius: tubeRadius + .18 });
    }
    this.focusId = focusId;
    this.hoverId = null;
    this.group.visible = this.rails.length > 0;
    this.dirty = true;
  }

  setHover(id) {
    if (id === this.hoverId) return false;
    this.hoverId = id;
    this.dirty = true;
    return true;
  }

  update(camera, poses, background = 'grass') {
    if (!this.rails.length) return;
    camera.updateMatrixWorld();
    const paletteKey = background === 'grass' ? 'grass' : 'home';
    const moving = this.rails.some(rail => poses?.has(`tube:${rail.id}`));
    if (!this.dirty && !moving && !this.wasMoving && this.background === paletteKey && this.cameraMatrix.equals(camera.matrixWorld)) return;
    this.wasMoving = moving;
    this.background = paletteKey;
    const palette = PALETTES[paletteKey];
    this.cameraMatrix.copy(camera.matrixWorld);
    this.dirty = false;
    const positions = [], colors = [];
    for (const rail of this.rails) {
      const pose = poses?.get(`tube:${rail.id}`);
      const scale = pose?.scale ?? 1;
      const mid = rail.mid.clone();
      if (pose) mid.sub(pose.center).multiplyScalar(scale).add(pose.center).add(new THREE.Vector3(0, pose.dy ?? 0, 0));
      const view = camera.isOrthographicCamera
        ? camera.getWorldDirection(new THREE.Vector3()).negate() : camera.position.clone().sub(mid).normalize();
      const side = new THREE.Vector3().crossVectors(rail.dir, view);
      if (side.lengthSq() < .00001) side.set(1, 0, 0).applyQuaternion(camera.quaternion);
      side.normalize().multiplyScalar(rail.radius * scale);
      // 向镜头略微偏移，避免轮廓与低精度管壁共面闪烁。
      mid.addScaledVector(view, .06 * scale);
      const ends = [-1, 1].map(sign => mid.clone().addScaledVector(rail.dir, sign * rail.len * scale / 2));
      const corners = [ends[0].clone().add(side), ends[1].clone().add(side), ends[1].clone().sub(side), ends[0].clone().sub(side)];
      let color = palette.available;
      if (rail.id === this.focusId) color = ORANGE;
      else if (rail.id === this.hoverId) color = palette.hot;
      for (let i = 0; i < 4; i++) for (const point of [corners[i], corners[(i + 1) % 4]]) {
        positions.push(...point.toArray()); colors.push(color.r, color.g, color.b);
      }
    }
    const current = this.lines.geometry;
    const position = current.getAttribute('instanceStart');
    if (position?.data.array.length === positions.length) {
      position.data.array.set(positions); position.data.needsUpdate = true;
      const color = current.getAttribute('instanceColorStart');
      color.data.array.set(colors); color.data.needsUpdate = true;
    } else {
      current.dispose();
      const geo = new LineSegmentsGeometry().setPositions(positions).setColors(colors);
      this.lines.geometry = geo;
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.lines.geometry.dispose();
    this.lines.material.dispose();
  }
}
