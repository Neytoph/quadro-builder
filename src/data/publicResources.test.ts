import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { cachedOfficialQdf, officialCacheVersion, officialQdfPath } from './official'
import { resourceVersion, versionPublicSource } from '../engine/publicResources.js'

afterEach(() => vi.unstubAllGlobals())
it('真实公共QDF的URL内容hash与文件一致，只重写明确public路径', () => {
  const hash = createHash('sha256').update(readFileSync('public/qdf/A0001.qdf')).digest('hex')
  expect(resourceVersion('qdf/A0001.qdf')).toBe(hash)
  expect(officialQdfPath('A0001')).toContain(`resources/${hash}/qdf/A0001.qdf`)
  vi.stubGlobal('location', { href: 'http://localhost/' })
  expect(versionPublicSource('/qdf/A0001.qdf')).toBe(officialQdfPath('A0001'))
  expect(versionPublicSource('/quadro/models/private')).toBe('/quadro/models/private')
  expect(versionPublicSource('https://other.test/qdf/A0001.qdf')).toBe('https://other.test/qdf/A0001.qdf')
})

it('官方缓存契约夹具：内容或解析版本变化只使官方来源缓存失效', () => {
  const qdf = readFileSync('public/qdf/A0001.qdf', 'utf8')
  const version = officialCacheVersion('A0001')
  expect(cachedOfficialQdf({ qdf, ...version }, 'A0001')).toBe(qdf)
  expect(cachedOfficialQdf({ qdf }, 'A0001')).toBeNull()
  expect(cachedOfficialQdf({ qdf, ...version, resourceVersion: 'old-resource' }, 'A0001')).toBeNull()
  expect(cachedOfficialQdf({ qdf, ...version, parserVersion: 'old-parser' }, 'A0001')).toBeNull()
})
