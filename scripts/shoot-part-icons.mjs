// 零件图标：每种零件单独渲染成透明底 PNG，放进 public/parts/<零件 id>.png，
// 并生成 src/ui/partImages.ts（哪些零件有图）。菜单和料表有图用图，没图退回 SVG。
// 官方造型里出现过的零件，从 public/qdf 里挑第一件；没出现过的，现场搭个小场景。
// 零件网格改了就重跑一遍（仓库不带 playwright，装在别处就用 PLAYWRIGHT_CORE 指过去）：
//   pnpm dev --port 5199            # 另开一个终端；别的端口用 BASE=http://127.0.0.1:<端口>/
//   npm i --no-save playwright-core && node scripts/shoot-part-icons.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core')

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public/parts')
const QDF_DIR = path.join(ROOT, 'public/qdf')
fs.mkdirSync(OUT, { recursive: true })
const qdfs = fs.readdirSync(QDF_DIR).filter(f => f.endsWith('.qdf')).sort()
const SIZE = 256   // 渲染尺寸；存盘时缩到 OUT_SIZE，边缘更干净
const OUT_SIZE = 128
const TUBE_FRAME = 20   // 管子取景半径（cm）：映射后最长的 75 cm 管正好撑满

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {})
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, locale: 'zh-CN', deviceScaleFactor: 1 })
await ctx.addInitScript(() => { localStorage.setItem('quadro.builder.onboarded.v2', '1') })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('pageerror', e.message))
await page.goto(process.env.BASE || 'http://127.0.0.1:5199/', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__quadroDev, null, { timeout: 30000 })
await page.waitForTimeout(1500)

// 1. 扫官方造型的料表，每种零件记第一次出现的位置
const items = await page.evaluate(async (files) => {
  const api = await import('/src/engine-api.ts')
  await api.loadCatalog()
  const found = new Map()
  for (const f of files) {
    const txt = await (await fetch(`/qdf/${f}`)).text()
    const data = api.parseDesign(txt)
    if (!data) continue
    const m = new api.BuildModel()
    if (!m.loadJSON(data).ok) continue
    const bom = api.computeBOM(m)
    for (const [group, rows] of Object.entries(bom)) {
      if (!Array.isArray(rows)) continue
      for (const r of rows) {
        if (!r || group === 'screws') continue
        const rid = r.tubeId || r.type || r.panelId || r.id
        if (!rid) continue
        const size = ''
        const key = `${group}:${rid}${size ? ':' + size : ''}`
        if (found.has(key)) continue
        found.set(key, { key, group, rid, kind: r.kind, w: r.w, h: r.h, name: r.name, qdf: f })
      }
    }
  }
  // 官方造型里没有的：借一块现成的件换 id 再画
  const swaps = [
    ['panels', 'panel_40x40', ['hole_panel_40x40', 'acrylic_panel_40x40', 'panel_40x40_lego', 'panel_40x40_honeycomb', 'panel_40x40_busy', 'panel_40x40_felt', 'panel_40x40_magnet', 'panel_40x40_climbing', 'panel_40x40_sensory', 'panel_40x40_pocket', 'panel_40x40_basin']],
    ['tubes', 'T35', ['TS4', 'TS5', 'TS6']],
    ['tubes', 'T15', ['TS1', 'TS2', 'TS3']],
  ]
  for (const [group, from, tos] of swaps) {
    const src = found.get(`${group}:${from}`)
    if (!src) continue
    for (const to of tos) {
      const key = `${group}:${to}`
      if (found.has(key)) continue
      found.set(key, { key, group, rid: to, swapFrom: from, name: to, qdf: src.qdf })
    }
  }
  // 官方造型里一次都没出现过的：现场搭一个小场景
  const recipes = [
    ['connectors', '6way'], ['tubes', 'T52'], ['panels', 'panel_30x30'],
    ['connectors', 'hole_1'], ['connectors', 'hole_2'], ['connectors', 'hole_t'], ['connectors', 'bearing'],
    ['connectors', 'flexi_bolt'], ['connectors', 'flexi_hinge'], ['connectors', 'flexi'],
    ['fittings', 'lattice'], ['textiles', 'textile_rainbow'], ['textiles', 'textile_bridge'], ['fittings', 'sleeve'],
    ['fittings', 'pool_liner_xs'], ['fittings', 'pool_liner_s'], ['fittings', 'balls'],
    ['fittings', 'wheel_floating'], ['fittings', 'hub_cap'], ['fittings', 'roof_large'],
  ]
  for (const [group, rid] of recipes) {
    const key = `${group}:${rid}`
    found.set(key, { key, group, rid, recipe: rid, name: rid })
  }
  return [...found.values()]
}, qdfs)
const names = await page.evaluate(async () => (await import('/src/names.ts')).PART_ZH)
for (const it of items) if (names[it.rid]) it.name = names[it.rid]
console.log('零件种类', items.length)

