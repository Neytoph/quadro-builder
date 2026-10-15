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

  it('封面记在存档上，交上去以后清掉', async () => {
    type Rec = { cover?: string; dirty?: boolean; rev: number; updatedAt: number }
    const text = readFileSync(join(process.cwd(), 'src/data/A0128.qdf'), 'utf8')
    const r = await importOne(new File([text], 'Pyramide_A0128.qdf'))
    const first = 'data:image/jpeg;base64,AAAA'
    await docs.setDocCover(r.docId!, first)
    let doc = await docs.getDoc(r.docId!) as Rec
    expect(doc.cover).toBe(first)
    expect(doc.dirty).toBe(true)

    // 交上去之前又存了一次：封面还在
    await docs.saveDoc({ docId: r.docId!, name: 'x', data: (await docs.getDoc(r.docId!) as { data: unknown }).data })
    doc = await docs.getDoc(r.docId!) as Rec
    expect(doc.cover).toBe(first)

    // 推送途中换了一张：交上去的是旧的，新的留着下次交
    const second = 'data:image/jpeg;base64,BBBB'
    const stamp = doc.updatedAt
    await docs.setDocCover(r.docId!, second)
    await docs.markDocSynced(r.docId!, 3, stamp, first)
    doc = await docs.getDoc(r.docId!) as Rec
    expect(doc.cover).toBe(second)
    expect(doc.dirty).toBe(true)

    await docs.markDocSynced(r.docId!, 4, doc.updatedAt, second)
    doc = await docs.getDoc(r.docId!) as Rec
    expect(doc.cover).toBeUndefined()
    expect(doc.dirty).toBe(false)
    expect(doc.rev).toBe(4)
  })
})
