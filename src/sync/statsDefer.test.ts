import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BuildModel, docs, storage } from '../engine-api'
import { buildableTubes, geometry, loadCatalog, panels } from '../engine/catalog.js'
import { parseQDF } from '../engine/qdfimport.js'
import { statsOfData } from '../designStats'
import { createSync } from './index'

let accountId = ''
beforeEach(async () => {
  await loadCatalog()
  accountId = `stats-defer-${Date.now()}`
  storage.setAccountScope(accountId)
})
afterEach(() => { storage.setAccountScope(null); docs.setSyncMode(false) })

function beam() {
  const model = new BuildModel()
  const left = model.addNode(0, 0, 0)
  const right = model.addNode(40, 0, 0)
  model.addTube(left.id, right.id, 'T35', 'blue', 35)
  return model.toJSON()
}

it('保存先上传造型，同步完成不等步骤数，随后按同一版本补上', async () => {
  const data = beam()
  const puts: string[] = []
  let modelStats: unknown = 'missing'
  let statsBody: { rev?: number, stats?: { steps?: number } } | null = null
  let releaseStats = () => {}
  const statsGate = new Promise<void>(resolve => { releaseStats = resolve })
  const saved = await docs.saveDoc({ docId: 'beam', name: '梁', data })
  const sync = createSync({
    baseUrl: '/quadro',
    accountId,
    fetchImpl: async (input, init) => {
      const url = String(input)
      const headers = { 'X-Builder-User-ID': accountId }
      if (url.endsWith('/identity')) return new Response(JSON.stringify({ userId: accountId }), { headers })
      if (url.endsWith('/inventory')) return new Response(JSON.stringify({ data: {}, rev: 0 }), { headers })
      if (init?.method === 'PUT' && url.endsWith('/stats')) {
        puts.push(url)
        statsBody = JSON.parse(String(init.body))
        await statsGate
        return new Response(null, { status: 204, headers })
      }
      if (init?.method === 'PUT') {
        puts.push(url)
        modelStats = JSON.parse(String(init.body)).stats
        return new Response(JSON.stringify({ rev: 2, saveId: saved.saveId }), { headers })
      }
      return new Response(JSON.stringify({ rev: 2, items: [] }), { headers })
    },
  })
  const result = await sync.syncSavedDoc('beam', saved.saveId)
  expect(result).toEqual({ status: 'synced', id: 'beam', saveId: saved.saveId, rev: 2 })
  expect(modelStats).toBeNull()
  releaseStats()
  await vi.waitFor(() => {
    if (!statsBody) throw new Error('步骤数还没补上')
  })
  expect(statsBody!.rev).toBe(2)
  expect(statsBody!.stats).toEqual(statsOfData(data))
  sync.stop()
})

it('官方金字塔先上传造型，装配计划不挡这一次同步', async () => {
  const text = readFileSync(join(process.cwd(), 'src/data/A0128.qdf'), 'utf8')
  const model = new BuildModel()
  model.loadJSON(parseQDF(text, { tubes: buildableTubes(), panels: panels(), connectorSize: geometry().connectorSize, mergeEps: 2 }))
  const data = model.toJSON()
  const saved = await docs.saveDoc({ docId: 'pyramid', name: '金字塔', data })
  let modelPutMs = Number.POSITIVE_INFINITY
  let statsBody: { rev?: number, stats?: { steps?: number } } | null = null
  let releaseStats = () => {}
  const statsGate = new Promise<void>(resolve => { releaseStats = resolve })
  const started = performance.now()
  const sync = createSync({
    baseUrl: '/quadro',
    accountId,
    fetchImpl: async (input, init) => {
      const url = String(input)
      const headers = { 'X-Builder-User-ID': accountId }
      if (url.endsWith('/identity')) return new Response(JSON.stringify({ userId: accountId }), { headers })
      if (url.endsWith('/inventory')) return new Response(JSON.stringify({ data: {}, rev: 0 }), { headers })
      if (init?.method === 'PUT' && url.endsWith('/stats')) {
        statsBody = JSON.parse(String(init.body))
        await statsGate
        return new Response(null, { status: 204, headers })
      }
      if (init?.method === 'PUT') {
        modelPutMs = performance.now() - started
        const body = JSON.parse(String(init.body))
        expect(body.stats).toBeNull()
        return new Response(JSON.stringify({ rev: 2, saveId: saved.saveId }), { headers })
      }
      return new Response(JSON.stringify({ rev: 2, items: [] }), { headers })
    },
  })
  const result = await sync.syncSavedDoc('pyramid', saved.saveId)
  expect(result).toEqual({ status: 'synced', id: 'pyramid', saveId: saved.saveId, rev: 2 })
  expect(modelPutMs).toBeLessThan(2000)
  releaseStats()
  await vi.waitFor(() => {
    if (!statsBody) throw new Error('步骤数还没补上')
  }, { timeout: 60_000 })
  expect(statsBody!.rev).toBe(2)
  expect(statsBody!.stats).toEqual(statsOfData(data))
  expect(statsBody!.stats!.steps).toBeGreaterThan(0)
  sync.stop()
}, 90_000)
