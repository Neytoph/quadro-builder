import { Box3, Color, DoubleSide, Matrix3, Matrix4, MeshStandardMaterial, OrthographicCamera, Vector3 } from 'three';
import { bomPartKey, computeBOM } from './bom.js';
import { getPartById, partName } from './catalog.js';
import { PALETTES } from './colors.js';
import { BuildModel, hingeKey } from './model.js';
import { SceneManager } from './scene.js';
import { waitSceneReady } from './thumbShot.js';

export const EXPLODED_VIEWS = ['frontRight', 'frontLeft', 'backLeft', 'backRight'];
const VIEW_WIDTH = 1488;
const VIEW_HEIGHT = 1040;
const SHEET_MARGIN = 48;
const VIEW_GAP = 24;
const VIEW_LABEL_HEIGHT = 56;
const WIDTH = 2 * (VIEW_WIDTH + SHEET_MARGIN) + VIEW_GAP;
const BACKGROUND = '#f7f6f3';
const VERTICAL = new Vector3(0, 1, 0);
const DETACH_DIRECTION = new Vector3(-1, .6, 1).normalize();
const DETACH_DISTANCE = { balls: 14, 'acrylic-glass': 7, reinforcement: 7, sleeve: 7 };
const [linen, sky, denim] = PALETTES.find(palette => palette.key === 'home-blue').colors;

// 每对颜色依次是空白底 B5 和草地 G5。
const PART_COLORS_BY_ID = {
  straight: ['#1699a6', '#55dde0'],
  elbow: ['#449d58', '#39d073'],
  t: ['#d39a12', '#ffd942'],
  cross: ['#9261c6', '#ab75e6'],
  '3way': ['#d84b4a', '#f44942'],
  '4way': ['#4d6fcb', '#414ab8'],
  '5way': ['#df8149', '#ef9351'],
  '6way': ['#bc6091', '#db82ad'],
  diagonal: ['#7b8a9c', '#9cabc3'],
  flexi: ['#b97930', '#d5a661'],
  flexi_hinge: ['#568b81', '#74ad98'],
  flexi_bolt: ['#aa645e', '#ce8276'],
  windmill: ['#a67ab3', '#c89fcf'],
  hole_t: ['#6177ba', '#8198d6'],
  hole_2: ['#9e8f3d', '#c4b55a'],
  hole_1: ['#bd7894', '#dca3b3'],
  bearing: ['#597a98', '#7c9db2'],
  double_tube: ['#738b62', '#96ae7e'],
  tube_clamp: ['#ab7854', '#c79976'],
  roof: ['#d8caa9', '#e76551'],
  roof_large: ['#d09d8f', '#c9907c'],
};
// 主体件占用原来的配色顺位，让其他规格保留预览里的搭配。
const MAIN_PART_COLORS_BY_ID = {
  T35: ['#ccd9e1', '#498ed0'],
  panel_40x40: ['#bdd3d8', '#ffda57'],
  textile: ['#cfd3d7', '#e5cf91'],
  slide_curved: ['#a2b9c4', '#74afab'],
  pool_liner_l: ['#c4cbcc', '#c9c2a4'],
};
const PART_COLORS = [
  ['#91bedc', linen], ['#a0cbd9', sky], ['#b3acd1', '#b8b3cd'],
  ['#caa987', '#c9ae8f'], ['#9fc3a8', '#a1bf9f'], ['#a1afc1', '#a0acbd'],
  ['#d2adba', '#c9a4b0'], ['#d2bd94', '#d8c49e'], ['#94c4bd', denim],
  ['#a8b7d7', '#9babca'], ['#d8b195', '#cc9c7d'], ['#b8c4ad', '#b6c2aa'],
];

