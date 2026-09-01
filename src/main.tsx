import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { startSyncIfConfigured } from './sync/bootstrap'

startSyncIfConfigured()   // 未配置 VITE_SYNC_BASE 时为空操作

createRoot(document.getElementById('root')!).render(<App />)
