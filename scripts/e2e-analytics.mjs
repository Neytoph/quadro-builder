// VITE_ANALYTICS_URL=/events npm run dev -- --host 127.0.0.1 --port 5230 --strictPort
// node scripts/e2e-analytics.mjs（使用本机 Chrome）
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const browser = await chromium.launch({ channel: 'chrome' })
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await context.addInitScript(() => localStorage.setItem('quadro.builder.onboarded.v2', '1'))
  const events = []
  context.on('request', request => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/events') return
    const body = JSON.parse(request.postData())
    events.push(...body.events)
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error))
  await page.goto('http://127.0.0.1:5230/')
  await page.locator('canvas').first().waitFor()
  await page.mouse.move(400, 400)
  await page.waitForTimeout(22_000)

  assert.deepEqual(pageErrors, [], '页面没有运行错误')
  const open = events.find(e => e.name === 'builder.app.open')
  const time = events.filter(e => e.name === 'builder.app.time')
  assert.ok(open?.props?.visit, '打开事件带访问标识')
  assert.ok(time.length > 0, '离开页面时发送前台计时')
  assert.ok(time.every(e => e.props.visit === open.props.visit), '计时与打开属于同一次访问')
  assert.ok(time.reduce((n, e) => n + e.props.visible, 0) >= 10, '累计前台可见时长')
  assert.ok(time.reduce((n, e) => n + e.props.active, 0) >= 10, '累计前台活跃时长')
  console.log('设计器前台计时与访问标识验证通过')
} finally {
  await browser.close()
}
