import { useEffect, useMemo, useState } from 'react'
import type { ExpensePayType } from '../types'
import { formatMoney, parseAmount } from '../utils/format'
import { buildBulkCreditPaymentPlan, type BulkCreditPaySelection } from '../utils/purchaseHistory'
import Portal from './Portal'
import './PurchaseHistoryPanel.css'

type PayMode = 'cash' | 'bank' | 'cheque' | 'split'

interface PurchaseCreditPayModalProps {
  open: boolean
  selections: BulkCreditPaySelection[]
  onClose: () => void
  onConfirm: (
    payments: Array<{
      id: string
      payment: {
        payType: ExpensePayType
        payAmount: number
        cashAmount?: number
        bankAmount?: number
        chequeAmount?: number
        chequeApproved?: boolean
      }
    }>,
  ) => void
}

export default function PurchaseCreditPayModal({
  open,
  selections,
  onClose,
  onConfirm,
}: PurchaseCreditPayModalProps) {
  const [payMode, setPayMode] = useState<PayMode>('cash')
  const [cashStr, setCashStr] = useState('')
  const [bankStr, setBankStr] = useState('')
  const [chequeStr, setChequeStr] = useState('')
  const [chequeApproved, setChequeApproved] = useState(true)
  const [error, setError] = useState('')

  const totalDue = useMemo(
    () => selections.reduce((sum, row) => sum + row.amount, 0),
    [selections],
  )

  useEffect(() => {
    if (!open) return
    setPayMode('cash')
    setCashStr('')
    setBankStr('')
    setChequeStr('')
    setChequeApproved(true)
    setError('')
  }, [open, selections])

  useEffect(() => {
    if (!open || payMode !== 'split') return
    if (!cashStr && !bankStr && !chequeStr) {
      setCashStr(String(totalDue))
    }
  }, [open, payMode, totalDue, cashStr, bankStr, chequeStr])

  if (!open || selections.length === 0) return null

  function handleSubmit() {
    setError('')
    if (payMode === 'split') {
      const cash = parseAmount(cashStr)
      const bank = parseAmount(bankStr)
      const cheque = chequeApproved ? parseAmount(chequeStr) : 0
      const sum = cash + bank + cheque
      if (Math.abs(sum - totalDue) > 0.009) {
        setError(`Split must equal ${formatMoney(totalDue)}`)
        return
      }
      const plan = buildBulkCreditPaymentPlan(selections, 'split', {
        cash,
        bank,
        cheque,
        chequeApproved,
      })
      if (plan.length === 0) {
        setError('Enter cash, bank, or cheque amounts.')
        return
      }
      onConfirm(plan)
      return
    }

    onConfirm(buildBulkCreditPaymentPlan(selections, payMode))
  }

  return (
    <Portal>
      <div className="purchase-credit-pay-overlay" role="dialog" aria-modal="true">
        <div className="purchase-credit-pay-modal">
          <header className="purchase-credit-pay-head">
            <h4>Pay selected credits</h4>
            <button type="button" className="purchase-credit-pay-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </header>

          <p className="purchase-credit-pay-meta">
            {selections.length} bill{selections.length === 1 ? '' : 's'} · Total{' '}
            <strong>{formatMoney(totalDue)}</strong>
          </p>

          <div className="purchase-credit-pay-modes">
            {(
              [
                ['cash', '💵 Cash'],
                ['bank', '🏦 Bank'],
                ['cheque', '🧾 Cheque'],
                ['split', '➗ Split'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`purchase-hist-date-chip ${payMode === id ? 'purchase-hist-date-chip--active' : ''}`}
                onClick={() => setPayMode(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {payMode === 'split' ? (
            <div className="purchase-credit-pay-split">
              <label>
                <span>Cash</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={cashStr}
                  onChange={(e) => setCashStr(e.target.value)}
                />
              </label>
              <label>
                <span>Bank</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={bankStr}
                  onChange={(e) => setBankStr(e.target.value)}
                />
              </label>
              <label>
                <span>Cheque</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={chequeStr}
                  onChange={(e) => setChequeStr(e.target.value)}
                />
              </label>
              <label className="purchase-credit-pay-cheque-approved">
                <input
                  type="checkbox"
                  checked={chequeApproved}
                  onChange={(e) => setChequeApproved(e.target.checked)}
                />
                <span>Cheque approved to bank</span>
              </label>
            </div>
          ) : (
            <p className="purchase-credit-pay-hint">
              Each selected bill will be cleared in full using{' '}
              {payMode === 'cash' ? 'cash' : payMode === 'bank' ? 'bank' : 'cheque'}.
            </p>
          )}

          {error ? <p className="purchase-credit-pay-error">{error}</p> : null}

          <footer className="purchase-credit-pay-actions">
            <button type="button" className="purchase-hist-back" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="purchase-credit-pay-submit" onClick={handleSubmit}>
              Pay {formatMoney(totalDue)}
            </button>
          </footer>
        </div>
      </div>
    </Portal>
  )
}
