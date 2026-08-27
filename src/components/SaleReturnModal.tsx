import { useEffect, useMemo, useState } from 'react'
import type { SaleReturnEntry } from '../types'
import { formatMoney } from '../utils/format'
import {
  buildSaleReturnEntry,
  formatSaleReturnLine,
  type SaleBillPaymentLine,
} from '../utils/saleReturns'
import './SaleReturnModal.css'

export type SaleReturnDraft = {
  itemName: string
  quantity: number
  rate: number
}

type SaleReturnModalProps = {
  open: boolean
  onClose: () => void
  customerName?: string
  /** Gross bill before returns. */
  originalBill: number
  /** Sum of 1st + 2nd + 3rd + cheque (+ split) payments. */
  paidSoFar?: number
  /** Individual payment lines for clarity. */
  paymentLines?: SaleBillPaymentLine[]
  /** Already recorded returns (persisted + draft). */
  existingReturns: SaleReturnEntry[]
  /** Max amount still returnable (remaining credit due). */
  maxReturnable: number
  onDone: (draft: SaleReturnDraft) => void
}

export default function SaleReturnModal({
  open,
  onClose,
  customerName,
  originalBill,
  paidSoFar = 0,
  paymentLines = [],
  existingReturns,
  maxReturnable,
  onDone,
}: SaleReturnModalProps) {
  const [itemName, setItemName] = useState('')
  const [qtyStr, setQtyStr] = useState('1')
  const [rateStr, setRateStr] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setItemName('')
    setQtyStr('1')
    setRateStr('')
    setError('')
  }, [open])

  const quantity = Number(qtyStr)
  const rate = Number(rateStr)
  const preview = useMemo(
    () =>
      buildSaleReturnEntry({
        itemName: itemName || 'Item',
        quantity: Number.isFinite(quantity) ? quantity : 0,
        rate: Number.isFinite(rate) ? rate : 0,
      }),
    [itemName, quantity, rate],
  )

  const existingTotal = existingReturns.reduce((sum, row) => sum + row.amount, 0)
  const returnAmount = preview?.amount ?? 0
  const creditBeforeReturn = Math.max(0, originalBill - paidSoFar - existingTotal)
  const creditAfterReturn = Math.max(0, creditBeforeReturn - returnAmount)
  const balanceCap = Math.max(0, maxReturnable)

  if (!open) return null

  function handleDone() {
    const entry = buildSaleReturnEntry({
      itemName,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      rate: Number.isFinite(rate) ? rate : 0,
    })
    if (!entry) {
      setError('Enter item name, quantity, and rate.')
      return
    }
    if (entry.amount > balanceCap + 0.01) {
      setError(`Return cannot exceed credit balance (${formatMoney(balanceCap)}).`)
      return
    }
    onDone({ itemName: entry.itemName, quantity: entry.quantity, rate: entry.rate })
    onClose()
  }

  return (
    <div className="sale-return-overlay" role="dialog" aria-modal="true" aria-label="Sale return">
      <button type="button" className="sale-return-backdrop" aria-label="Close" onClick={onClose} />
      <div className="sale-return-panel">
        <div className="sale-return-head">
          <div>
            <h3>Sale return</h3>
            <p>
              {customerName?.trim() ? customerName.trim() : 'Customer'} · all payments counted · credit
              balance updated
            </p>
          </div>
          <button type="button" className="sale-return-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="sale-return-summary sale-return-summary--four">
          <div>
            <span>Original bill</span>
            <strong>{formatMoney(originalBill)}</strong>
          </div>
          <div>
            <span>Paid total</span>
            <strong>{formatMoney(paidSoFar)}</strong>
          </div>
          <div>
            <span>Returns</span>
            <strong>{formatMoney(existingTotal)}</strong>
          </div>
          <div className="sale-return-summary-credit">
            <span>Credit balance</span>
            <strong>{formatMoney(creditBeforeReturn)}</strong>
          </div>
        </div>

        {paymentLines.length > 0 ? (
          <ul className="sale-return-payments">
            {paymentLines.map((line) => (
              <li key={line.key}>
                <span>{line.label}</span>
                <strong>{formatMoney(line.amount)}</strong>
              </li>
            ))}
            <li className="sale-return-payments-total">
              <span>All payments</span>
              <strong>{formatMoney(paidSoFar)}</strong>
            </li>
          </ul>
        ) : paidSoFar > 0 ? (
          <p className="sale-return-paid-note">
            Paid so far {formatMoney(paidSoFar)} (all collections combined)
          </p>
        ) : null}

        {existingReturns.length > 0 ? (
          <ul className="sale-return-existing">
            {existingReturns.map((row) => (
              <li key={row.id}>
                <span>{formatSaleReturnLine(row)}</span>
                <strong>{formatMoney(row.amount)}</strong>
              </li>
            ))}
          </ul>
        ) : null}

        <label className="sale-return-field">
          <span>Returned item / product</span>
          <input
            type="text"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="e.g. Shirt, fabric, accessory"
            autoFocus
            enterKeyHint="next"
          />
        </label>

        <div className="sale-return-row">
          <label className="sale-return-field">
            <span>Quantity</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={qtyStr}
              onChange={(e) => setQtyStr(e.target.value)}
            />
          </label>
          <label className="sale-return-field">
            <span>Rate / piece</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={rateStr}
              onChange={(e) => setRateStr(e.target.value)}
              placeholder="0"
            />
          </label>
        </div>

        <div className="sale-return-preview">
          <div>
            <span>This return</span>
            <strong>{formatMoney(returnAmount)}</strong>
          </div>
          <div className="sale-return-preview-credit">
            <span>Credit after return</span>
            <strong>{formatMoney(creditAfterReturn)}</strong>
          </div>
        </div>

        {error ? <p className="sale-return-error">{error}</p> : null}

        <div className="sale-return-actions">
          <button type="button" className="sale-return-btn sale-return-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sale-return-btn sale-return-btn--primary" onClick={handleDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
