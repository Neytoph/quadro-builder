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
startSyncIfConfigured()   // 未配置 VITE_SYNC_BASE 时为空操作

createRoot(document.getElementById('root')!).render(<App />)
