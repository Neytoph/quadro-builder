import { describe, expect, it } from 'vitest'
import { manualRegionDescriptors } from './assemblyManual.js'

describe('PDF region pages after accessory scheduling, without model planning', () => {
  it('omits an empty relocated accessory region even though its completed locator would show gray model context', () => {
    const model = { nodes: new Map([['n1', { x: 0, y: 0, z: 0 }]]), tubes: new Map(), slides: new Map([['slide', { kind: 'slide2' }]]) }
    const plan = { regions: [
      { id: 'body', label: 'A', name: 'Body', partIds: ['n1', 'slide'] },
      { id: 'slide-region', label: 'B', name: 'Slide chain', partIds: [] },
    ], steps: [{ id: 'body-step', regionId: 'body', partIds: ['n1', 'slide'], operations: [{ id: 'fit-slide', partIds: ['slide'] }] }],
      bom: { slides: [{ id: 'slide2', count: 1 }] }, ledger: { instances: [{ id: 'slide-instance', partIds: ['slide'], stepId: 'body-step' }] } }
    const before = structuredClone({ model, plan })
    const pages = manualRegionDescriptors(model, plan)
    expect(pages.map(page => [page.type, page.region.id, page.label, page.partIds])).toEqual([['region', 'body', 'A', ['n1', 'slide']]])
    // The empty region would otherwise show no current/new mesh on the left,
    // while its locator's all-visible model still contains the real slide.
    expect(model.slides.has('slide')).toBe(true)
    expect(plan.regions[1].partIds).toEqual([])
    expect(pages).toHaveLength(1)
    expect({ model, plan }).toEqual(before)
  })

  it('keeps real accessory ownership without requiring a main step and preserves original labels across omitted slots', () => {
    const model = { nodes: new Map([['n1', {}], ['n5', {}]]), tubes: new Map([
      ['pipe', { arm: false, link: false }], ['topology-arm', { arm: true }], ['topology-link', { link: true }],
    ]), fittings: new Map([['accessory', { kind: 'bearing2' }]]) }
    const plan = { regions: [
      { id: 'body', label: 'A', name: 'Body', partIds: ['n1', 'pipe', 'pipe'] },
      { id: 'empty', label: 'B', name: 'Relocated', partIds: [] },
      { id: 'standalone', label: 'C', name: 'Standalone fitting', partIds: ['accessory'] },
      { id: 'virtual', label: 'D', name: 'Topology only', partIds: ['topology-arm', 'topology-link', 'missing'] },
      { id: 'legacy', name: 'Legacy region', partIds: ['n5'] },
    ], steps: [{ id: 'main1', regionId: 'body', partIds: ['n1', 'pipe'] }], bom: { tubes: [{ count: 1 }], fittings: [{ count: 1 }] } }
    const before = structuredClone({ model, plan })
    const pages = manualRegionDescriptors(model, plan)
    expect(pages.map(page => page.region.id)).toEqual(['body', 'standalone', 'legacy'])
    expect(pages.map(page => page.label)).toEqual(['A', 'C', 'R5'])
    expect(pages.map(page => page.partIds)).toEqual([['n1', 'pipe'], ['accessory'], ['n5']])
    // Text overview, location markers and region headings consume this same
    // ordered descriptor list; original labels are not renumbered after B/D.
    expect(pages.map(page => `${page.label} · ${page.region.name}`)).toEqual(['A · Body', 'C · Standalone fitting', 'R5 · Legacy region'])
    expect(pages[1].region).toBe(plan.regions[2])
    expect(plan.steps.map(step => step.id)).toEqual(['main1'])
    expect({ model, plan }).toEqual(before)
  })
})
