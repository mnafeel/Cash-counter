import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyDeviceSize } from './hooks/useDeviceSize'
import { initFirebaseSync, flushPendingBackup, pullCloudIfNewer, refreshCloudRemoteSummary, backupMainDeviceIfNeeded } from './firebase/sync'
import { isAutoPullFromCloudEnabled, isCloudLoggedIn } from './firebase/backup'
import { initReminderNotificationSound } from './utils/reminderNotificationSound'
import { flushLocalBackupSnapshot, queueLocalBackupSnapshot } from './storage/localBackup'
import { loadData } from './storage/database'
import { applyTheme } from './utils/theme'
import './index.css'
import App from './App.tsx'

applyDeviceSize()
applyTheme()
initReminderNotificationSound()
initFirebaseSync()
queueLocalBackupSnapshot(loadData())

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushPendingBackup()
    flushLocalBackupSnapshot()
  } else if (document.visibilityState === 'visible') {
    if (isCloudLoggedIn()) void refreshCloudRemoteSummary()
    if (isAutoPullFromCloudEnabled()) void pullCloudIfNewer()
    backupMainDeviceIfNeeded()
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
