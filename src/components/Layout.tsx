import { startTransition, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import MainTabs from './MainTabs'
import TabPanel from './TabPanel'
import { useDeviceSize } from '../hooks/useDeviceSize'
import { useHomePinLock } from '../hooks/useHomePinLock'
import ReminderAlertsNotifier from './ReminderAlertsNotifier'
import CloudStatusNotifier from './CloudStatusNotifier'
import { initReminderNotificationSound } from '../utils/reminderNotificationSound'
import { normalizeRoutePath } from '../utils/hashRoute'
import { getMainTabKey, isMainTabPath, type MainTabKey } from '../utils/mainTab'
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
  const navigate = useNavigate()
  const location = useLocation()
  const mainTab = getMainTabKey(location.pathname)
  const showMainTabs = isMainTabPath(location.pathname)
  const [visibleTab, setVisibleTab] = useState<MainTabKey | null>(mainTab)

  useEffect(() => {
    if (mainTab) setVisibleTab(mainTab)
  }, [mainTab])

  const displayTab = visibleTab ?? mainTab ?? '/'

  useEffect(() => {
    initReminderNotificationSound()
  }, [])

  function navigateMainTab(to: string) {
    const tab = getMainTabKey(to)
    if (tab) setVisibleTab(tab)
    startTransition(() => navigate(to))
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey) return
      if (e.code !== 'KeyQ') return

      e.preventDefault()
      const idx = getNavIndex(location.pathname)
      const next = navItems[(idx + 1) % navItems.length]
      navigateMainTab(next.to)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [location.pathname])

  const navActivePath =
    showMainTabs && visibleTab
      ? visibleTab === '/'
        ? '/'
        : visibleTab
      : location.pathname

  return (
    <div className="layout layout--fit">
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
              className={`nav-link ${isNavActive(navActivePath, item.to) ? 'active' : ''}`}
              onClick={() => navigateMainTab(item.to)}
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
        {showMainTabs ? <MainTabs activeTab={displayTab} /> : null}
        <TabPanel hidden={showMainTabs}>
          <Outlet />
        </TabPanel>
      </main>
      <ReminderAlertsNotifier />
      <CloudStatusNotifier />
    </div>
  )
}