// 沿用清单对规格和组合零件的识别，将同规格的原始颜色合并。
function specifications(model, labelOf) {
  const byPart = new Map();
  const bom = computeBOM(model, { locateParts: true });
  for (const group of ['tubes', 'connectors', 'panels', 'textiles', 'slides', 'fittings', 'reinforcements']) {
    for (const row of bom[group]) {
      const [id, variant] = (row.tubeId || row.type || row.panelId || row.id).split('|');
      let size = '';
      if (group === 'textiles' && row.w && row.h) size = `${row.w}×${row.h} cm`;
      else if (variant) size = `${variant} cm`;
      else if (group === 'fittings') size = row.key.split('|')[1] || '';
      const name = labelOf(id, partName(getPartById(id)) || row.name);
      const label = size && !name.includes(size.replace(/ cm$/, '')) ? `${name} ${size}` : name;
      const spec = { id, key: size ? `${id}|${size}` : id, label };
      for (const part of row.partIds) byPart.set(part, spec);
    }
  }
  return byPart;
}

function renderedParts(scene, model, labelOf, previewGroup) {
  const specs = specifications(model, labelOf);
  const parts = new Map();
  const shades = new Map();
  const group = previewGroup || scene.buildGroup;
  if (!previewGroup) group.traverse(mesh => {
    if (mesh.userData.role === 'water' && !mesh.isInstancedMesh) mesh.visible = false;
  });
  for (const [identity, record] of scene._indexParts(group.children)) {
    for (const piece of record.pieces) {
      const mesh = piece.obj;
      const data = piece.index >= 0 ? mesh.userData.instances[piece.index] : mesh.userData;
      if (!mesh.visible) continue;
      let role = data.bomRole;
      if (data.tubes?.length) role = 'reinforcement';
      if (data.role === 'water' && mesh.isInstancedMesh) role = 'balls';
      let id = record.id;
      if (data.hinge != null) id = hingeKey(id, data.hinge);
      else if (role) id = bomPartKey(id, role);
      const fallback = role === 'diagonal' ? 'diagonal'
        : model.panels.get(record.id)?.panelId || model.fittings.get(record.id)?.kind || 'end';
      const spec = specs.get(id) || { id: fallback, key: fallback, label: labelOf(fallback, partName(getPartById(fallback))) };
      if (!shades.has(spec.key)) shades.set(spec.key, { id: spec.id, label: spec.label, count: 0 });
      const key = `${identity}:${id}`;
      if (!parts.has(key)) {
        const shade = shades.get(spec.key);
        shade.count++;
        parts.set(key, {
          pieces: [], shade,
          lift: Object.hasOwn(DETACH_DISTANCE, role || fallback) ? DETACH_DISTANCE[role || fallback] : 0,
        });
      }
      parts.get(key).pieces.push(piece);
    }
  }
  const legend = [...shades.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, shade]) => shade);
  let rank = 0;
  for (const shade of [...legend].sort((a, b) => b.count - a.count)) {
    const fixed = Object.hasOwn(PART_COLORS_BY_ID, shade.id) ? PART_COLORS_BY_ID[shade.id] : null;
    const main = Object.hasOwn(MAIN_PART_COLORS_BY_ID, shade.id) ? MAIN_PART_COLORS_BY_ID[shade.id] : null;
    const i = rank;
    if (!fixed) rank++;
    const hue = (i * 137.508) % 360;
    const [light, bright] = fixed || main || PART_COLORS[i] || [
      `hsl(${hue}, 32%, ${i % 2 ? 59 : 73}%)`,
      `hsl(${hue}, 25%, ${i % 2 ? 61 : 76}%)`,
    ];
    shade.color = new Color(light);
    shade.bright = new Color(bright);
  }
  return { parts, legend };
}

function explodedOffsets(scene, parts, spread, keepFloor = false) {
  const center = new Box3();
  for (const part of parts.values()) {
    part.box = scene._piecesBox(part.pieces);
    // 球池的球组使用实例包围盒，球体几何只包含单颗球。
    const balls = part.pieces[0].obj;
    if (part.pieces[0].index < 0 && balls.isInstancedMesh) {
      balls.computeBoundingBox();
      part.box.copy(balls.boundingBox).applyMatrix4(balls.matrixWorld);
    }
    center.union(part.box);
  }
  const origin = center.getCenter(new Vector3());
  let lowest = Infinity;
  for (const part of parts.values()) {
    // 只拉开零件中心，套管、夹层等重叠的零件再侧移一点。
    part.offset = part.box.getCenter(new Vector3()).sub(origin).multiplyScalar(spread)
      .addScaledVector(DETACH_DIRECTION, part.lift);
    part.box.translate(part.offset);
    lowest = Math.min(lowest, part.box.min.y);
  }
  if (keepFloor && lowest < center.min.y) {
    // 展开时底部留在原高度，避免零件掉到地面或房间地板下面。
    const rise = new Vector3(0, center.min.y - lowest, 0);
    for (const { box, offset } of parts.values()) {
      box.translate(rise);
      offset.add(rise);
    }
  }
}

