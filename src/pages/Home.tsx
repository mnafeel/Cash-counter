import { Link } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import BigAmount from '../components/BigAmount'
import { formatMoney } from '../utils/format'
import './Home.css'

export default function Home() {
  const { balance, data } = useCash()

  const today = new Date().toDateString()
  const todaySales = data.sales.filter(
    (s) => new Date(s.createdAt).toDateString() === today,
  )
  const todayExpenses = data.expenses.filter(
    (e) => new Date(e.createdAt).toDateString() === today,
  )

  const todaySalesTotal = todaySales.reduce((sum, s) => sum + s.billAmount, 0)
  const todayExpensesTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0)

  const cards = [
    {
      to: '/counter',
      title: 'Cash Counter',
      desc: 'Bill amount, customer pay & return change',
      icon: '💵',
      color: 'green',
    },
    {
      to: '/expenses',
      title: 'Cash Expenses',
      desc: 'Record money going out of drawer',
      icon: '📤',
      color: 'orange',
    },
    {
      to: '/history',
      title: 'History',
      desc: 'All saved bills and expenses',
      icon: '📋',
      color: 'blue',
    },
    {
      to: '/settings',
      title: 'Settings',
      desc: 'Set opening cash in drawer',
      icon: '⚙️',
      color: 'gray',
    },
  ]

  return (
    <div className="home">
      <section className="home-hero">
        <p className="home-hero-label">Current Cash in Drawer</p>
        <BigAmount label="" value={balance} variant="primary" size="xl" />
      </section>

      <section className="home-stats">
        <div className="stat-card">
          <span className="stat-label">Today Sales</span>
          <span className="stat-value stat-value--green">{formatMoney(todaySalesTotal)}</span>
          <span className="stat-meta">{todaySales.length} bills</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Today Expenses</span>
          <span className="stat-value stat-value--orange">{formatMoney(todayExpensesTotal)}</span>
          <span className="stat-meta">{todayExpenses.length} items</span>
        </div>
      </section>

      <section className="home-grid">
        {cards.map((card) => (
          <Link key={card.to} to={card.to} className={`home-card home-card--${card.color}`}>
            <span className="home-card-icon">{card.icon}</span>
            <div className="home-card-text">
              <h2>{card.title}</h2>
              <p>{card.desc}</p>
            </div>
            <span className="home-card-arrow">→</span>
          </Link>
        ))}
      </section>
    </div>
  )
}
