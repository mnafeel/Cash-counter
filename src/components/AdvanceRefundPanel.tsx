import { useEffect, useMemo, useState } from 'react'
import { useCash } from '../context/CashContext'
import {
  allocateAdvanceRefund,
  customerAdvanceBalance,
  customerAdvanceBalanceBreakdown,
} from '../utils/customerAdvance'
import { formatMoney, parseAmount } from '../utils/format'
import './AdvanceRefundPanel.css'

export interface AdvanceRefundPanelProps {
  defaultCustomerName?: string
  defaultAmount?: number
  compact?: boolean
  /** Hide customer field; use defaultCustomerName only. */
  lockCustomerName?: boolean
  onRefunded?: () => void
}

export default function AdvanceRefundPanel({
  defaultCustomerName = '',
  defaultAmount,
  compact = false,
  lockCustomerName = false,
  onRefunded,
}: AdvanceRefundPanelProps) {
  const { data, refundCustomerAdvance } = useCash()
  const [customerName, setCustomerName] = useState(defaultCustomerName)
  const [amountStr, setAmountStr] = useState('')
  const [cashStr, setCashStr] = useState('')
  const [bankStr, setBankStr] = useState('')
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (defaultCustomerName) setCustomerName(defaultCustomerName)
  }, [defaultCustomerName])

  const balance = useMemo(
    () => customerAdvanceBalance(data, customerName),
    [data, customerName],
  )
  const pools = useMemo(
    () => customerAdvanceBalanceBreakdown(data, customerName),
    [data, customerName],
  )

  useEffect(() => {
    if (defaultAmount != null && defaultAmount > 0) {
      setAmountStr(String(defaultAmount))
      const auto = allocateAdvanceRefund(defaultAmount, pools)
      setCashStr(auto.cash > 0 ? String(auto.cash) : '')
      setBankStr(auto.bank > 0 ? String(auto.bank) : '')
    }
  }, [defaultAmount, pools.cash, pools.bank, pools.total])

  function syncSplitFromAmount() {
    const amt = parseAmount(amountStr)
    if (amt <= 0) return
    const auto = allocateAdvanceRefund(amt, pools)
    setCashStr(auto.cash > 0 ? String(auto.cash) : '')
    setBankStr(auto.bank > 0 ? String(auto.bank) : '')
  }

  function setPayoutCash() {
    const amt = parseAmount(amountStr)
    if (amt <= 0) return
    setCashStr(String(amt))
    setBankStr('')
  }

  function setPayoutBank() {
    const amt = parseAmount(amountStr)
    if (amt <= 0) return
    setCashStr('')
    setBankStr(String(amt))
  }

  const amount = parseAmount(amountStr)
  const canSave = customerName.trim().length > 0 && amount > 0 && amount <= balance + 0.01

  function handleRefund() {
    if (!canSave) return
    const cash = parseAmount(cashStr)
    const bank = parseAmount(bankStr)
    const ok = refundCustomerAdvance({
      customerName: customerName.trim(),
      amount,
      cashAmount: cash > 0 ? cash : undefined,
      bankAmount: bank > 0 ? bank : undefined,
      note: note.trim() || undefined,
    })
    if (ok) {
      setAmountStr('')
      setCashStr('')
      setBankStr('')
      setNote('')
      setSaved(true)
      onRefunded?.()
      window.setTimeout(() => setSaved(false), 1400)
    }
  }

  return (
    <div className={`advance-refund ${compact ? 'advance-refund--compact' : ''}`}>
      <p className="advance-refund-hint">
        Refund prepayment to the customer. Cash and bank outflows are logged in drawer activity.
      </p>
      {lockCustomerName && defaultCustomerName ? (
        <p className="advance-refund-customer-locked">
          Customer <strong>{defaultCustomerName}</strong>
        </p>
      ) : (
        <div className="advance-refund-field">
          <label htmlFor="advance-refund-customer">Customer</label>
          <input
            id="advance-refund-customer"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            autoComplete="off"
          />
        </div>
      )}
      {balance > 0 ? (
        <span className="advance-refund-pill">
          Balance {formatMoney(balance)}
          {pools.cash > 0 || pools.bank > 0 ? (
            <> · Cash {formatMoney(pools.cash)} · Bank {formatMoney(pools.bank)}</>
          ) : null}
        </span>
      ) : null}
      <div className="advance-refund-field">
        <label htmlFor="advance-refund-amount">Refund amount</label>
        <input
          id="advance-refund-amount"
          inputMode="decimal"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.]/g, ''))}
          onBlur={() => {
            if (parseAmount(cashStr) <= 0 && parseAmount(bankStr) <= 0) {
              syncSplitFromAmount()
            }
          }}
          placeholder="0"
        />
      </div>
      <div className="advance-refund-pay-chips" role="group" aria-label="Refund payout">
        <button type="button" onClick={setPayoutCash}>Pay cash</button>
        <button type="button" onClick={setPayoutBank}>Pay bank</button>
        <button type="button" onClick={syncSplitFromAmount}>Auto split</button>
      </div>
      <div className="advance-refund-split">
        <div className="advance-refund-field">
          <label htmlFor="advance-refund-cash">Cash out</label>
          <input
            id="advance-refund-cash"
            inputMode="decimal"
            value={cashStr}
            onChange={(e) => setCashStr(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </div>
        <div className="advance-refund-field">
          <label htmlFor="advance-refund-bank">Bank out</label>
          <input
            id="advance-refund-bank"
            inputMode="decimal"
            value={bankStr}
            onChange={(e) => setBankStr(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </div>
      </div>
      <div className="advance-refund-field">
        <label htmlFor="advance-refund-note">Note (optional)</label>
        <input
          id="advance-refund-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason"
        />
      </div>
      <button type="button" className="advance-refund-save" disabled={!canSave} onClick={handleRefund}>
        {saved ? 'Refunded ✓' : 'Process refund'}
      </button>
    </div>
  )
}
