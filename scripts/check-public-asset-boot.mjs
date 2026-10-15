import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { gzipSync } from 'node:zlib'
import { chromium } from '@playwright/test'

// 真实浏览器和真实构建字节；1Mbps/300ms是本地网络夹具，不代表物理IPv6或5G速度。
const root = path.resolve(process.argv[2] || 'dist-perf')
const baseline = path.resolve(process.argv[3] || 'dist-default')
const evidence = path.resolve(process.argv[4] || '../builder-perf')
fs.mkdirSync(evidence, { recursive: true })
const release = JSON.parse(fs.readFileSync(path.join(root, 'public-assets-release.json')))
const entry = Object.keys(release.assets).find(file => /\/assets\/index-[\w-]+\.js$/.test(file))
const rows = []
let phase = 'accelerated'
const streams = new Set()
function server(foreign) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const target = url.pathname === '/builder/' ? '/builder/index.html' : url.pathname
    const row = { phase, foreign, method: req.method, url: url.pathname, started: Date.now(), bytes: 0, finished: false,
      cookie: req.headers.cookie || null }
    rows.push(row)
    if (foreign) {
      res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:21910')
      res.setHeader('Timing-Allow-Origin', 'http://127.0.0.1:21910')
    }
    const asset = release.assets[url.pathname]
    if (req.method !== 'GET' || !url.pathname.startsWith('/builder/') || foreign && !asset) {
      res.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return
    }
    const folder = phase === 'baseline' ? baseline : root
    const file = path.resolve(folder, target.slice('/builder/'.length))
    if (!file.startsWith(folder + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return
    }
    const raw = fs.readFileSync(file)
    const type = asset?.mime || (file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/json')
    const compress = /javascript|css|html|json|plain/.test(type)
    const bytes = compress ? gzipSync(raw) : raw
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', asset ? 'public,max-age=31536000,immutable' : 'no-store')
    res.setHeader('Content-Length', bytes.length)
    if (compress) res.setHeader('Content-Encoding', 'gzip')
    if (file.endsWith('index.html')) res.setHeader('Set-Cookie', 'asset-fixture=private; SameSite=Lax')
    let offset = 0
    let timer
    const pump = () => {
      if (res.destroyed) return
      const chunk = bytes.subarray(offset, offset + (foreign ? bytes.length : 8000))
      res.write(chunk)
      offset += chunk.length
      row.bytes = offset
      if (offset >= bytes.length) { row.finished = true; row.ended = Date.now(); res.end() }
      else { timer = setTimeout(pump, 64); streams.add(timer) }
    }
    timer = setTimeout(pump, foreign ? 0 : 300)
    streams.add(timer)
    res.on('close', () => { clearTimeout(timer); row.closed = Date.now() })
  })
}
const canonical = server(false)
const foreign = server(true)
await Promise.all([new Promise(resolve => canonical.listen(21910, '127.0.0.1', resolve)),
  new Promise(resolve => foreign.listen(21911, '127.0.0.1', resolve))])
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const results = []
try {
  for (const mode of ['accelerated', 'baseline']) {
    phase = mode
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const start = Date.now()
    await page.goto('http://127.0.0.1:21910/builder/?view=1', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('canvas', { timeout: 45000 })
    const readyMs = Date.now() - start
    const data = await page.evaluate(() => ({ controller: navigator.serviceWorker.controller?.scriptURL || null,
      entryScripts: [...document.querySelectorAll('script[type="module"][src]')].map(script => script.src),
      resources: performance.getEntriesByType('resource').map(resource => ({ name: resource.name, duration: resource.duration,
        transferSize: resource.transferSize, initiatorType: resource.initiatorType })) }))
    const main = rows.filter(row => row.phase === mode && row.url === entry)
    results.push({ mode, readyMs, main, errors, ...data })
    await page.screenshot({ path: path.join(evidence, mode + '.png') })
    await context.close()
  }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ fixture: 'canonical per-connection 1Mbps + 300ms; fast loopback alternate',
    release: release.release, results, requests: rows }, null, 2))
  console.log(JSON.stringify(results.map(result => ({ mode: result.mode, readyMs: result.readyMs,
    controller: result.controller, main: result.main, entryScripts: result.entryScripts, errors: result.errors })), null, 2))
} finally {
  await browser.close()
  for (const timer of streams) clearTimeout(timer)
  canonical.closeAllConnections()
  foreign.closeAllConnections()
  await Promise.all([new Promise(resolve => canonical.close(resolve)), new Promise(resolve => foreign.close(resolve))])
}
