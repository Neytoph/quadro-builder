import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog } from '../engine/catalog.js'
import * as docs from '../engine/docs.js'
import { importOne } from './batchImport'

beforeAll(async () => { await loadCatalog() })

describe('批量导入 .qdf', () => {
  it('官方文件存成一座造型', async () => {
    const text = readFileSync(join(process.cwd(), 'src/data/A0128.qdf'), 'utf8')
    const r = await importOne(new File([text], 'Pyramide_A0128.qdf'))
    expect(r.ok).toBe(true)
    expect(r.parts).toBeGreaterThan(10)
    const doc = await docs.getDoc(r.docId!) as { name: string; data: { tubes: unknown[] } }
    expect(doc.name).toBe(r.name)
    expect(doc.data.tubes.length).toBeGreaterThan(0)
  })

  it('认不出零件的文件不存', async () => {
    const r = await importOne(new File(['<nothing/>'], 'leer.qdf'))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('noParts')
    expect(r.docId).toBeNull()
  })
})