// 2. 逐件渲染
const index = []
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f))
for (const it of items) {
  const res = await page.evaluate(async ({ it, SIZE, OUT_SIZE, TUBE_FRAME }) => { try {
    const api = await import('/src/engine-api.ts')
    const { scene, model, builder } = window.__quadroDev
    const three = performance.getEntriesByType('resource').map(e => e.name).find(n => /\/deps\/three\.js/.test(n))
    const THREE = await import(three)
    let data, recipeIds = null
    if (it.recipe) {
      const POOL_SETS = api.POOL_SETS
      const cat = await import('/src/engine/catalog.js')
      await cat.loadCatalog()
      const m = new api.BuildModel()
      const node = (x, y, z) => m.addNode(x, y, z)
      const tube = (a, b, id = 'T35', len = 35) => m.addTube(a.id, b.id, id, 'red', len)
      const cells = () => {
        const a = node(0, 0, 0), b = node(40, 0, 0), c = node(0, 0, 40), d = node(40, 0, 40)
        const r0 = tube(a, c), r1 = tube(b, d); tube(a, b); tube(c, d)
        return [r0, r1]
      }
      const cube = () => {
        const n = {}
        for (const x of [0, 40]) for (const y of [0, 40]) for (const z of [0, 40]) n[`${x},${y},${z}`] = node(x, y, z)
        for (const [k, v] of Object.entries(n)) {
          const [x, y, z] = k.split(',').map(Number)
          for (const [dx, dy, dz] of [[40, 0, 0], [0, 40, 0], [0, 0, 40]]) { const o = n[`${x + dx},${y + dy},${z + dz}`]; if (o) tube(v, o) }
        }
        const stub = node(80, 40, 40); tube(n['40,40,40'], stub)
        return n
      }
      const one = (x) => (x && x.id ? [x.id] : [])
      const r = it.recipe
      let ids = []
      if (r === '6way') { const c = node(0, 0, 0); for (const d of [[40,0,0],[-40,0,0],[0,40,0],[0,-40,0],[0,0,40],[0,0,-40]]) tube(c, node(...d)); ids = [c.id] }
      else if (r === 'T52') ids = one(tube(node(0, 0, 0), node(57, 0, 0), 'T52', 52))
      else if (r === 'panel_30x30') {
        const a = node(0, 0, 0), b = node(30, 0, 0), c = node(0, 0, 30), d = node(30, 0, 30)
        const r0 = tube(a, c, 'T25', 25), r1 = tube(b, d, 'T25', 25); tube(a, b, 'T25', 25); tube(c, d, 'T25', 25)
        ids = one(m.addPanel(r0.id, r1.id, 0, 30, 'panel_30x30', 'red', 1))
      } else if (r.startsWith('hole_')) { cube(); const mt = m.holeArmMounts()[0]; if (mt) ids = one(m.addHoleClamp(mt.nodeId, mt.dir, r)) }
      else if (r === 'bearing') { cube(); const mt = m.bearingArmMounts()[0]; if (mt) ids = one(m.addBearingAtArm(mt.nodeId, mt.dir)) }
      else if (r.startsWith('flexi')) {
        cube(); const mt = m.boltMounts()[0]
        if (mt && m.addBolt(mt.nodeId)) {
          if (r !== 'flexi_bolt') m.addHinge(mt.nodeId)
          if (r === 'flexi') m.addHinge(mt.nodeId)
          ids = [mt.nodeId]
        }
      } else if (r === 'lattice') { const [a, b] = cells(); ids = one(m.addLattice(a.id, b.id, 0, 40, 'green')) }
      else if (r.startsWith('textile_')) { const [a, b] = cells(); const t = m.addTextile(a.id, b.id, 0, 40, 'red'); if (t) { t.variant = r.slice(8); ids = [t.id] } }
      else if (r === 'sleeve') { const [a] = cells(); const f = m.addFitting('sleeve', 0, 0, 0, { color: 'green' }); f.tube = a.id; ids = [f.id] }
      else if (r.startsWith('pool_liner') || r === 'balls') {
        const spec = POOL_SETS[r === 'balls' ? 'pool_liner_xs' : r]
        m.insertFragment(m.poolFragment(spec, { color: 'blue', tubeFor: (span) => cat.getTube(span > 40 ? 'T75' : 'T35') }), [0, 0, 0])
        const f = [...m.fittings.values()].find(x => x.kind === spec.kind)
        if (f) { if (r === 'balls') f.balls = true; ids = [f.id] }
      } else if (r === 'wheel_floating' || r === 'hub_cap') {
        cube(); const kind = r === 'hub_cap' ? 'hub-cap2' : 'floating-wheel2'
        const mt = m.fittingMounts(kind)[0]; if (mt) ids = one(m.addFittingAt(kind, mt, 'yellow'))
      } else if (r === 'roof_large') { cube(); const mt = (m.roofMounts('roof-large2') || [])[0]; if (mt) ids = one(m.addRoofAt(mt)) }
      data = m.toJSON(); recipeIds = ids
    } else {
    const txt = await (await fetch(`/qdf/${it.qdf}`)).text()
    data = api.parseDesign(txt)
    }
    if (it.swapFrom) {
      const arr = it.group === 'panels' ? data.panels : data.tubes
      const field = it.group === 'panels' ? 'panelId' : 'tubeId'
      const el = arr.find(e => e[field] === it.swapFrom)
      if (el) el[field] = it.rid
    }
    // 统一配色：管、板一律红，布件绿；接头和配件保持原色
    if (!it.recipe) for (const t of data.tubes || []) t.color = 'red'
    for (const p of data.panels || []) p.color = 'red'
    for (const x of data.textiles || []) x.color = 'green'
    model.loadJSON(data)
    builder.refresh()
    const { waitSceneReady } = await import('/src/engine/thumbShot.js')
    await waitSceneReady(scene)
    builder.refresh()
    await new Promise(r => setTimeout(r, 150))

    // 目标件的 id 集合，口径同料表点行高亮
    const ids = new Set(recipeIds || [])
    const first = (iter, ok) => { for (const e of iter) if (ok(e)) { ids.add(e.id); return } }
    const g = it.group
    if (recipeIds) {}
    else if (g === 'tubes') first(model.tubes.values(), t => !t.arm && !t.link && t.tubeId === it.rid)
    else if (g === 'reinforcements') first(model.tubes.values(), t => t.reinforced)
    else if (g === 'panels') first(model.panels.values(), p => p.panelId === it.rid)
    else if (g === 'connectors' && (it.rid === 'double_tube' || it.rid === 'tube_clamp')) first(model.clamps.values(), c => (c.connectorId || 'double_tube') === it.rid)
    else if (g === 'connectors') first([...model.nodes.values()].filter(n => !n.unused), n => api.connectorsForNode(model, n).includes(it.rid))
    else if (g === 'textiles') first(model.textiles.values(), t => (!it.kind || !t.kind || t.kind === it.kind) && (it.w == null || (Math.min(t.w, t.h) === Math.min(it.w, it.h) && Math.max(t.w, t.h) === Math.max(it.w, it.h))))
    else if (g === 'slides') first(model.slides.values(), s => s.kind === it.kind || s.kind === it.rid)
    else first(model.fittings.values(), f => f.kind === it.kind || f.kind === it.rid)
    if (!ids.size) return { err: 'no-instance' }

    // 只留目标件：普通网格按 userData 判断，合批实例把别人的矩阵缩成 0
    const tagOf = (o) => { for (let p = o; p; p = p.parent) if (p.userData && p.userData.kind) return p.userData; return null }
    const restore = []
    const box = new THREE.Box3()
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)
    scene.buildGroup.updateMatrixWorld(true)
    scene.buildGroup.traverse((o) => {
      if (o.isInstancedMesh && o.userData.instances) {
        const keep = []
        o.userData.instances.forEach((inst, i) => {
          const m = new THREE.Matrix4(); o.getMatrixAt(i, m)
          if (inst && (it.group === 'reinforcements' ? (inst.tubes && inst.tubes.some(x => ids.has(x))) : ids.has(inst.id))) {
            keep.push(i)
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
            box.union(o.geometry.boundingBox.clone().applyMatrix4(m).applyMatrix4(o.matrixWorld))
          } else { restore.push(() => { o.setMatrixAt(i, m); o.instanceMatrix.needsUpdate = true }); o.setMatrixAt(i, zero) }
        })
        o.instanceMatrix.needsUpdate = true
      } else if (o.isMesh || o.isLine || o.isPoints || o.isSprite) {
        const tag = tagOf(o)
        if (tag && ids.has(tag.id) && it.group !== 'reinforcements') {
          if (o.isMesh) box.expandByObject(o)
        } else if (o.visible) { o.visible = false; restore.push(() => { o.visible = true }) }
      }
    })
    // 场景里别的东西（草、网格、天空、地面）一律藏掉，只留灯
    for (const c of scene.scene.children) {
      if (c === scene.buildGroup || c.isLight) continue
      if (c.visible) { c.visible = false; restore.push(() => { c.visible = true }) }
    }
    const bg = scene.scene.background; scene.scene.background = null
    restore.push(() => { scene.scene.background = bg })
    if (box.isEmpty()) { restore.forEach(f => f()); return { err: 'empty-box' } }

    // 取景：管子横躺成斜线，板和布平放，其余保持原样；再按包围球定距离
    const pts = []
    const push = (geo, mw) => {
      const pos = geo.attributes.position; if (!pos) return
      const step = Math.max(1, Math.floor(pos.count / 1500))
      for (let i = 0; i < pos.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mw))
    }
    scene.buildGroup.traverse((o) => {
      if (o.isInstancedMesh && o.userData.instances) {
        o.userData.instances.forEach((inst, i) => {
          if (!inst || !(it.group === 'reinforcements' ? (inst.tubes && inst.tubes.some(x => ids.has(x))) : ids.has(inst.id))) return
          const m = new THREE.Matrix4(); o.getMatrixAt(i, m)
          push(o.geometry, m.premultiply(o.matrixWorld))
        })
      } else if (o.isMesh && o.visible) { const tag = tagOf(o); if (tag && ids.has(tag.id)) push(o.geometry, o.matrixWorld) }
    })
    const up = new THREE.Vector3(0, 1, 0)
    let ax = new THREE.Vector3(1, 0, 0), ny = up.clone()
    const mode = ['tubes', 'reinforcements'].includes(g) ? 'axis' : ['panels', 'textiles'].includes(g) ? 'flat' : 'world'
    if (mode !== 'world' && pts.length > 3) {
      const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length)
      const C = [[0,0,0],[0,0,0],[0,0,0]]
      for (const p of pts) { const d = [p.x-c.x, p.y-c.y, p.z-c.z]; for (let i=0;i<3;i++) for (let j=0;j<3;j++) C[i][j] += d[i]*d[j] }
      // Jacobi：对称 3×3 求特征向量
      const V = [[1,0,0],[0,1,0],[0,0,1]], A = C.map(r => r.slice())
      for (let sweep = 0; sweep < 30; sweep++) for (let p = 0; p < 2; p++) for (let q = p+1; q < 3; q++) {
        if (Math.abs(A[p][q]) < 1e-12) continue
        const th = 0.5 * Math.atan2(2*A[p][q], A[q][q]-A[p][p]), cs = Math.cos(th), sn = Math.sin(th)
        for (let k = 0; k < 3; k++) { const a = A[k][p], b = A[k][q]; A[k][p] = cs*a - sn*b; A[k][q] = sn*a + cs*b }
        for (let k = 0; k < 3; k++) { const a = A[p][k], b = A[q][k]; A[p][k] = cs*a - sn*b; A[q][k] = sn*a + cs*b }
        for (let k = 0; k < 3; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = cs*a - sn*b; V[k][q] = sn*a + cs*b }
      }
      const ev = [0,1,2].map(i => ({ val: A[i][i], vec: new THREE.Vector3(V[0][i], V[1][i], V[2][i]).normalize() })).sort((a, b) => b.val - a.val)
      ax = ev[0].vec.clone()
      if (mode === 'flat') { ny = ev[2].vec.clone(); if (ny.dot(up) < 0) ny.negate() }
      else { ny = up.clone().addScaledVector(ax, -up.dot(ax)); if (ny.lengthSq() < 1e-4) ny = ev[1].vec.clone(); ny.normalize() }
      if (ax.x + ax.z < 0) ax.negate()
    }
    const bz = new THREE.Vector3().crossVectors(ax, ny).normalize()
    const center = box.getCenter(new THREE.Vector3())
    let radius = box.getBoundingSphere(new THREE.Sphere()).radius
    // 管子统一粗细：取景距离一律按 TUBE_FRAME 算；长度沿管轴按 6 + 0.45 × 真长 映射，
    // 长短次序不变、差距收窄（10 → 10.5，35 → 21.75，75 → 39.75），短管不至于只剩一个点。弯管不动。
    if (g === 'tubes') {
      const m = /^T(\d+)$/.exec(it.rid)
      const len = m ? Number(m[1]) : ({ TS1: 15, TS2: 15, TS3: 15, TS4: 35, TS5: 35, TS6: 35 })[it.rid]
      if (len) {
        const s = (6 + 0.45 * len) / len
        const S = new THREE.Matrix4().set(
          1 + (s - 1) * ax.x * ax.x, (s - 1) * ax.x * ax.y, (s - 1) * ax.x * ax.z, 0,
          (s - 1) * ax.y * ax.x, 1 + (s - 1) * ax.y * ax.y, (s - 1) * ax.y * ax.z, 0,
          (s - 1) * ax.z * ax.x, (s - 1) * ax.z * ax.y, 1 + (s - 1) * ax.z * ax.z, 0,
          0, 0, 0, 1)
        const T = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z)
        const Ti = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z)
        const bg = scene.buildGroup, keepAuto = bg.matrixAutoUpdate, keepM = bg.matrix.clone()
        bg.updateMatrix()
        bg.matrixAutoUpdate = false
        bg.matrix.copy(T.multiply(S).multiply(Ti).multiply(bg.matrix))
        bg.updateMatrixWorld(true)
        restore.push(() => { bg.matrix.copy(keepM); bg.matrixAutoUpdate = keepAuto; bg.updateMatrixWorld(true) })
      }
      radius = TUBE_FRAME
    }
    const fov = 28
    const cam = new THREE.PerspectiveCamera(fov, 1, 0.1, 100000)
    const dir = new THREE.Vector3().addScaledVector(ax, 1).addScaledVector(ny, 0.85).addScaledVector(bz, 1.35).normalize()
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(fov / 2)) * 1.08
    cam.up.copy(ny)
    cam.position.copy(center).addScaledVector(dir, dist)
    cam.lookAt(center)

    const r = window.__iconRenderer || (window.__iconRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }))
    r.setPixelRatio(1); r.setSize(SIZE, SIZE, false)
    r.setClearColor(0x000000, 0)
    r.outputColorSpace = scene.renderer.outputColorSpace
    r.toneMapping = scene.renderer.toneMapping
    r.toneMappingExposure = scene.renderer.toneMappingExposure
    r.render(scene.scene, cam)
    const small = document.createElement('canvas'); small.width = small.height = OUT_SIZE
    const g2 = small.getContext('2d'); g2.imageSmoothingQuality = 'high'
    g2.drawImage(r.domElement, 0, 0, OUT_SIZE, OUT_SIZE)
    const url = small.toDataURL('image/png')
    restore.forEach(f => f())
    return { url, size: box.getSize(new THREE.Vector3()).toArray().map(v => Math.round(v)) }
  } catch (e) { return { err: String(e && e.message || e).slice(0, 200) } } }, { it, SIZE, OUT_SIZE, TUBE_FRAME })
  if (res.err) { console.log('跳过', it.key, res.err); continue }
  const file = it.rid + '.png'
  fs.writeFileSync(path.join(OUT, file), Buffer.from(res.url.split(',')[1], 'base64'))
  index.push({ ...it, file, size: res.size })
  console.log('ok', it.key, it.name, res.size.join('×'))
}
const ids = index.map(r => r.rid).sort()
fs.writeFileSync(path.join(ROOT, 'src/ui/partImages.ts'),
  '// 由 scripts/shoot-part-icons.mjs 生成，别手改。列的是 public/parts/ 下有渲染图的零件 id。\n'
  + 'export const PART_IMAGES: ReadonlySet<string> = new Set([\n' + ids.map(id => `  '${id}',`).join('\n') + '\n])\n')
console.log('写了', ids.length, '张')
await browser.close()
