// 标签页列表的增减。新开的一页排在最后并成为前台，已开的都留着、顺序不变。
export function appendTab<T extends { tabId: string }>(tabs: T[], tab: T): { tabs: T[]; active: string } {
  return { tabs: [...tabs, tab], active: tab.tabId }
}
