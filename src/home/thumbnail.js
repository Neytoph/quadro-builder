import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createHomeVisuals, HOME_STYLE, furnitureRotation } from './visuals.js';

const visuals = createHomeVisuals(THREE, RoundedBoxGeometry), cache = new Map();
let renderer, failure, scheduled = false;
const jobs = new Set();

export function normalizeRoomPreview(data) {
  const room = data?.room, items = data?.items;
  if (!room || !['w', 'h', 'd'].every(key => Number.isFinite(room[key]) && room[key] > 0 && room[key] <= 2000) || !Array.isArray(items) || items.length > 61) throw new Error('Invalid room preview');
  return { room: { w: room.w, h: room.h, d: room.d }, items: items.map(item => {
    if (!item || !['furniture', 'reserved', 'usable'].includes(item.kind) || !['x', 'z', 'w', 'd', 'h', 'elevation'].every(key => Number.isFinite(item[key])) || item.w <= 0 || item.d <= 0 || item.h <= 0 || item.elevation < 0 || item.x < 0 || item.z < 0 || item.x + item.w > room.w || item.z + item.d > room.d || item.elevation + item.h > room.h || (item.rotation !== undefined && ![0, 90, 180, 270].includes(item.rotation))) throw new Error('Invalid room preview item');
    return { type: item.type, kind: item.kind, x: item.x, z: item.z, w: item.w, d: item.d, h: item.h, elevation: item.elevation, rotation: furnitureRotation(item) };
  }) };
}

function getRenderer() {
  if (failure) throw failure;
  if (!renderer) {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(1); renderer.setClearColor(0, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = HOME_STYLE.exposure;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); failure = new Error('Room preview WebGL context lost'); cache.clear(); });
    } catch (error) { failure = error; throw error; }
  }
  return renderer;
}

function release(root) {
  const materials = new Set();
  root.traverse(object => { object.geometry?.dispose(); object.shadow?.dispose(); if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); });
  for (const material of materials) material.dispose();
  root.clear();
}

export function fitRoomPreview(camera, root, room, aspect) {
  const size = Math.max(room.w, room.d, room.h), target = new THREE.Vector3(room.w / 2, room.h * .35, room.d / 2);
  camera.position.copy(target).add(new THREE.Vector3(1.2, 1.05, 1.5).multiplyScalar(size * 3));
  camera.lookAt(target); camera.updateMatrixWorld(true); root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), projected = new THREE.Box3();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
  const halfH = Math.max((projected.max.y - projected.min.y) / 2, (projected.max.x - projected.min.x) / (2 * aspect)) * 1.08, cx = (projected.min.x + projected.max.x) / 2, cy = (projected.min.y + projected.max.y) / 2;
  camera.left = cx - halfH * aspect; camera.right = cx + halfH * aspect; camera.top = cy + halfH; camera.bottom = cy - halfH;
  camera.near = 1; camera.far = size * 20; camera.updateProjectionMatrix();
}

export function captureRoomThumbnail(data, width = 960) {
  const state = normalizeRoomPreview(data), size = width === 160 ? 160 : 960, key = JSON.stringify([size, state]);
  if (cache.has(key)) { const image = cache.get(key); cache.delete(key); cache.set(key, image); return image; }
  const output = getRenderer(), scene = new THREE.Scene(), root = new THREE.Group(), camera = new THREE.OrthographicCamera();
  scene.add(root);
  try {
    root.add(visuals.roomShell(state.room));
    for (const item of state.items) {
      const group = item.kind === 'furniture' ? visuals.furniture(item.type, item.d > item.w, item.rotation) : visuals.zone(item);
      group.position.set(item.x, item.elevation, item.z); group.scale.set(item.w, item.h, item.d); root.add(group);
    }
    const light = visuals.lighting(); scene.add(light); light.userData.sun.shadow.mapSize.set(1024, 1024); visuals.fitLighting(light.userData.sun, state.room);
    fitRoomPreview(camera, root, state.room, 4 / 3);
    output.setSize(size, size * 3 / 4, false); output.render(scene, camera);
    const image = output.domElement.toDataURL('image/png'); cache.set(key, image);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    return image;
  } finally { release(scene); output.renderLists.dispose(); }
}

function enqueue(job) {
  jobs.add(job);
  if (scheduled) return;
  scheduled = true;
  const run = () => { scheduled = false; const next = jobs.values().next().value; if (next) { jobs.delete(next); next(); } if (jobs.size) enqueue(jobs.values().next().value); };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 300 }); else requestAnimationFrame(run);
}

export function registerRoomThumbnails() {
  if (customElements.get('xmf-room-preview')) return;
  class RoomPreview extends HTMLElement {
    static get observedAttributes() { return ['data-room', 'size']; }
    constructor() {
      super(); this.version = 0;
      const shadow = this.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<style>:host{display:block;width:100%;height:100%;min-width:0;aspect-ratio:4/3}img{display:block;width:100%;height:100%;object-fit:contain}span{display:grid;place-items:center;width:100%;height:100%;color:#5a6270;font:12px/1.5 sans-serif;text-align:center}img[hidden],span[hidden]{display:none}</style><img alt="" draggable="false" hidden><span>3D</span>';
      this.image = shadow.querySelector('img'); this.status = shadow.querySelector('span');
    }
    connectedCallback() {
      this.observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { this.observer.disconnect(); this.visible = true; this.queue(); } }, { rootMargin: '120px' });
      this.observer.observe(this);
    }
    disconnectedCallback() { this.version++; this.observer?.disconnect(); jobs.delete(this.job); }
    attributeChangedCallback() { this.version++; if (this.isConnected && this.visible) this.queue(); }
    queue() {
      jobs.delete(this.job); const version = this.version, raw = this.getAttribute('data-room');
      this.dataset.state = 'loading'; this.image.hidden = true; this.status.hidden = false; this.status.textContent = '3D';
      this.job = () => {
        if (!this.isConnected || version !== this.version) return;
        try {
          const image = captureRoomThumbnail(JSON.parse(raw), Number(this.getAttribute('size')));
          if (!this.isConnected || version !== this.version) return;
          this.image.src = image; this.image.hidden = false; this.status.hidden = true; this.dataset.state = 'ready';
        } catch (error) {
          console.warn('Room 3D preview unavailable', error); this.dataset.state = 'error';
          const lang = document.documentElement.lang; this.status.textContent = lang.startsWith('de') ? '3D-Vorschau nicht verfügbar' : lang.startsWith('en') ? '3D preview unavailable' : '三维预览暂不可用';
        }
      };
      enqueue(this.job);
    }
  }
  customElements.define('xmf-room-preview', RoomPreview);
  document.addEventListener('qh-identity', () => cache.clear());
  window.addEventListener('quadro-account-invalidated', () => cache.clear());
}