function spreadParts(scene, parts) {
  explodedOffsets(scene, parts, .72);
  const matrix = new Matrix4(), translation = new Matrix4();
  const materialFor = (color, vertexColors) => {
    const key = `exploded:${color.getHex()}:${vertexColors}`;
    return scene._materials[key] ||= new MeshStandardMaterial({
      color, roughness: .68, side: DoubleSide, vertexColors,
    });
  };
  const white = new Color('#fff');
  for (const { pieces, shade, offset } of parts.values()) {
    translation.makeTranslation(offset.x, offset.y, offset.z);
    for (const { obj, index, base, P, Pinv } of scene._bindPieces(pieces)) {
      matrix.multiplyMatrices(translation, P).premultiply(Pinv).multiply(base);
      if (index >= 0) {
        obj.material = materialFor(white, !!obj.geometry.getAttribute('color'));
        obj.setMatrixAt(index, matrix);
        obj.setColorAt(index, shade.color);
        obj.instanceColor.needsUpdate = true;
        obj.instanceMatrix.needsUpdate = true;
        obj.boundingBox = obj.boundingSphere = null;
      } else {
        obj.material = materialFor(shade.color, !!obj.geometry.getAttribute('color'));
        if (obj.isInstancedMesh) obj.instanceColor = null;
        matrix.decompose(obj.position, obj.quaternion, obj.scale);
      }
    }
  }
}

function frameParts(parts, index, aspect) {
  const camera = new OrthographicCamera();
  const direction = new Vector3(1, .85, 1.27).normalize().applyAxisAngle(VERTICAL, -index * Math.PI / 2);
  camera.position.copy(direction);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const view = new Box3(), box = new Box3();
  for (const part of parts.values()) view.union(box.copy(part.box).applyMatrix4(camera.matrixWorldInverse));
  const size = view.getSize(new Vector3());
  const center = view.getCenter(new Vector3()).applyMatrix4(camera.matrixWorld);
  const distance = size.z / 2 + 10;
  camera.position.copy(center).addScaledVector(direction, distance);
  const halfHeight = Math.max(size.y, size.x / aspect, 1) * .55;
  const halfWidth = halfHeight * aspect;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.far = size.z + 20;
  camera.updateProjectionMatrix();
  return camera;
}

