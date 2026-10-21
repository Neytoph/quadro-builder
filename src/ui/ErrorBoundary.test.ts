import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import ErrorBoundary from './ErrorBoundary'
import {track} from '../analytics/track'

// 隔离渲染故障契约；不代替真实模型验收。
vi.mock('../entry',()=>({EDITOR_EMBED:true}))
vi.mock('../i18n',()=>({useI18n:()=>({t:(key:string)=>key})}))
vi.mock('../analytics/track',()=>({track:vi.fn(),flushNow:vi.fn()}))

it('嵌入组件崩溃立即向父窗口报告，原始消息不进入遥测',async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  const host=document.createElement('div');document.body.append(host)
  const root=createRoot(host),send=vi.spyOn(window.parent,'postMessage').mockImplementation(()=>{}),logging=vi.spyOn(console,'error').mockImplementation(()=>{})
  function Broken():never{throw new Error('private-model failed to render')}
  try{
    await act(async()=>{root.render(createElement(ErrorBoundary,null,createElement(Broken)))})
    expect(send).toHaveBeenCalledWith({type:'xmf-model-editor:error',message:'error.title: private-model failed to render'},location.origin)
    expect(host.textContent).toContain('private-model failed to render')
    expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toContain('private-model')
  }finally{await act(async()=>root.unmount());host.remove();send.mockRestore();logging.mockRestore();vi.unstubAllGlobals()}
})
