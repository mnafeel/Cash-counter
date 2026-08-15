import { startTransition, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import KeepAliveOutlet from './KeepAliveOutlet'
import { useCashBooting } from '../context/CashContext'
import { useDeviceSize } from '../hooks/useDeviceSize'
import { useHomePinLock } from '../hooks/useHomePinLock'
import AppBootScreen from './AppBootScreen'
import ReminderAlertsNotifier from './ReminderAlertsNotifier'
import CloudStatusNotifier from './CloudStatusNotifier'
import { initReminderNotificationSound } from '../utils/reminderNotificationSound'
import { normalizeRoutePath } from '../utils/hashRoute'
import './Layout.css'

const navItems = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/counter', label: 'Counter', icon: '💵' },
  { to: '/expenses', label: 'Expenses', icon: '📤' },
  { to: '/history', label: 'History', icon: '📋' },
]

function getNavIndex(pathname: string): number {
  const path = normalizeRoutePath(pathname)
  if (path === '/' || path === '') return 0
  const idx = navItems.findIndex((item) => item.to !== '/' && path.startsWith(item.to))
  return idx >= 0 ? idx : 0
}

function isNavActive(pathname: string, to: string): boolean {
  const path = normalizeRoutePath(pathname)
  if (to === '/') return path === '/' || path === ''
  return path === to || path.startsWith(`${to}/`)
}

export default function Layout() {
  useDeviceSize()
  useHomePinLock()
  const dataBooting = useCashBooting()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    initReminderNotificationSound()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey) return
      if (e.code !== 'KeyQ') return

      e.preventDefault()
      const idx = getNavIndex(location.pathname)
      const next = navItems[(idx + 1) % navItems.length]
      startTransition(() => navigate(next.to))
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [location.pathname, navigate])

  return (
    <div className="layout layout--fit">
      {dataBooting ? (
        <div className="layout-boot-overlay">
          <AppBootScreen />
        </div>
      ) : null}
      <header className="header header--compact">
        <div className="header-top">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt="Shalimar Fashions"
            className="app-logo"
          />
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <button
              key={item.to}
              type="button"
              className={`nav-link ${isNavActive(location.pathname, item.to) ? 'active' : ''}`}
              onClick={() => startTransition(() => navigate(item.to))}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
          <span className="nav-shortcut-hint" aria-hidden="true">
            Alt+Q
          </span>
        </nav>
      </header>
      <main className="main main--fit">
        <KeepAliveOutlet />
      </main>
      <ReminderAlertsNotifier />
      <CloudStatusNotifier />
    </div>
  )
}
