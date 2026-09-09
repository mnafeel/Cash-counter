import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { useCashActions } from '../context/CashContext'
import {
  clearLocalLastBackupTime,
  getCloudUsername,
  logoutCloud,
  subscribeToAuth,
} from '../firebase/backup'
import { clearAllLocalBackupSnapshots } from '../storage/localBackup'
import './SidebarCloudLogout.css'

export default function SidebarCloudLogout() {
  const { resetAllData } = useCashActions()
  const [cloudUser, setCloudUser] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => subscribeToAuth(setCloudUser), [])

  if (!cloudUser) return null

  async function handleLogout() {
    const ok = window.confirm(
      'Log out of cloud? Local data on this device will be cleared. Your cloud backup stays safe.',
    )
    if (!ok) return

    setBusy(true)
    try {
      await logoutCloud()
      resetAllData()
      clearLocalLastBackupTime()
      await clearAllLocalBackupSnapshots()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Cloud logout failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sidebar-cloud-footer">
      <p className="sidebar-cloud-user" title={getCloudUsername(cloudUser)}>
        ☁️ {getCloudUsername(cloudUser)}
      </p>
      <button
        type="button"
        className="sidebar-cloud-logout"
        onClick={() => void handleLogout()}
        disabled={busy}
      >
        {busy ? 'Logging out…' : 'Logout'}
      </button>
    </div>
  )
}
