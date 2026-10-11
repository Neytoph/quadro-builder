import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'

/** 按完整文字的实际宽度决定是否收起文字，外部托管按钮也参与测量。 */
export function useOverflowCompact(contentRef: RefObject<HTMLElement | null>, scopeRef = contentRef, enabled = true) {
  const [compact, setCompact] = useState(false)
  const measure = useCallback(() => {
    const content = contentRef.current, scope = scopeRef.current
    if (!enabled || !content || !scope) return
    scope.dataset.compact = 'false'
    const next = content.scrollWidth > content.clientWidth + 1
    scope.dataset.compact = String(next)
    setCompact(current => current === next ? current : next)
  }, [contentRef, scopeRef, enabled])

  useLayoutEffect(measure)
  useLayoutEffect(() => {
    const scope = scopeRef.current, content = contentRef.current
    if (!enabled || !scope || !content) return
    let active = true
    const resize = new ResizeObserver(measure)
    const observe = () => {
      resize.disconnect()
      resize.observe(scope)
      resize.observe(content)
      for (const child of scope.children) resize.observe(child)
    }
    observe()
    const mutation = new MutationObserver(() => { observe(); measure() })
    mutation.observe(scope, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] })
    void document.fonts.ready.then(() => { if (active) measure() })
    return () => { active = false; resize.disconnect(); mutation.disconnect() }
  }, [contentRef, scopeRef, measure, enabled])
  return compact
}
