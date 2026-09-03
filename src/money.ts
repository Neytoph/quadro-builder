type Lang = 'zh' | 'en' | 'de'

/** 展示换算，按整数人民币估。零件目录是欧元，套装价是人民币。不是实时牌价。 */
export const EUR_TO_CNY = 8

function eurText(n: number, lang: Lang) {
  const v = Math.max(0, n)
  if (lang === 'de') return `${v.toFixed(2).replace('.', ',')} €`
  return `€${v.toFixed(2)}`
}

function cnyText(n: number) {
  return `¥${Math.round(Math.max(0, n)).toLocaleString('zh-CN')}`
}

/** 零件 / BOM：目录是欧元，中文界面换成人民币。 */
export function formatCatalogPrice(amountEur: number, lang: Lang) {
  if (lang === 'zh') return cnyText(amountEur * EUR_TO_CNY)
  return eurText(amountEur, lang)
}

/** 选购套装：目录是人民币，德/英界面换成欧元。 */
export function formatKitPrice(amountCny: number, lang: Lang) {
  if (lang === 'zh') return cnyText(amountCny)
  return eurText(amountCny / EUR_TO_CNY, lang)
}
