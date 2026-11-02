// 平台与 Builder 共用。只负责展开区域；业务请求、状态和错误即时更新。
function createDisclosureMotion() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Map();
  const easing = 'cubic-bezier(.22,1,.36,1)';
  function expanded(element) { return active.get(element)?.open ?? (element.tagName === 'DETAILS' ? element.open : !element.hidden); }
  function run(element, open, options = {}) {
    const previous = active.get(element);
    if (previous?.open === open) return;
    if (!previous && expanded(element) === open) { options.onFinish?.(); return; }
    const details = element.tagName === 'DETAILS';
    const summary = details ? element.querySelector(':scope > summary') : null;
    const children = details ? [...element.children].filter(child => child !== summary) : [element];
    const visible = details ? element.open : !element.hidden;
    const floating = options.floating ?? (details && children.some(child => ['absolute', 'fixed'].includes(getComputedStyle(child).position)));
    const target = floating && details ? children[0] : element;
    if (!target) return;
    const fromHeight = visible || details ? getComputedStyle(element).height : '0px';
    const fromOpacity = visible ? getComputedStyle(target).opacity : '0';
    const fromTranslate = visible ? getComputedStyle(target).translate : '0 -4px';
    const spacing = ['paddingTop','paddingBottom','marginTop','marginBottom','borderTopWidth','borderBottomWidth'];
    const startSpacing = Object.fromEntries(spacing.map(key => [key, visible ? getComputedStyle(element)[key] : '0px']));
    previous?.finish(false);
    if (details) element.open = true; else element.hidden = false;
    const savedOverflow = element.style.overflow;
    const savedInert = children.map(child => [child, child.inert]);
    if (!open && element.contains(document.activeElement)) (summary || options.trigger)?.focus({preventScroll:true});
    children.forEach((child,index) => { child.inert = !open || details && savedInert[index][1]; });
    summary?.setAttribute('aria-expanded', String(open));
    options.trigger?.setAttribute('aria-expanded', String(open));
    let animation;
    const entry = {open, finish(commit = true) {
      animation?.cancel();
      active.delete(element);
      element.style.overflow = savedOverflow;
      if (details) savedInert.forEach(([child, inert]) => { child.inert = inert; });
      if (commit) {
        if (details) element.open = open; else { element.hidden = !open; element.inert = !open; }
        options.onFinish?.();
      }
    }};
    active.set(element, entry);
    if (reduced.matches || !element.animate || !element.isConnected) { entry.finish(); return; }
    let frames;
    if (floating) frames = [{opacity:fromOpacity, translate:fromTranslate}, {opacity:open ? 1 : 0, translate:open ? '0 0' : '0 -4px'}];
    else {
      const toHeight = getComputedStyle(element).height;
      let closedHeight = '0px';
      if (details) { element.open = false; closedHeight = getComputedStyle(element).height; element.open = true; }
      element.style.overflow = 'clip';
      frames = [{height:fromHeight}, {height:open ? toHeight : closedHeight}];
      if (!details) {
        Object.assign(frames[0], startSpacing, {minHeight:'0px'});
        Object.assign(frames[1], Object.fromEntries(spacing.map(key => [key, open ? getComputedStyle(element)[key] : '0px'])), {minHeight:'0px'});
      }
    }
    animation = target.animate(frames, {duration:open ? 240 : 200, easing, fill:'both'});
    animation.finished?.catch(error => { if (error.name !== 'AbortError') throw error; });
    animation.onfinish = () => { if (active.get(element) === entry) entry.finish(); };
  }
  function dispose(root) { for (const [element, entry] of active) if (root === element || root.contains(element)) entry.finish(); }
  // 已由业务负责的明细在自身处理器中 preventDefault，避免叠加第二套动画。
  document.addEventListener('click', event => {
    const summary = event.target.closest?.('summary');
    const details = summary?.parentElement;
    if (event.defaultPrevented || details?.tagName !== 'DETAILS' || event.target.closest('a,button,input,select,textarea') || details.dataset.disclosureMotion === 'off') return;
    event.preventDefault(); run(details, !expanded(details));
  });
  const settle = () => { for (const entry of [...active.values()]) entry.finish(); };
  reduced.addEventListener('change', settle);
  window.addEventListener('resize', settle);
  new MutationObserver(() => { for (const [element, entry] of active) if (!element.isConnected) entry.finish(); }).observe(document.documentElement, {childList:true, subtree:true});
  return {set:run, expanded, dispose};
}
// 动态资料卡可能来自 Builder 的公共副本，同一文档只安装一次。
export const disclosureMotion = window.QHDisclosure || (window.QHDisclosure = createDisclosureMotion());