function createSheet(name, title, legend, viewLabels) {
  const viewTop = 170;
  const rowHeight = VIEW_HEIGHT + VIEW_LABEL_HEIGHT + VIEW_GAP;
  const legendTop = viewTop + 2 * rowHeight;
  const columns = 4;
  const legendRowHeight = 52;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = legendTop + Math.ceil(legend.length / columns) * legendRowHeight + SHEET_MARGIN;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const font = '"Noto Sans SC", "PingFang SC", sans-serif';
  ctx.fillStyle = '#fffdf9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ba510e';
  ctx.font = `600 26px ${font}`;
  ctx.fillText(title, SHEET_MARGIN, 57, WIDTH - 2 * SHEET_MARGIN);
  ctx.fillStyle = '#1f2430';
  ctx.font = `700 50px ${font}`;
  ctx.fillText(name, SHEET_MARGIN, 125, WIDTH - 2 * SHEET_MARGIN);
  ctx.font = `600 30px ${font}`;
  const views = viewLabels.map((label, index) => {
    const x = SHEET_MARGIN + (index % 2) * (VIEW_WIDTH + VIEW_GAP);
    const y = viewTop + Math.floor(index / 2) * rowHeight;
    ctx.fillText(label, x + 14, y + 35, VIEW_WIDTH - 28);
    return { x, y: y + VIEW_LABEL_HEIGHT };
  });
  ctx.font = `400 32px ${font}`;
  const column = (WIDTH - 2 * SHEET_MARGIN) / columns;
  legend.forEach(({ color, label }, index) => {
    const x = SHEET_MARGIN + (index % columns) * column;
    const y = legendTop + 32 + Math.floor(index / columns) * legendRowHeight;
    ctx.fillStyle = `#${color.getHexString()}`;
    ctx.beginPath();
    ctx.arc(x + 12, y - 9, 12, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#1f2430';
    ctx.fillText(label, x + 36, y, column - 58);
  });
  return { canvas, ctx, views };
}

/** 导出用独立场景生成四个视角。 */
async function prepareExplodedScene(host, data, labelOf, signal) {
  signal?.throwIfAborted();
  const model = new BuildModel();
  const loaded = model.loadJSON(data);
  if (!loaded.ok) throw new Error(`Exploded view model: ${loaded.reason}`);
  const scene = new SceneManager(host);
  const dispose = () => {
    scene.dispose();
    scene.renderer.forceContextLoss();
  };
  try {
    scene.setMotion(false);
    scene.setTheme(false);
    scene.setBackground('blank');
    scene.onMeshesReady = () => scene.renderModel(model, null);
    scene.renderModel(model, null);
    if (!await waitSceneReady(scene, 20000, signal)) throw new Error('Exploded view meshes timed out');
    signal?.throwIfAborted();
    if (['_connMeshes', '_tubeMeshes', '_fitMeshes', '_surfMeshes', '_slideMeshes'].some(key => scene[key] === false)) {
      throw new Error('Exploded view meshes failed to load');
    }
    scene.renderModel(model, null);
    scene.onMeshesReady = () => {};
    const { parts, legend } = renderedParts(scene, model, labelOf);
    if (!parts.size) {
      dispose();
      return null;
    }
    spreadParts(scene, parts);
    scene.scene.background = new Color(BACKGROUND);
    scene._grid.visible = false;
    scene.setViewCubeEnabled(false);
    scene.renderer.shadowMap.enabled = false;
    scene.setPaused(true);
    return { scene, parts, legend, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

async function prepareDetachedExplodedScene(data, labelOf, signal) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:960px;height:620px;pointer-events:none';
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  try {
    return await prepareExplodedScene(host, data, labelOf, signal);
  } finally {
    host.remove();
  }
}

/** 同一个场景内借用当前网格和材质。只克隆绘制用的对象及实例缓冲，原来的模型、选择和截图仍用原网格。 */
export function createExplodedView(scene, model, labelOf) {
  if (!scene.buildGroup.visible) return null;
  let revision, preview;
  const dispose = () => {
    if (!preview) return;
    preview.group.removeFromParent();
    preview.group.traverse(obj => { if (obj.isInstancedMesh) obj.dispose(); });
    for (const material of preview.materials) material.dispose();
    preview = null;
  };
  const refresh = () => {
    if (revision === scene._modelRenderRevision && preview) return preview;
    dispose();
    revision = scene._modelRenderRevision;
    const group = scene.buildGroup.clone();
    scene.buildGroup.parent.add(group);
    preview = { group, materials: [] };
    try {
      const { parts } = renderedParts(scene, scene._renderModel || model, labelOf, group);
      if (!parts.size) { dispose(); return null; }
      explodedOffsets(scene, parts, .46, true);
      const sources = [];
      scene.buildGroup.traverse(obj => sources.push(obj));
      const sourceOf = new Map();
      let i = 0;
      group.traverse(obj => sourceOf.set(obj, sources[i++]));

      const bounds = new Box3();
      const boxes = [];
      const motions = new Map();
      const local = new Matrix3();
      for (const { box, pieces, offset, shade } of parts.values()) {
        boxes.push(box);
        bounds.union(box);
        for (const { obj, index } of pieces) {
          if (!motions.has(obj)) {
            motions.set(obj, { obj, source: sourceOf.get(obj), pieces: [] });
            obj.frustumCulled = false;
          }
          const parent = index < 0 ? obj.parent : obj;
          parent.updateWorldMatrix(true, false);
          const delta = offset.clone().applyMatrix3(local.setFromMatrix4(parent.matrixWorld).invert());
          // 水面属于场景装饰，随池体移动并保留本身的透明颜色。
          const tint = obj.userData.role === 'water' && !obj.isInstancedMesh ? null : shade;
          motions.get(obj).pieces.push({ index, delta, shade: tint });
        }
      }
      const white = new Color(0xffffff);
      for (const motion of motions.values()) {
        const { obj, source, pieces } = motion;
        if (!source.material.color || !pieces.some(piece => piece.shade)) continue;
        const material = source.material.clone();
        preview.materials.push(material);
        obj.material = material;
        const indexed = pieces[0].index >= 0;
        if (obj.isInstancedMesh && (indexed || source.instanceColor)) {
          material.color.copy(white);
          const initial = new Color();
          const byIndex = new Map(pieces.map(piece => [piece.index, piece.shade]));
          const colors = [];
          for (let index = 0; index < obj.count; index++) {
            if (source.instanceColor) source.getColorAt(index, initial);
            else initial.copy(white);
            initial.multiply(source.material.color);
            obj.setColorAt(index, initial);
            const shade = byIndex.get(indexed ? index : -1);
            if (shade) colors.push({ index, initial: initial.clone(), shade });
          }
          motion.colors = colors;
        }
        motion.tint = material;
      }
      Object.assign(preview, {
        motions, boxes,
        bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new Vector3()).toArray() },
      });
      return preview;
    } catch (error) {
      dispose();
      throw error;
    } finally {
      group.removeFromParent();
    }
  };

  const color = new Color();
  const pose = (view, spread, tint, grass) => {
    const palette = grass ? 'bright' : 'color';
    const recolor = view.lastTint !== tint || view.lastPalette !== palette;
    for (const { obj, source, pieces, colors, tint: material } of view.motions.values()) {
      const first = pieces[0];
      if (first.index < 0) {
        obj.position.copy(source.position).addScaledVector(first.delta, spread);
        obj.quaternion.copy(source.quaternion);
        obj.scale.copy(source.scale);
      } else {
        const matrices = obj.instanceMatrix.array;
        matrices.set(source.instanceMatrix.array);
        for (const { index, delta } of pieces) {
          const translation = index * 16 + 12;
          matrices[translation] += delta.x * spread;
          matrices[translation + 1] += delta.y * spread;
          matrices[translation + 2] += delta.z * spread;
        }
        obj.instanceMatrix.needsUpdate = true;
      }
      if (!recolor) continue;
      if (colors) {
        for (const { index, initial, shade } of colors) obj.setColorAt(index, color.copy(initial).lerp(shade[palette], tint));
        obj.instanceColor.needsUpdate = true;
      } else if (material) material.color.copy(source.material.color).lerp(first.shade[palette], tint);
    }
    view.lastTint = tint;
    view.lastPalette = palette;
  };
  if (!refresh()) return null;
  return { refresh, pose, dispose };
}

/** 将四个视角和共用图例导出为一张 PNG。 */
export async function renderExplodedView(data, { name, title, viewLabels, labelOf, signal }) {
  const prepared = await prepareDetachedExplodedScene(data, labelOf, signal);
  if (!prepared) return null;
  try {
    const { scene, parts, legend } = prepared;
    await document.fonts.load('400 32px "Noto Sans SC"', name + title + viewLabels.join('') + legend.map(item => item.label).join(''));
    signal?.throwIfAborted();
    scene.renderer.setPixelRatio(1);
    scene.renderer.setSize(VIEW_WIDTH, VIEW_HEIGHT, false);
    const { canvas, ctx, views } = createSheet(name, title, legend, viewLabels);
    for (const [index, { x, y }] of views.entries()) {
      const camera = frameParts(parts, index, VIEW_WIDTH / VIEW_HEIGHT);
      scene.renderer.render(scene.scene, camera);
      ctx.drawImage(scene.renderer.domElement, x, y);
    }
    return await new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Exploded view PNG encoding failed')), 'image/png',
    ));
  } finally {
    prepared.dispose();
  }
}
