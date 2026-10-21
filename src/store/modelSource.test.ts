import {afterEach, expect, it, vi} from 'vitest'
import {readModelSource} from './modelSource'

// 隔离网络故障夹具；真实造型及服务验收另外运行。
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })
it('重试中断的读取并保留账号、凭证与响应版本', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('connection closed')).mockResolvedValueOnce(new Response('model', {headers:{'X-Library-Revision':'7'}}))
  vi.stubGlobal('fetch',fetcher)
  const result=await readModelSource('/quadro/library/one/native',{credentials:'include',headers:{'X-Builder-User-ID':'4'}})
  expect(result.text).toBe('model');expect(result.response.headers.get('X-Library-Revision')).toBe('7')
  expect(fetcher).toHaveBeenCalledTimes(2)
  for(const [,init] of fetcher.mock.calls){expect(init.credentials).toBe('include');expect(init.headers).toEqual({'X-Builder-User-ID':'4'})}
})
it('响应正文卡住也会中止，并在下一次读取成功', async () => {
  vi.useFakeTimers();vi.spyOn(console,'warn').mockImplementation(() => {})
  let firstSignal:AbortSignal
  const fetcher=vi.fn().mockImplementationOnce((_url,init)=>{firstSignal=init.signal;return Promise.resolve({ok:true,text:()=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)))})}).mockResolvedValueOnce(new Response('complete'))
  vi.stubGlobal('fetch',fetcher)
  const pending=readModelSource('/model');await vi.advanceTimersByTimeAsync(15000)
  expect((await pending).text).toBe('complete');expect(firstSignal!.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0)
})
it.each([401,403,404,409,423,429])('HTTP %s 直接交给调用方处理',async status=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(null,{status}));vi.stubGlobal('fetch',fetcher)
  expect((await readModelSource('/model')).response.status).toBe(status);expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each([502,503,504])('瞬时 HTTP %s 仅重读一次',async status=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status})).mockResolvedValueOnce(new Response('model'));vi.stubGlobal('fetch',fetcher)
  expect((await readModelSource('/model')).text).toBe('model');expect(fetcher).toHaveBeenCalledTimes(2)
})
it('连续失败保留错误，不无限重试',async()=>{
  vi.spyOn(console,'warn').mockImplementation(() => {})
  const error=new TypeError('offline'),fetcher=vi.fn().mockRejectedValue(error);vi.stubGlobal('fetch',fetcher)
  await expect(readModelSource('/model')).rejects.toBe(error);expect(fetcher).toHaveBeenCalledTimes(2)
})
it('连续两次正文超时后返回明确超时错误',async()=>{
  vi.useFakeTimers();vi.spyOn(console,'warn').mockImplementation(() => {})
  const fetcher=vi.fn((_url,init)=>Promise.resolve({ok:true,text:()=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))}));vi.stubGlobal('fetch',fetcher)
  const checked=expect(readModelSource('/model')).rejects.toMatchObject({name:'TimeoutError'})
  await vi.advanceTimersByTimeAsync(30000);await checked;expect(fetcher).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0)
})
it('调用方取消后不再重试',async()=>{
  const controller=new AbortController(),reason=new DOMException('closed','AbortError')
  vi.stubGlobal('fetch',vi.fn((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)))))
  const pending=readModelSource('/model',{signal:controller.signal});controller.abort(reason)
  await expect(pending).rejects.toBe(reason);expect(fetch).toHaveBeenCalledTimes(1)
})
