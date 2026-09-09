import { startTransition, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import MainTabs from './MainTabs'
import TabPanel from './TabPanel'
import { useDeviceSize } from '../hooks/useDeviceSize'
import { useHomePinLock } from '../hooks/useHomePinLock'
import ReminderAlertsNotifier from './ReminderAlertsNotifier'
import CloudStatusNotifier from './CloudStatusNotifier'
import OpenTimingNotifier from './OpenTimingNotifier'
import { initReminderNotificationSound } from '../utils/reminderNotificationSound'
import { normalizeRoutePath } from '../utils/hashRoute'
import { getMainTabKey, isMainTabPath, type MainTabKey } from '../utils/mainTab'
import { openTimingLabelForPath, startOpenTiming, finishOpenTiming } from '../utils/openTiming'
import './Layout.css'

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/counter', label: 'Counter', icon: '💵' },
  { to: '/expenses', label: 'Expenses', icon: '📤' },
  { to: '/history', label: 'History', icon: '📋' },
  { to: '/reports', label: 'Reports', icon: '📈' },
  { to: '/purchase', label: 'Purchase', icon: '🛒' },
  { to: '/loan', label: 'Loan', icon: '🤝' },
  { to: '/staff', label: 'Staff', icon: '👥' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
] as const

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
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (mainTab) setVisibleTab(mainTab)
  }, [mainTab])

  const displayTab = visibleTab ?? mainTab ?? '/'

  useEffect(() => {
    initReminderNotificationSound()
    startOpenTiming('App')
    requestAnimationFrame(() => {
      requestAnimationFrame(() => finishOpenTiming('App'))
    })
  }, [])

  function navigateNav(to: string) {
    const tab = getMainTabKey(to)
    const item = navItems.find((entry) => entry.to === to)
    if (item) startOpenTiming(item.label)
    if (tab) setVisibleTab(tab)
    startTransition(() => navigate(to))
    setSidebarOpen(false)
  }

  useEffect(() => {
    if (mainTab) return
    const label = openTimingLabelForPath(location.pathname)
    if (label) startOpenTiming(label)
  }, [location.pathname, mainTab])

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey) return
      if (e.code !== 'KeyQ') return

      e.preventDefault()
      const idx = getNavIndex(location.pathname)
      const next = navItems[(idx + 1) % navItems.length]
      navigateNav(next.to)
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

  const activeNavLabel = useMemo(() => {
    if (!showMainTabs) {
      const item = navItems.find((entry) => isNavActive(location.pathname, entry.to))
      return item?.label ?? openTimingLabelForPath(location.pathname)
    }
    const item = navItems.find((entry) => isNavActive(navActivePath, entry.to))
    return item?.label ?? null
  }, [showMainTabs, navActivePath, location.pathname])

  const logoUrl = `${import.meta.env.BASE_URL}logo.png`

  return (
    <div className={`layout layout--sidebar${sidebarOpen ? ' layout--sidebar-open' : ''}`}>
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close menu"
        onClick={() => setSidebarOpen(false)}
      />

      <aside className="app-sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <img src={logoUrl} alt="Shalimar Fashions" className="sidebar-logo" />
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">Shalimar Fashions</span>
            <span className="sidebar-brand-tag">Cash Counter</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <button
              key={item.to}
              type="button"
              className={`sidebar-nav-link ${isNavActive(navActivePath, item.to) || (!showMainTabs && isNavActive(location.pathname, item.to)) ? 'sidebar-nav-link--active' : ''}`}
              onClick={() => navigateNav(item.to)}
            >
              <span className="sidebar-nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <p className="sidebar-hint" aria-hidden="true">Alt+Q · next section</p>
      </aside>

      <div className="layout-shell">
        <header className="app-topbar">
          <button
            type="button"
            className="sidebar-toggle"
            aria-expanded={sidebarOpen}
            aria-label="Open menu"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <span className="sidebar-toggle-bar" />
            <span className="sidebar-toggle-bar" />
            <span className="sidebar-toggle-bar" />
          </button>
          <div className="topbar-title-wrap">
            <span className="topbar-eyebrow">Shalimar Fashions</span>
            <span className="topbar-title">{activeNavLabel ?? 'Dashboard'}</span>
          </div>
          <div className="topbar-quick-access" aria-label="Quick access">
            <button
              type="button"
              className={`topbar-quick-btn ${isNavActive(navActivePath, '/counter') ? 'topbar-quick-btn--active' : ''}`}
              onClick={() => navigateNav('/counter')}
            >
              <span aria-hidden="true">💵</span>
              Counter
            </button>
            <button
              type="button"
              className={`topbar-quick-btn ${isNavActive(navActivePath, '/expenses') ? 'topbar-quick-btn--active' : ''}`}
              onClick={() => navigateNav('/expenses')}
            >
              <span aria-hidden="true">📤</span>
              Expenses
            </button>
          </div>
        </header>

        <main className="main main--fit">
          {showMainTabs ? <MainTabs activeTab={displayTab} /> : null}
          <TabPanel hidden={showMainTabs}>
            <Outlet />
          </TabPanel>
        </main>
      </div>

      <ReminderAlertsNotifier />
      <CloudStatusNotifier />
      <OpenTimingNotifier
        navLabels={navItems.map((item) => item.label)}
        activeNavLabel={activeNavLabel}
      />
    </div>
  )
}
