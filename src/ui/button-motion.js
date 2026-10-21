// 动作按钮共享磁吸。导航、筛选、关闭及精细工具固定，内容卡沿 hover.js。
const actions = ':is(.btn,.qb-btn,.xmf-button)';
const fixed = '[data-hover="off"], [data-button-motion="off"], nav, [role="menu"], [role="menuitem"], [role="toolbar"], [role="tablist"], [role="tab"], [role="listbox"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [aria-pressed], .qh-menu, .qh-lang, .qh-lang-pop, .filters, .slot-filters, .ws-presets, .qb-top-toolbar, .assembly-navigation, .slot-capacity-summary';
const unavailable = ':disabled, [disabled], [aria-disabled="true"], [aria-busy="true"], [inert], .btn.off';
const edgeScopes = '.qb-project-bar, .qb-right-dock, .assembly-preview-tools, .assembly-preview-footer, .cc-footer, .slot-tray, .slot-head-actions, .slot-group-head, .slot-actions, .slot-link-component, .slot-room-toolbar, .bf-bar, .qh-chat-ask, .qh-chat-input';
const controls = 'button, a[href], summary, input:not([type="hidden"]), select, textarea, [role="button"]';
const fine = matchMedia('(hover:hover) and (pointer:fine)');
const reduced = matchMedia('(prefers-reduced-motion:reduce)');
let current = null;
let bounds = null;
let pressed = false;
let pressedAction = null;
function nearEdge(button) {
  const box = button.getBoundingClientRect();
  if (!box.width || !box.height) return false;
  // 按最大跟随、上浮和缩放预留空间，并至少保留4px可见间距。
  const x = 12 + box.width * .0125, y = 12 + box.height * .0125;
  if (box.left < x || document.documentElement.clientWidth - box.right < x || box.top < y || innerHeight - box.bottom < y) return true;
  for (let parent = button.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'contents') continue;
    const clipX = /hidden|clip|auto|scroll/.test(style.overflowX), clipY = /hidden|clip|auto|scroll/.test(style.overflowY);
    const surface = style.backgroundImage !== 'none' || !['transparent','rgba(0, 0, 0, 0)'].includes(style.backgroundColor) ||
      ['Top','Right','Bottom','Left'].some(side => parseFloat(style['border'+side+'Width']) > 0 && !['transparent','rgba(0, 0, 0, 0)'].includes(style['border'+side+'Color']));
    if (!surface && !clipX && !clipY) continue;
    const frame = parent.getBoundingClientRect();
    if ((surface || clipX) && (box.left - frame.left < x || frame.right - box.right < x)) return true;
    if ((surface || clipY) && (box.top - frame.top < y || frame.bottom - box.bottom < y)) return true;
  }
  // 并列动作相互靠近时保留双方归位途中所需的空间，输入组合也保持稳定。
  const group = button.parentElement?.parentElement || button.parentElement;
  for (const other of group?.querySelectorAll(controls) || []) {
    if (other === button || other.contains(button) || button.contains(other)) continue;
    const rect = other.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const gapX = Math.max(rect.left - box.right, box.left - rect.right, 0);
    const gapY = Math.max(rect.top - box.bottom, box.top - rect.bottom, 0);
    if ((gapY === 0 && gapX < x + 8 + rect.width * .0125) || (gapX === 0 && gapY < y + 8 + rect.height * .0125)) return true;
  }
  return false;
}
function prepareButton(button) {
  const inset = !!button.closest(fixed + ', ' + edgeScopes) || nearEdge(button);
  if (inset) button.setAttribute('data-button-hover','inset');
  else button.removeAttribute('data-button-hover');
  return inset;
}
let scanFrame = 0;
function scanButtons() {
  if (scanFrame) return;
  scanFrame = requestAnimationFrame(() => {
    scanFrame = 0;
    for (const button of document.querySelectorAll(actions)) {
      if (button !== current) prepareButton(button);
    }
  });
}
new MutationObserver(() => { reset();stopPress();scanButtons(); }).observe(document.documentElement,{subtree:true,childList:true});
scanButtons();
document.addEventListener('pointerover',event => {
  const button = event.target instanceof Element ? event.target.closest(actions) : null;
  if (button && !(event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) prepareButton(button);
},{passive:true});
document.addEventListener('focusin',event => {
  const button = event.target instanceof Element ? event.target.closest(actions) : null;
  if (button) prepareButton(button);
});
function actionAt(target) {
  const button=target instanceof Element ? target.closest(actions) : null;
  return button && !button.closest(unavailable) && !button.closest(fixed) && !button.matches('[data-button-hover="inset"]') && (button === current || !prepareButton(button)) ? button : null;
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
const observer = new MutationObserver(records => {
  if (current?.closest(unavailable) || current?.closest(fixed) || records.some(record => record.attributeName === 'class' || record.attributeName === 'style')) {
    reset();stopPress();scanButtons();
  }
});
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
    for (let node = next; node; node = node.parentElement) observer.observe(node, { attributes:true, attributeFilter:['disabled','aria-disabled','aria-busy','inert','class','data-hover','data-button-motion',...(node === next ? [] : ['style'])] });
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
window.addEventListener('resize', () => { clear();scanButtons(); }, {passive:true});
fine.addEventListener('change', clear);
reduced.addEventListener('change', clear);
