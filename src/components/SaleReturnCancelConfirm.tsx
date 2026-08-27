import { useEffect, useState } from 'react'
import type { SaleReturnEntry } from '../types'
import { formatMoney, parseAmount } from '../utils/format'
import { formatSaleReturnLine } from '../utils/saleReturns'
import './SaleReturnCancelConfirm.css'

type SaleReturnCancelConfirmProps = {
  open: boolean
  entry: SaleReturnEntry | null
  onClose: () => void
  onConfirm: (returnId: string) => void
}

/** Cancel return only after the user types the exact return amount. */
export default function SaleReturnCancelConfirm({
  open,
  entry,
  onClose,
  onConfirm,
}: SaleReturnCancelConfirmProps) {
  const [amountStr, setAmountStr] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setAmountStr('')
    setError('')
  }, [open, entry?.id])

  if (!open || !entry) return null

  const typed = parseAmount(amountStr)
  const matches = Math.abs(typed - entry.amount) < 0.005 && amountStr.trim() !== ''

  function handleConfirm() {
    if (!entry) return
    if (!matches) {
      setError(`Type the exact return amount ${formatMoney(entry.amount)} to cancel.`)
      return
    }
    onConfirm(entry.id)
    onClose()
  }

  return (
    <div
      className="sale-return-cancel-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm cancel return"
    >
      <button
        type="button"
        className="sale-return-cancel-backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="sale-return-cancel-panel">
        <div className="sale-return-cancel-head">
          <h3>Cancel return</h3>
          <button type="button" className="sale-return-cancel-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="sale-return-cancel-copy">
          Type the return amount to verify, then confirm. Credit balance will increase again only
          after a match.
        </p>

        <div className="sale-return-cancel-detail">
          <span>{formatSaleReturnLine(entry)}</span>
          <strong>{formatMoney(entry.amount)}</strong>
        </div>

        <label className="sale-return-cancel-field">
          <span>Type amount {formatMoney(entry.amount)}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={amountStr}
            onChange={(e) => {
              setAmountStr(e.target.value)
              setError('')
            }}
            placeholder={String(entry.amount)}
            autoFocus
          />
        </label>

        {error ? <p className="sale-return-cancel-error">{error}</p> : null}

        <div className="sale-return-cancel-actions">
          <button type="button" className="sale-return-cancel-btn-ghost" onClick={onClose}>
            Back
          </button>
          <button
            type="button"
            className="sale-return-cancel-btn-confirm"
            disabled={!matches}
            onClick={handleConfirm}
          >
            Confirm cancel
          </button>
        </div>
      </div>
    </div>
  )
}
