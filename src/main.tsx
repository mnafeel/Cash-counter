import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyDeviceSize } from './hooks/useDeviceSize'
import { initFirebaseSync, flushPendingBackup, pullCloudIfNewer } from './firebase/sync'
import { applyTheme } from './utils/theme'
import './index.css'
import App from './App.tsx'

applyDeviceSize()
applyTheme()
initFirebaseSync()

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushPendingBackup()
  } else if (document.visibilityState === 'visible') {
    void pullCloudIfNewer()
  }
})
window.addEventListener('pagehide', () => flushPendingBackup())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
