import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {clearSlotAccess,updateSlotAccess,slotLocked} from './slotAccess'
beforeEach(()=>{clearSlotAccess();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-16T00:00:00Z'))})
afterEach(()=>vi.useRealTimers())
it('永久位保持可用，租位到期在下一次轮询前也停止导出和复制资格',()=>{
 updateSlotAccess([{kind:'save',active:true,object:{id:'permanent',docId:'p',backend:'1'}},{kind:'save',active:true,endsAt:'2026-10-16T00:00:01Z',object:{id:'rental',docId:'r',backend:'2'}}])
 expect(slotLocked('r')).toBe(false)
 vi.advanceTimersByTime(1001)
 expect(slotLocked('r')).toBe(true);expect(slotLocked('p')).toBe(false)
})
it('统一身份换到有效位恢复；源已转换离开后拒绝旧身份；切换账号清除旧能力',()=>{
 updateSlotAccess([{kind:'save',active:false,object:{id:'model',docId:'old',backend:'1'}}])
 expect(slotLocked(null,'model')).toBe(true)
 updateSlotAccess([{kind:'save',active:true,object:{id:'model',docId:'new',backend:'2'}}])
 expect(slotLocked('old','model')).toBe(false)
 updateSlotAccess([]);expect(slotLocked(null,'model')).toBe(true)
 clearSlotAccess();expect(slotLocked(null,'model')).toBe(false)
})
