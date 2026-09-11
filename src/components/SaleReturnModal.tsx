import { useEffect, useMemo, useState } from 'react'
import type { SaleReturnEntry } from '../types'
import { formatMoney } from '../utils/format'
import {
  buildSaleReturnEntry,
  calculateSaleReturnAmount,
  formatSaleReturnLine,
  type SaleBillPaymentLine,
  type SaleReturnDraft,
} from '../utils/saleReturns'
import SaleReturnCancelConfirm from './SaleReturnCancelConfirm'
import './SaleReturnModal.css'

export type { SaleReturnDraft }

type SaleReturnModalProps = {
  open: boolean
  onClose: () => void
  customerName?: string
  originalBill: number
  paidSoFar?: number
  paymentLines?: SaleBillPaymentLine[]
  existingReturns: SaleReturnEntry[]
  maxReturnable: number
  onCancelReturn?: (returnId: string) => void
  onAddItem: (draft: SaleReturnDraft) => void
}

function resetFormFields() {
  return {
    itemName: '',
    qtyStr: '1',
    rateStr: '',
    discountStr: '',
    gstStr: '',
    error: '',
  }
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
  onCancelReturn,
  onAddItem,
}: SaleReturnModalProps) {
  const [itemName, setItemName] = useState('')
  const [qtyStr, setQtyStr] = useState('1')
  const [rateStr, setRateStr] = useState('')
  const [discountStr, setDiscountStr] = useState('')
  const [gstStr, setGstStr] = useState('')
  const [error, setError] = useState('')
  const [cancelEntry, setCancelEntry] = useState<SaleReturnEntry | null>(null)

  useEffect(() => {
    if (!open) return
    const fields = resetFormFields()
    setItemName(fields.itemName)
    setQtyStr(fields.qtyStr)
    setRateStr(fields.rateStr)
    setDiscountStr(fields.discountStr)
    setGstStr(fields.gstStr)
    setError(fields.error)
    setCancelEntry(null)
  }, [open])

  const quantity = Number(qtyStr)
  const rate = Number(rateStr)
  const discountAmount = Number(discountStr)
  const gstPercent = Number(gstStr)

  const previewCalc = useMemo(
    () =>
      calculateSaleReturnAmount({
        quantity: Number.isFinite(quantity) ? quantity : 0,
        rate: Number.isFinite(rate) ? rate : 0,
        discountAmount: Number.isFinite(discountAmount) ? discountAmount : 0,
        gstPercent: Number.isFinite(gstPercent) ? gstPercent : 0,
      }),
    [quantity, rate, discountAmount, gstPercent],
  )

  const existingTotal = existingReturns.reduce((sum, row) => sum + row.amount, 0)
  const returnAmount = previewCalc.amount
  const creditBeforeReturn = Math.max(0, originalBill - paidSoFar - existingTotal)
  const creditAfterReturn = Math.max(0, creditBeforeReturn - returnAmount)
  const balanceCap = Math.max(0, maxReturnable)

  if (!open) return null

  function clearItemForm() {
    const fields = resetFormFields()
    setItemName(fields.itemName)
    setQtyStr(fields.qtyStr)
    setRateStr(fields.rateStr)
    setDiscountStr(fields.discountStr)
    setGstStr(fields.gstStr)
    setError('')
  }

  function handleAddItem() {
    const draft: SaleReturnDraft = {
      itemName,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      rate: Number.isFinite(rate) ? rate : 0,
      discountAmount: Number.isFinite(discountAmount) && discountAmount > 0 ? discountAmount : undefined,
      gstPercent: Number.isFinite(gstPercent) && gstPercent > 0 ? gstPercent : undefined,
    }
    const entry = buildSaleReturnEntry(draft)
    if (!entry) {
      setError('Enter item name, quantity, and rate.')
      return
    }
    if (entry.amount > balanceCap + 0.01) {
      setError(`Return cannot exceed credit balance (${formatMoney(balanceCap)}).`)
      return
    }
    onAddItem(draft)
    clearItemForm()
  }

  return (
    <div className="sale-return-overlay" role="dialog" aria-modal="true" aria-label="Sale return">
      <button type="button" className="sale-return-backdrop" aria-label="Close" onClick={onClose} />
      <div className="sale-return-panel">
        <div className="sale-return-head">
          <div>
            <h3>Sale return</h3>
            <p>
              {customerName?.trim() ? customerName.trim() : 'Customer'} · add items one by one · final
              amount (after GST & discount) is deducted from the bill
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
                <div className="sale-return-existing-actions">
                  <strong>−{formatMoney(row.amount)}</strong>
                  {onCancelReturn ? (
                    <button
                      type="button"
                      className="sale-return-cancel-btn"
                      onClick={() => setCancelEntry(row)}
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="sale-return-form-block">
          <p className="sale-return-form-title">Add return item</p>
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

          <div className="sale-return-row">
            <label className="sale-return-field">
              <span>Discount (₹)</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={discountStr}
                onChange={(e) => setDiscountStr(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="sale-return-field">
              <span>GST %</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={gstStr}
                onChange={(e) => setGstStr(e.target.value)}
                placeholder="0"
              />
            </label>
          </div>
        </div>

        <div className="sale-return-preview">
          <div>
            <span>Line subtotal</span>
            <strong>{formatMoney(previewCalc.subtotal)}</strong>
          </div>
          <div>
            <span>This return (final)</span>
            <strong>{formatMoney(returnAmount)}</strong>
          </div>
          <div className="sale-return-preview-credit">
            <span>Balance after</span>
            <strong>{formatMoney(creditAfterReturn)}</strong>
          </div>
        </div>

        {error ? <p className="sale-return-error">{error}</p> : null}

        <div className="sale-return-actions">
          <button type="button" className="sale-return-btn sale-return-btn--ghost" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="sale-return-btn sale-return-btn--add"
            onClick={handleAddItem}
          >
            + Add item
          </button>
        </div>
      </div>

      <SaleReturnCancelConfirm
        open={Boolean(cancelEntry)}
        entry={cancelEntry}
        onClose={() => setCancelEntry(null)}
        onConfirm={(returnId) => {
          onCancelReturn?.(returnId)
          setCancelEntry(null)
        }}
      />
    </div>
  )
}
