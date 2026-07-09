import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import BigAmount from '../components/BigAmount'
import NumberKeyboard from '../components/NumberKeyboard'
import { formatMoney, parseAmount } from '../utils/format'
import { applyNumpadAction, applyPinAction, normalizePin, type NumpadAction } from '../utils/numpad'
import type { ExpensePayType, TransferDirection } from '../types'
import './Home.css'

const DEFAULT_PIN = '0000'

type PanelField = 'note' | 'amount'

export default function Home() {
  const { balance, bankBalance, data, recordExpense, recordTransfer } = useCash()
  const [unlocked, setUnlocked] = useState(false)
  const [pinStr, setPinStr] = useState('')
  const [pinError, setPinError] = useState(false)
  const [addTarget, setAddTarget] = useState<ExpensePayType | null>(null)
  const [transferDirection, setTransferDirection] = useState<TransferDirection | null>(null)
  const [panelNote, setPanelNote] = useState('')
  const [panelAmountStr, setPanelAmountStr] = useState('')
  const [panelField, setPanelField] = useState<PanelField>('note')
  const [panelSaved, setPanelSaved] = useState(false)
  const [panelError, setPanelError] = useState('')
  const noteInputRef = useRef<HTMLInputElement>(null)

  const homePin = normalizePin(data.homePin, DEFAULT_PIN)
  const panelAmount = parseAmount(panelAmountStr)
  const panelNoteValid = panelNote.trim().length > 0
  const panelAmountValid = panelAmount > 0

  const transferSourceBalance =
    transferDirection === 'cash-to-bank'
      ? balance
      : transferDirection === 'bank-to-cash'
        ? bankBalance
        : 0

  const hasEnoughForTransfer =
    !transferDirection || !panelAmountValid || panelAmount <= transferSourceBalance

  const panelValid =
    panelNoteValid &&
    panelAmountValid &&
    (transferDirection ? hasEnoughForTransfer : true)

  useEffect(() => {
    return () => {
      setUnlocked(false)
      setPinStr('')
    }
  }, [])

  useEffect(() => {
    if (addTarget || transferDirection) noteInputRef.current?.focus()
  }, [addTarget, transferDirection])

  const today = new Date().toDateString()
  const todaySales = data.sales.filter(
    (s) => new Date(s.createdAt).toDateString() === today,
  )
  const todayExpenses = data.expenses.filter(
    (e) => new Date(e.createdAt).toDateString() === today && e.kind === 'expense',
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

  function resetPanel() {
    setPanelNote('')
    setPanelAmountStr('')
    setPanelField('note')
    setPanelSaved(false)
    setPanelError('')
  }

  function openAdd(target: ExpensePayType) {
    setTransferDirection(null)
    setAddTarget(target)
    resetPanel()
  }

  function openTransfer(direction: TransferDirection) {
    setAddTarget(null)
    setTransferDirection(direction)
    resetPanel()
  }

  function closePanel() {
    setAddTarget(null)
    setTransferDirection(null)
    resetPanel()
  }

  function handlePanelSave() {
    if (!panelValid || panelSaved) return

    if (transferDirection) {
      if (!hasEnoughForTransfer) {
        setPanelError(
          transferDirection === 'cash-to-bank'
            ? 'Not enough cash in drawer.'
            : 'Not enough bank balance.',
        )
        return
      }
      recordTransfer({
        amount: panelAmount,
        name: panelNote.trim(),
        direction: transferDirection,
      })
    } else if (addTarget) {
      recordExpense({
        amount: panelAmount,
        name: panelNote.trim(),
        payType: addTarget,
        kind: 'add',
      })
    } else {
      return
    }

    setPanelSaved(true)
    setTimeout(closePanel, 700)
  }

  function handlePanelNumpad(action: NumpadAction) {
    if (action === 'enter') {
      setPanelField((f) => (f === 'note' ? 'amount' : 'note'))
      return
    }
    if (panelField === 'amount') {
      setPanelAmountStr((prev) => applyNumpadAction(prev, action))
      setPanelError('')
    }
  }

  const panelOpen = addTarget !== null || transferDirection !== null
  const panelTitle = transferDirection
    ? transferDirection === 'cash-to-bank'
      ? 'Cash → Bank Transfer'
      : 'Bank → Cash Transfer'
    : addTarget === 'bank'
      ? 'Add to Bank'
      : 'Add to Counter'

  const panelAmountLabel = transferDirection ? 'Transfer Amount' : 'Amount to Add'

  const panelSaveLabel = panelSaved
    ? '✓ Saved'
    : transferDirection
      ? 'Transfer'
      : addTarget === 'bank'
        ? 'Add to Bank'
        : 'Add to Counter'

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
      desc: 'Record cash or bank expenses',
      icon: '📤',
      color: 'orange',
    },
    {
      to: '/history',
      title: 'History',
      desc: 'Search, filter & sort records',
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
        <div className="home-balance-row">
          <div className="home-balance-card">
            <div className="home-balance-head">
              <p className="home-hero-label">💵 Cash in Drawer</p>
              <button type="button" className="home-add-btn" onClick={() => openAdd('cash')}>
                + Add
              </button>
            </div>
            <BigAmount label="" value={balance} variant="primary" size="lg" />
          </div>
          <div className="home-balance-card home-balance-card--bank">
            <div className="home-balance-head">
              <p className="home-hero-label">🏦 Bank Balance</p>
              <button type="button" className="home-add-btn" onClick={() => openAdd('bank')}>
                + Add
              </button>
            </div>
            <BigAmount label="" value={bankBalance} variant="primary" size="lg" />
          </div>
        </div>

        <div className="home-transfers">
          <button
            type="button"
            className="home-transfer-btn"
            onClick={() => openTransfer('cash-to-bank')}
          >
            💵 → 🏦 Cash to Bank
          </button>
          <button
            type="button"
            className="home-transfer-btn"
            onClick={() => openTransfer('bank-to-cash')}
          >
            🏦 → 💵 Bank to Cash
          </button>
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

      {panelOpen && (
        <div className="home-add-overlay" role="dialog" aria-modal="true">
          <div className="home-add-panel">
            <div className="home-add-panel-head">
              <h3>{panelTitle}</h3>
              <button type="button" className="home-add-close" onClick={closePanel} aria-label="Close">
                ✕
              </button>
            </div>

            {transferDirection && (
              <p className="home-panel-available">
                Available: {formatMoney(transferSourceBalance)}
              </p>
            )}

            <label className="home-add-note">
              <span className="home-add-note-label">Note</span>
              <input
                ref={noteInputRef}
                type="text"
                className={`home-add-note-input ${panelField === 'note' ? 'home-add-note-input--active' : ''}`}
                value={panelNote}
                onChange={(e) => setPanelNote(e.target.value)}
                onFocus={() => setPanelField('note')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    setPanelField('amount')
                  }
                }}
                placeholder={
                  transferDirection
                    ? 'Required — e.g. Deposit to bank, Withdraw cash'
                    : 'Required — e.g. Opening cash, Bank deposit'
                }
                autoComplete="off"
              />
            </label>

            <AmountDisplay
              label={panelAmountLabel}
              value={panelAmountStr}
              active={panelField === 'amount'}
              onSelect={() => setPanelField('amount')}
              compact
            />

            {panelError && <p className="home-panel-error">{panelError}</p>}

            <div className="home-add-keyboard">
              <NumberKeyboard onPress={handlePanelNumpad} />
            </div>

            <div className="home-add-actions">
              <button type="button" className="btn btn-secondary" onClick={closePanel}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${transferDirection ? 'btn-primary' : 'btn-success'} ${panelSaved ? 'btn-saved' : ''}`}
                onClick={handlePanelSave}
                disabled={!panelValid || panelSaved}
              >
                {panelSaveLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
