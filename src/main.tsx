import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { startAnalytics, track } from './analytics/track'
import { startSyncIfConfigured } from './sync/bootstrap'

startAnalytics()          // 未配置 VITE_ANALYTICS_URL 时为空操作
// 屏幕宽度只记档位不记具体像素——具体像素太接近指纹，
// 档位足够回答"有多少人在小屏上用"。
track('builder.app.open', {
  w: innerWidth < 900 ? 'small' : innerWidth < 1440 ? 'medium' : 'large',
  touch: matchMedia('(pointer: coarse)').matches,
})
// 未配置 VITE_SYNC_BASE 时为空操作。
// 第二个参数处理"壳是缓存给的、入口闸门没生效"这种情况：退掉 Service Worker
// 再走一次网络，去哪儿由服务端决定——这里不写死任何地址，换个部署也成立。
startSyncIfConfigured(undefined, () => {
  void (async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.unregister()
    } catch { /* 不支持或被禁用：直接重载，反正没有 SW 拦着 */ }
    location.reload()
  })()
})

createRoot(document.getElementById('root')!).render(<App />)
