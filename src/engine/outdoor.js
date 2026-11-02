import { shadeHex, hexRgba, DEFAULT_TUNE, DEFAULT_GRADE, gradeHex } from './colorTune.js';

// Builder 与 AI 相纸共用风景构造；THREE 由调用方传入，避免跨入口重复实例。
export const OUTDOOR_AREA = 2600;
export function createOutdoorVisuals(THREE) {
  function style() {
    return Object.fromEntries(Object.entries(DEFAULT_TUNE.scene).map(([key, value]) =>
      [key, typeof value === 'string' ? gradeHex(value, DEFAULT_GRADE) : value]));
  }
  function grassTexture(base = DEFAULT_TUNE.scene.grass) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const ctx = cv.getContext('2d'); ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
    let seed = 42;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    const patches = [shadeHex(base, -14), shadeHex(base, 10), shadeHex(base, -22), shadeHex(base, 6)];
    ctx.globalAlpha = .26;
    for (let i = 0; i < 32; i++) {
      const x = rng() * 256, y = rng() * 256, r = 28 + rng() * 56;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, patches[i % patches.length]); gradient.addColorStop(1, hexRgba(shadeHex(base, -18), 0));
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = .1;
    for (let i = 0; i < 380; i++) {
      const x = rng() * 256, y = rng() * 256;
      ctx.fillStyle = i % 2 ? shadeHex(base, 14) : shadeHex(base, -16); ctx.fillRect(x, y, 1.4, 1.4);
    }
    ctx.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(cv); texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(OUTDOOR_AREA / 80, OUTDOOR_AREA / 80); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    return texture;
  }
  function grass({ area = OUTDOOR_AREA, base = DEFAULT_TUNE.scene.grass } = {}) {
    const group = new THREE.Group(); group.name = 'grass-env';
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(area, area), new THREE.MeshLambertMaterial({ map: grassTexture(base) }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -2.9; ground.receiveShadow = true; group.add(ground);
    return { group, ground };
  }
  function sky(colors = DEFAULT_TUNE.scene) {
    const material = new THREE.ShaderMaterial({
      vertexShader: `varying float vY; void main(){vY=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform vec3 uHorizon;uniform vec3 uZenith;varying float vY;void main(){float t=clamp(vY*2.5+0.10,0.0,1.0);gl_FragColor=vec4(mix(uHorizon,uZenith,t*t),1.0);}`,
      uniforms: { uHorizon: { value: new THREE.Color(colors.skyHorizon) }, uZenith: { value: new THREE.Color(colors.skyZenith) } },
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(4800, 16, 10), material); mesh.renderOrder = -1;
    return mesh;
  }
  function trees(colors = DEFAULT_TUNE.scene) {
    const materials = [colors.trunk, colors.crownA, colors.crownB, colors.crownC].map(color => new THREE.MeshLambertMaterial({ color }));
    const geometries = [new THREE.CylinderGeometry(8, 13, 100, 7), new THREE.SphereGeometry(120, 8, 6), new THREE.SphereGeometry(100, 7, 5), new THREE.SphereGeometry(85, 7, 5)];
    const group = new THREE.Group(), nodes = [];
    let seed = 137; const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    for (let i = 0; i < 72; i++) {
      const r = 640 + rng() * 540, angle = rng() * Math.PI * 2, x = Math.cos(angle) * r, z = Math.sin(angle) * r;
      if (Math.abs(x) > 1290 || Math.abs(z) > 1290) continue;
      const scale = .65 + rng() * .7, ox2 = (rng() - .5) * 56, oz2 = (rng() - .5) * 56, ox3 = (rng() - .5) * 46, oz3 = (rng() - .5) * 46;
      const tree = new THREE.Group(); tree.position.set(x, 0, z); tree.scale.setScalar(scale); tree.rotation.y = rng() * Math.PI * 2;
      const positions = [[0, 50, 0], [0, 175, 0], [ox2, 210, oz2], [ox3, 195, oz3]];
      positions.forEach((position, index) => { const mesh = new THREE.Mesh(geometries[index], materials[index]); mesh.position.set(...position); mesh.castShadow = true; tree.add(mesh); });
      group.add(tree); nodes.push({ group: tree, x, z });
    }
    return { group, nodes, materials };
  }
  function bushes(colors = DEFAULT_TUNE.scene) {
    const geometry = new THREE.SphereGeometry(30, 8, 6), material = new THREE.MeshLambertMaterial({ color: colors.bush });
    const group = new THREE.Group(), nodes = [];
    let seed = 138; const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    for (let i = 0; i < 40; i++) {
      const r = 580 + rng() * 620, angle = rng() * Math.PI * 2, x = Math.cos(angle) * r, z = Math.sin(angle) * r;
      if (Math.abs(x) > 1290 || Math.abs(z) > 1290) continue;
      const bush = new THREE.Group(); bush.position.set(x, 0, z); bush.scale.setScalar(.5 + rng() * .5); bush.rotation.y = rng() * Math.PI * 2;
      const mesh = new THREE.Mesh(geometry, material); mesh.position.y = 15; mesh.castShadow = true; bush.add(mesh);
      group.add(bush); nodes.push({ group: bush, x, z });
    }
    return { group, nodes, material };
  }
  return { style, grassTexture, grass, sky, trees, bushes };
}
