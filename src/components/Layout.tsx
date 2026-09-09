import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import MainTabs from './MainTabs'
import TabPanel from './TabPanel'
import PinEntry from './PinEntry'
import { useCashActions } from '../context/CashContext'
import { loginCloud } from '../firebase/backup'
import { getLastCloudUsername } from '../firebase/cloudUser'
import { useDeviceSize } from '../hooks/useDeviceSize'
import { useAppRouteLocks } from '../hooks/useAppRouteLocks'
import { useCashSnapshot } from '../hooks/useCashSnapshot'
import { getPinEntryLength, verifyUserPin } from '../utils/accessPin'
import {
  isPinProtectedMainTab,
  isPinProtectedRoute,
} from '../utils/pinProtectedRoutes'
import NotificationsBell from './NotificationsBell'
import CloudStatusNotifier from './CloudStatusNotifier'
import OpenTimingNotifier from './OpenTimingNotifier'
import PinLockCountdown from './PinLockCountdown'
import SidebarCloudLogout from './SidebarCloudLogout'
import { initReminderNotificationSound } from '../utils/reminderNotificationSound'
import { normalizeRoutePath } from '../utils/hashRoute'
import { getMainTabKey, isMainTabPath, type MainTabKey } from '../utils/mainTab'
import { openTimingLabelForPath, startOpenTiming, finishOpenTiming } from '../utils/openTiming'
import './Layout.css'

const SIDEBAR_COLLAPSED_KEY = 'sof-sidebar-collapsed'

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/counter', label: 'Counter', icon: '💵' },
  { to: '/expenses', label: 'Expenses', icon: '📤' },
  { to: '/history', label: 'History', icon: '📋' },
  { to: '/reports', label: 'Reports', icon: '📈' },
  { to: '/purchase', label: 'Purchase Expense', icon: '🛒' },
  { to: '/loan', label: 'Loan', icon: '🤝' },
  { to: '/staff', label: 'Staff & Salary', icon: '👥' },
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

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export default function Layout() {
  useDeviceSize()
  useAppRouteLocks()
  const navigate = useNavigate()
  const location = useLocation()
  const { homeUnlocked, data, pinSessionLastActivityAt } = useCashSnapshot(true)
  const { unlockHome, updateHomePin, setProtectedRouteActive, touchProtectedSession } =
    useCashActions()
  const mainTab = getMainTabKey(location.pathname)
  const showMainTabs = isMainTabPath(location.pathname)
  const [visibleTab, setVisibleTab] = useState<MainTabKey | null>(mainTab)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const [navTransition, setNavTransition] = useState(false)
  const navTransitionTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (mainTab) setVisibleTab(mainTab)
  }, [mainTab])

  const displayTab = visibleTab ?? mainTab ?? '/'

  const pinProtected = isPinProtectedRoute(location.pathname)
  const showMainTabPin = showMainTabs && isPinProtectedMainTab(displayTab) && !homeUnlocked
  const showProtectedPin = !showMainTabs && pinProtected && !homeUnlocked

  useEffect(() => {
    setProtectedRouteActive(pinProtected)
  }, [pinProtected, setProtectedRouteActive])

  useEffect(() => {
    if (homeUnlocked && pinProtected) {
      touchProtectedSession()
    }
  }, [location.pathname, homeUnlocked, pinProtected, touchProtectedSession])

  useEffect(() => {
    initReminderNotificationSound()
    startOpenTiming('App')
    requestAnimationFrame(() => {
      requestAnimationFrame(() => finishOpenTiming('App'))
    })
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed])

  function triggerNavTransition() {
    setNavTransition(true)
    if (navTransitionTimerRef.current !== null) {
      window.clearTimeout(navTransitionTimerRef.current)
    }
    navTransitionTimerRef.current = window.setTimeout(() => setNavTransition(false), 340)
  }

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
      triggerNavTransition()
      const idx = getNavIndex(location.pathname)
      const next = navItems[(idx + 1) % navItems.length]
      navigateNav(next.to)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [location.pathname])

  useEffect(() => {
    return () => {
      if (navTransitionTimerRef.current !== null) {
        window.clearTimeout(navTransitionTimerRef.current)
      }
    }
  }, [])

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

  const layoutClassName = [
    'layout',
    'layout--sidebar',
    sidebarOpen ? 'layout--sidebar-open' : '',
    sidebarCollapsed ? 'layout--sidebar-collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const mainClassName = [
    'main',
    'main--fit',
    showMainTabPin || showProtectedPin ? 'main--fit-pin-gate' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const pinEntry = (
    <PinEntry
      title="Enter PIN"
      verifyPin={(pin) => verifyUserPin(data, pin)}
      onUnlock={unlockHome}
      pinLength={getPinEntryLength(data)}
      defaultCloudUsername={getLastCloudUsername() ?? ''}
      onForgotPin={async ({ username, password, newPin }) => {
        await loginCloud(username, password)
        updateHomePin(newPin)
        unlockHome()
      }}
    />
  )

  return (
    <div className={layoutClassName}>
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
          <button
            type="button"
            className="sidebar-collapse-btn"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            onClick={() => setSidebarCollapsed(true)}
          >
            ‹
          </button>
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

        <OpenTimingNotifier activeNavLabel={activeNavLabel} />
        <p className="sidebar-hint" aria-hidden="true">Alt+Q · next section</p>
        <SidebarCloudLogout />
      </aside>

      <div className={`layout-shell${navTransition ? ' layout-shell--switching' : ''}`}>
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
          <button
            type="button"
            className="sidebar-expand-btn"
            aria-label="Expand sidebar"
            title="Show sidebar"
            onClick={() => setSidebarCollapsed(false)}
          >
            ☰
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
            <button
              type="button"
              className={`topbar-quick-btn ${isNavActive(navActivePath, '/history') ? 'topbar-quick-btn--active' : ''}`}
              onClick={() => navigateNav('/history')}
            >
              <span aria-hidden="true">📋</span>
              History
            </button>
            <NotificationsBell placement="topbar" />
          </div>
        </header>

        <main className={mainClassName}>
          {showMainTabs ? (
            <>
              <MainTabs activeTab={displayTab} />
              {showMainTabPin ? <div className="main-tab-pin-gate">{pinEntry}</div> : null}
            </>
          ) : showProtectedPin ? (
            pinEntry
          ) : (
            <TabPanel hidden={false}>
              <Outlet />
            </TabPanel>
          )}
        </main>
      </div>

      {homeUnlocked && pinSessionLastActivityAt ? (
        <PinLockCountdown lastActivityAt={pinSessionLastActivityAt} />
      ) : null}

      <CloudStatusNotifier />
    </div>
  )
}
