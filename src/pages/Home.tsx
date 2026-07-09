import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import BigAmount from '../components/BigAmount'
import NumberKeyboard from '../components/NumberKeyboard'
import { formatMoney } from '../utils/format'
import { applyPinAction, normalizePin, type NumpadAction } from '../utils/numpad'
import './Home.css'

const DEFAULT_PIN = '0000'

export default function Home() {
  const { balance, bankBalance, data } = useCash()
  const [unlocked, setUnlocked] = useState(false)
  const [pinStr, setPinStr] = useState('')
  const [pinError, setPinError] = useState(false)

  const homePin = normalizePin(data.homePin, DEFAULT_PIN)

  useEffect(() => {
    return () => {
      setUnlocked(false)
      setPinStr('')
    }
  }, [])

  const today = new Date().toDateString()
  const todaySales = data.sales.filter(
    (s) => new Date(s.createdAt).toDateString() === today,
  )
  const todayExpenses = data.expenses.filter(
    (e) => new Date(e.createdAt).toDateString() === today && e.kind !== 'add',
  )

  const todaySalesTotal = todaySales.reduce((sum, s) => sum + s.billAmount, 0)
  const todayExpensesTotal = todayExpenses.reduce((sum, e) => sum + e.amount, 0)

  function tryUnlock(nextPin: string) {
    if (nextPin === homePin) {
      setUnlocked(true)
      setPinStr('')
      setPinError(false)
      return
    }
    setPinError(true)
    setPinStr('')
  }

  function handlePinNumpad(action: NumpadAction) {
    if (action === 'enter') {
      if (pinStr.length === 4) tryUnlock(pinStr)
      return
    }
    if (action === 'clear') {
      setPinStr('')
      setPinError(false)
      return
    }

    const next = applyPinAction(pinStr, action)
    setPinStr(next)
    setPinError(false)
    if (next.length === 4) tryUnlock(next)
  }

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
      title: 'Expenses',
      desc: 'Expenses or add to counter/bank',
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
      desc: 'Opening balances & home PIN',
      icon: '⚙️',
      color: 'gray',
    },
  ]

  if (!unlocked) {
    return (
      <div className="home home--locked">
        <section className="home-pin">
          <p className="home-pin-label">Enter 4-digit PIN</p>
          <div className={`home-pin-dots ${pinError ? 'home-pin-dots--error' : ''}`}>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`home-pin-dot ${pinStr.length > i ? 'home-pin-dot--filled' : ''}`}
              />
            ))}
          </div>
          {pinError && <p className="home-pin-error">Wrong PIN. Try again.</p>}
          <div className="home-pin-keyboard">
            <NumberKeyboard onPress={handlePinNumpad} showEnter={false} />
          </div>
          <p className="home-pin-hint">Default PIN: 0000 — change in Settings</p>
        </section>
      </div>
    )
  }

  return (
    <div className="home">
      <section className="home-balances">
        <div className="home-balance-card">
          <p className="home-hero-label">💵 Cash in Drawer</p>
          <BigAmount label="" value={balance} variant="primary" size="lg" />
        </div>
        <div className="home-balance-card home-balance-card--bank">
          <p className="home-hero-label">🏦 Bank Balance</p>
          <BigAmount label="" value={bankBalance} variant="primary" size="lg" />
        </div>
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
