import { NavLink, Outlet } from 'react-router-dom'
import { useDeviceSize } from '../hooks/useDeviceSize'
import './Layout.css'

const navItems = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/counter', label: 'Counter', icon: '💵' },
  { to: '/expenses', label: 'Expenses', icon: '📤' },
  { to: '/history', label: 'History', icon: '📋' },
]

export default function Layout() {
  useDeviceSize()

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
        </nav>
      </header>
      <main className="main main--fit">
        <Outlet />
      </main>
    </div>
  )
}
