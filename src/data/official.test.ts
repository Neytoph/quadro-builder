import { describe, expect, it } from 'vitest'
import { OFFICIAL_BY_ID, OFFICIAL_MODELS, matchesOfficial, officialName } from './official'

describe('official model names', () => {
  it('keeps every catalog entry translated', () => {
    expect(OFFICIAL_MODELS).toHaveLength(495)
    for (const model of OFFICIAL_MODELS) {
      for (const lang of ['zh', 'en', 'de'] as const) expect(officialName(model, lang).trim()).not.toBe('')
    }
  })
  it.each(['宝宝农场', 'Baby Farm', 'Baby Bauernhof', ' a0001 '])('finds the same model using %s', query => {
    expect(OFFICIAL_MODELS.filter(model => matchesOfficial(model, query)).map(model => model.id)).toContain('A0001')
  })
  it('shows the active language without changing catalog identities', () => {
    const model = OFFICIAL_BY_ID.get('A0001')!
    expect(['zh', 'en', 'de'].map(lang => officialName(model, lang as 'zh' | 'en' | 'de'))).toEqual(['宝宝农场', 'Baby Farm', 'Baby Bauernhof'])
  })
})
