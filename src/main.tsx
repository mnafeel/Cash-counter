import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyDeviceSize } from './hooks/useDeviceSize'
import { initFirebaseSync, flushPendingBackup, pullCloudIfNewer, refreshCloudRemoteSummary } from './firebase/sync'
import { isAutoPullFromCloudEnabled, isCloudLoggedIn } from './firebase/backup'
import { flushLocalBackupSnapshot, queueLocalBackupSnapshot } from './storage/localBackup'
import { loadData } from './storage/database'
import { applyTheme } from './utils/theme'
import './index.css'
import App from './App.tsx'

applyDeviceSize()
applyTheme()
initFirebaseSync()
queueLocalBackupSnapshot(loadData())

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushPendingBackup()
    flushLocalBackupSnapshot()
  } else if (document.visibilityState === 'visible') {
    if (isCloudLoggedIn()) void refreshCloudRemoteSummary()
    if (isAutoPullFromCloudEnabled()) void pullCloudIfNewer()
  }
})
window.addEventListener('pagehide', () => {
  flushPendingBackup()
  flushLocalBackupSnapshot()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
