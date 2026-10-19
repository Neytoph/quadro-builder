// 动作按钮共享磁吸。导航、筛选、关闭及精细工具固定，内容卡沿 hover.js。
const actions = ':is(.btn,.qb-btn,.xmf-button)';
const fixed = '[data-hover="off"], [data-button-motion="off"], nav, [role="menu"], [role="menuitem"], [role="toolbar"], [role="tablist"], [role="tab"], [role="listbox"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [aria-pressed], .qh-menu, .qh-lang, .qh-lang-pop, .filters, .slot-filters, .ws-presets, .qb-top-toolbar, .assembly-navigation, .slot-capacity-summary';
const unavailable = ':disabled, [disabled], [aria-disabled="true"], [aria-busy="true"], [inert], .btn.off';
const fine = matchMedia('(hover:hover) and (pointer:fine)');
const reduced = matchMedia('(prefers-reduced-motion:reduce)');
let current = null;
let bounds = null;
let pressed = false;
let pressedAction = null;
function actionAt(target) {
  const button=target instanceof Element ? target.closest(actions) : null;
  return button && !button.closest(fixed) && !button.closest(unavailable) ? button : null;
}
function stopPress() { pressedAction?.removeAttribute('data-button-press');pressedAction=null; }
function startPress(target) {
  stopPress();
  if (!fine.matches || reduced.matches) return;
  pressedAction=actionAt(target);
  pressedAction?.setAttribute('data-button-press','');
}
const sizes = new WeakMap();
function rememberSize(button) {
  if (!button || button.closest(unavailable)) return;
  sizes.set(button,{width:getComputedStyle(button).width,inline:button.style.getPropertyValue('inline-size'),priority:button.style.getPropertyPriority('inline-size')});
}
// 只保留当前真实动作的占位；不改业务文案、disabled 或提交逻辑。
const busySize = new MutationObserver(records => {
  if (pressedAction?.closest(unavailable)) stopPress();
  for (const {target} of records) {
    if (!(target instanceof Element)) continue;
    const buttons = target.matches(actions) ? [target] : target.querySelectorAll(actions);
    for (const button of buttons) {
      const size=sizes.get(button);
      if (!size) continue;
      if (button.closest('[aria-busy="true"]')) button.style.setProperty('inline-size',size.width);
      else {
        if (size.inline) button.style.setProperty('inline-size',size.inline,size.priority);
        else button.style.removeProperty('inline-size');
        sizes.delete(button);
      }
    }
  }
});
busySize.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['aria-busy']});
document.addEventListener('click',event=>{
  const button=event.target instanceof Element ? event.target.closest(actions) : null;
  if (!button) return;
  if (button.closest(unavailable)) { event.preventDefault();event.stopImmediatePropagation();return; }
  rememberSize(button);
},true);
document.addEventListener('submit',event=>{if(event.submitter?.matches(actions))rememberSize(event.submitter);},true);
const observer = new MutationObserver(() => { if (current?.closest(unavailable) || current?.closest(fixed)) reset(); });
function reset() {
  observer.disconnect();
  if (current) {
    current.removeAttribute('data-button-magnetic');
    current.style.removeProperty('--button-x');
    current.style.removeProperty('--button-y');
  }
  current = null;
  bounds = null;
}
document.addEventListener('pointermove', event => {
  if (!fine.matches || reduced.matches || event.pointerType !== 'mouse' || pressed) return;
  const next = actionAt(event.target);
  if (next !== current) {
    reset();
    if (!next) return;
    if (next.getAnimations().some(animation => animation.playState === 'running' && !(animation instanceof CSSTransition))) return;
    current = next;
    bounds = next.getBoundingClientRect();
    for (let node = next; node; node = node.parentElement) observer.observe(node, { attributes:true, attributeFilter:['disabled','aria-disabled','aria-busy','inert','class','data-hover','data-button-motion'] });
    current.setAttribute('data-button-magnetic','');
  }
  if (!current) return;
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit,value));
  current.style.setProperty('--button-x', clamp((event.clientX - bounds.left - bounds.width/2)*.18,8).toFixed(1)+'px');
  current.style.setProperty('--button-y', clamp((event.clientY - bounds.top - bounds.height/2)*.35,5).toFixed(1)+'px');
}, {passive:true});
document.addEventListener('pointerout', event => { if (current && (!(event.relatedTarget instanceof Node) || !current.contains(event.relatedTarget))) reset(); }, {passive:true});
document.addEventListener('pointerdown', event => { pressed=true;reset();if(event.button===0)startPress(event.target); }, {passive:true});
document.addEventListener('pointerup', () => { pressed=false;stopPress(); }, {passive:true});
document.addEventListener('pointercancel', () => { pressed=false;stopPress();reset(); }, {passive:true});
document.addEventListener('keydown', event => { if(!event.repeat && (event.key===' '||event.key==='Enter')){pressed=true;reset();startPress(event.target);} });
document.addEventListener('keyup', event => { if(event.key===' '||event.key==='Enter'){pressed=false;stopPress();} });
function clear() { pressed=false;stopPress();reset(); }
document.addEventListener('dragstart', clear, true);
document.addEventListener('scroll', clear, {capture:true,passive:true});
document.addEventListener('visibilitychange', clear);
window.addEventListener('blur', clear);
window.addEventListener('resize', clear, {passive:true});
fine.addEventListener('change', clear);
reduced.addEventListener('change', clear);
