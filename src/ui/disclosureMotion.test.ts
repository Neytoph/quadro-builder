// @vitest-environment happy-dom
import {afterEach,describe,it,expect,vi} from 'vitest'
const media={matches:false,listeners:new Set<()=>void>()}
vi.stubGlobal('matchMedia',()=>({get matches(){return media.matches},addEventListener:(_type:string,listener:()=>void)=>media.listeners.add(listener)}))
const {disclosureMotion:motion}=await import('../../public/disclosure-motion.js')

afterEach(()=>{motion.dispose(document.body);document.body.replaceChildren();media.matches=false;vi.restoreAllMocks()})
function fixture(markup:string){const root=document.createElement('div');root.innerHTML=markup;document.body.append(root);return root}
function animations(){const pending:{onfinish:(()=>void)|null;cancel:ReturnType<typeof vi.fn>}[]=[];vi.spyOn(Element.prototype,'animate').mockImplementation(()=>{const animation={onfinish:null,cancel:vi.fn()};pending.push(animation);return animation as unknown as Animation});return pending}
describe('双向展开过渡的生命周期',()=>{
  it('收起期间移出键盘焦点，反向打开取消旧动画，完成后恢复自然高度',()=>{
    const root=fixture('<button>展开</button><div hidden><input></div>'),panel=root.querySelector('div')!,trigger=root.querySelector('button')!
    const pending=animations()
    motion.set(panel,true,{trigger});expect(panel.hidden).toBe(false);expect(trigger.getAttribute('aria-expanded')).toBe('true')
    panel.querySelector('input')!.focus();motion.set(panel,false,{trigger});expect(document.activeElement).toBe(trigger);expect(panel.inert).toBe(true)
    const stale=pending[1].onfinish;motion.set(panel,true,{trigger});stale?.();expect(panel.hidden).toBe(false)
    pending[2].onfinish?.();expect(panel.style.overflow).toBe('');expect(panel.style.height).toBe('');expect(panel.inert).toBe(false)
  })
  it('原生details保留全部子节点，关闭完成才隐藏内容；嵌套按钮不触发展开',()=>{
    const root=fixture('<details><summary>详情<button type="button">帮助</button></summary><p>信息</p><input></details>'),details=root.querySelector('details')!,summary=root.querySelector('summary')!
    const pending=animations();root.querySelector('button')!.addEventListener('click',event=>event.preventDefault());root.querySelector('button')!.click();expect(details.open).toBe(false)
    summary.click();expect(details.open).toBe(true);expect(pending).toHaveLength(1);pending[0].onfinish?.()
    summary.click();expect(details.open).toBe(true);expect(root.querySelector('input')!.inert).toBe(true);pending[1].onfinish?.();expect(details.open).toBe(false)
    expect(details.children).toHaveLength(3);expect(root.querySelector('input')!.inert).toBe(false)
  })
  it('已关闭区域不闪现；移除中的菜单只执行一次收尾',()=>{
    const root=fixture('<div hidden>收起内容</div><aside>菜单</aside>'),panel=root.querySelector('div')!,menu=root.querySelector('aside')!,done=vi.fn()
    const pending=animations();motion.set(panel,false);expect(pending).toHaveLength(0);expect(panel.hidden).toBe(true)
    motion.set(menu,false,{floating:true,onFinish:done});motion.set(menu,false,{floating:true,onFinish:done});expect(pending).toHaveLength(1)
    motion.dispose(root);expect(done).toHaveBeenCalledTimes(1);expect(menu.hidden).toBe(true)
  })
  it('减少动态效果切换会立即结束当前动画，后续开合即时完成',()=>{
    const root=fixture('<div hidden><button>内容</button></div>'),panel=root.querySelector('div')!,pending=animations()
    motion.set(panel,true);expect(pending).toHaveLength(1)
    media.matches=true;media.listeners.forEach(listener=>listener());expect(pending[0].cancel).toHaveBeenCalled();expect(panel.style.overflow).toBe('')
    motion.set(panel,false);expect(panel.hidden).toBe(true);expect(pending).toHaveLength(1)
    motion.set(panel,true);expect(panel.hidden).toBe(false);expect(panel.inert).toBe(false);expect(pending).toHaveLength(1)
  })
})
