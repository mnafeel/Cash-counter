import { useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useDeviceSize } from '../hooks/useDeviceSize'
import './Layout.css'

const navItems = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/counter', label: 'Counter', icon: '💵' },
  { to: '/expenses', label: 'Expenses', icon: '📤' },
  { to: '/history', label: 'History', icon: '📋' },
]

function getNavIndex(pathname: string): number {
  if (pathname === '/' || pathname === '') return 0
  const idx = navItems.findIndex((item) => item.to !== '/' && pathname.startsWith(item.to))
  return idx >= 0 ? idx : 0
}

export default function Layout() {
  useDeviceSize()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey) return
      if (e.code !== 'KeyQ') return

      e.preventDefault()
      const idx = getNavIndex(location.pathname)
      const next = navItems[(idx + 1) % navItems.length]
      navigate(next.to)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [location.pathname, navigate])

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
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
          <span className="nav-shortcut-hint" aria-hidden="true">
            Alt+Q
          </span>
        </nav>
      </header>
      <main className="main main--fit">
        <Outlet />
      </main>
    </div>
  )
}
