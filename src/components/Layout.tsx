import { NavLink, Outlet } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import { useDeviceSize } from '../hooks/useDeviceSize'
import { formatMoney } from '../utils/format'
import './Layout.css'

const navItems = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/counter', label: 'Counter', icon: '💵' },
  { to: '/expenses', label: 'Expenses', icon: '📤' },
  { to: '/history', label: 'History', icon: '📋' },
]

export default function Layout() {
  const { balance } = useCash()
  useDeviceSize()

  return (
    <div className="layout layout--fit">
      <header className="header header--compact">
        <div className="header-top">
          <h1 className="app-title">Cash Counter</h1>
          <div className="header-balance">
            <span className="header-balance-label">In Drawer</span>
            <span className="header-balance-value">{formatMoney(balance)}</span>
          </div>
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
