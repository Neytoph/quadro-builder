/** 模型库缩略图：空背景、默认 3/4、不抬镜头。截完后按轮廓收一圈边。 */

const THUMB_W = 480
const THUMB_H = 360
const THUMB_MARGIN = 1.12
const THUMB_PAD = 0.07

function waitFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve))
}

function sceneWaiting(scene) {
  return !!scene._spinner?.classList.contains('visible')
}

/** 等到零件网格加载完，避免截到空转圈或替代方块。 */
export async function waitSceneReady(scene, timeoutMs = 20000) {
  const started = performance.now()
  const prev = scene.onMeshesReady
  try {
    while (performance.now() - started < timeoutMs) {
      if (!sceneWaiting(scene)) {
        await waitFrame()
        await waitFrame()
        return true
      }
      await new Promise(resolve => {
        const timer = window.setTimeout(resolve, 80)
        scene.onMeshesReady = () => {
          try { prev?.() } catch { /* ignore */ }
          window.clearTimeout(timer)
          resolve()
        }
      })
    }
    return !sceneWaiting(scene)
  } finally {
    scene.onMeshesReady = prev
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('thumb image'))
    img.src = url
  })
}

function pixelAt(data, w, x, y) {
  const i = (y * w + x) * 4
  return [data[i], data[i + 1], data[i + 2]]
}

function sampleBg(data, w, h) {
  const pts = [
    pixelAt(data, w, 0, 0),
    pixelAt(data, w, w - 1, 0),
    pixelAt(data, w, 0, h - 1),
    pixelAt(data, w, w - 1, h - 1),
  ]
  return [
    Math.round(pts.reduce((s, p) => s + p[0], 0) / 4),
    Math.round(pts.reduce((s, p) => s + p[1], 0) / 4),
    Math.round(pts.reduce((s, p) => s + p[2], 0) / 4),
  ]
}

function contentBox(data, w, h, bg, thresh = 30) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) <= thresh) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  return { x0, y0, x1, y1 }
}

function clampRect(x, y, cw, ch, w, h) {
  if (cw > w) { x = 0; cw = w }
  if (ch > h) { y = 0; ch = h }
  if (x < 0) x = 0
  if (y < 0) y = 0
  if (x + cw > w) x = w - cw
  if (y + ch > h) y = h - ch
  return { x, y, cw, ch }
}

/** 按模型轮廓收边，再铺回 4:3，避免 AABB 取景上下空一截。 */
async function tightenThumb(dataUrl) {
  const img = await loadImage(dataUrl)
  const src = document.createElement('canvas')
  src.width = img.width
  src.height = img.height
  const ctx = src.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const pix = ctx.getImageData(0, 0, src.width, src.height)
  const box = contentBox(pix.data, pix.width, pix.height, sampleBg(pix.data, pix.width, pix.height))
  if (!box) return dataUrl
  const bw = box.x1 - box.x0 + 1
  const bh = box.y1 - box.y0 + 1
  const extra = Math.max(bw, bh) * THUMB_PAD
  let x = box.x0 - extra
  let y = box.y0 - extra
  let cw = bw + extra * 2
  let ch = bh + extra * 2
  const target = THUMB_W / THUMB_H
  if (cw / ch > target) {
    const nextH = cw / target
    y -= (nextH - ch) / 2
    ch = nextH
  } else {
    const nextW = ch * target
    x -= (nextW - cw) / 2
    cw = nextW
  }
  const fit = clampRect(x, y, cw, ch, src.width, src.height)
  const out = document.createElement('canvas')
  out.width = THUMB_W * 2
  out.height = THUMB_H * 2
  const octx = out.getContext('2d')
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(src, fit.x, fit.y, fit.cw, fit.ch, 0, 0, out.width, out.height)
  return out.toDataURL('image/jpeg', 0.86)
}

/** 关草地/网格/房间后，按说明书同一套 3/4 框住并出 JPEG。 */
export async function takeModelThumb(scene, model) {
  scene.frameFromYaw(model, 0, { silent: true, aspect: THUMB_W / THUMB_H, margin: THUMB_MARGIN })
  const url = scene.snapshot({
    hideGrid: true,
    hideLabels: true,
    hideRoom: true,
    width: THUMB_W,
    height: THUMB_H,
    mime: 'image/png',
    pixelRatio: 2,
  })
  if (typeof url !== 'string' || !url.startsWith('data:image')) return null
  return tightenThumb(url)
}
