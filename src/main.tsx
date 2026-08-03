import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyDeviceSize } from './hooks/useDeviceSize'
import { initReminderNotificationSound } from './utils/reminderNotificationSound'
import { applyTheme } from './utils/theme'
import './index.css'
import App from './App.tsx'

applyDeviceSize()
applyTheme()
initReminderNotificationSound()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

function startBackgroundServices() {
  void import('./firebase/sync').then(({ initFirebaseSync, flushPendingBackup, pullCloudIfNewer, refreshCloudRemoteSummary, backupMainDeviceIfNeeded }) => {
    void import('./firebase/backup').then(({ isAutoPullFromCloudEnabled, isCloudLoggedIn }) => {
      initFirebaseSync()
      void import('./storage/localBackup').then(({ flushLocalBackupSnapshot, queueLocalBackupSnapshot }) => {
        void import('./storage/database').then(({ loadData }) => {
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
        })
      })
    })
  })
}

if (typeof window.requestIdleCallback === 'function') {
  window.requestIdleCallback(() => startBackgroundServices(), { timeout: 2000 })
} else {
  window.setTimeout(startBackgroundServices, 0)
}
