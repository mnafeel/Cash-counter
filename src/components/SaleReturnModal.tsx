import { useEffect, useMemo, useRef, useState } from 'react'
import type { SaleReturnEntry } from '../types'
import { formatMoney } from '../utils/format'
import {
  buildSaleReturnEntriesFromGrid,
  resolveSaleReturnFooterAmounts,
  saleReturnGridFromEntries,
  saleReturnGridTotals,
  saleReturnLineSubtotal,
  type SaleReturnDraft,
  type SaleReturnGridRow,
  type SaleReturnMoneyMode,
} from '../utils/saleReturns'
import type { SaleBillPaymentLine } from '../utils/saleReturns'
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
  /** Max total return value allowed (gross − paid). */
  maxReturnable: number
  /** Replace the full return list (add / edit / delete) and recalculate. */
  onChangeReturns: (returns: SaleReturnEntry[]) => void
  /** No bill at counter — confirm crediting return amount to customer advance. */
  creditToAdvancePrompt?: boolean
}

function emptyRow(): SaleReturnGridRow {
  return {
    id: crypto.randomUUID(),
    itemName: '',
    quantity: 1,
    rate: 0,
    createdAt: new Date().toISOString(),
  }
}

/** No item name and no rate — blank draft line, not a real item. */
function isEmptyGridRow(row: SaleReturnGridRow): boolean {
  return !row.itemName.trim() && !(row.rate > 0)
}

/** Row is not a complete billable line (needs name + qty + rate). */
function isIncompleteGridRow(row: SaleReturnGridRow): boolean {
  return !row.itemName.trim() || !(row.quantity > 0) || !(row.rate > 0)
}

function stripTrailingEmptyRows(rows: SaleReturnGridRow[]): SaleReturnGridRow[] {
  const next = [...rows]
  while (next.length > 0 && isEmptyGridRow(next[next.length - 1])) {
    next.pop()
  }
  return next
}

function stripTrailingIncompleteRows(rows: SaleReturnGridRow[]): SaleReturnGridRow[] {
  const next = [...rows]
  while (next.length > 0 && isIncompleteGridRow(next[next.length - 1])) {
    next.pop()
  }
  return next
}

function focusCell(rowId: string, field: 'item' | 'qty' | 'rate') {
  window.requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>(
      `[data-return-row="${rowId}"][data-return-field="${field}"]`,
    )
    el?.focus()
    el?.select()
  })
}

function focusDiscountField() {
  window.requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>('[data-return-field="discount"]')
    el?.focus()
    el?.select()
  })
}

function focusTaxField() {
  window.requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>('[data-return-field="tax"]')
    el?.focus()
    el?.select()
  })
}

function parsePositiveInput(raw: string): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
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
  onChangeReturns,
  creditToAdvancePrompt = false,
}: SaleReturnModalProps) {
  const [rows, setRows] = useState<SaleReturnGridRow[]>([emptyRow()])
  const [discountStr, setDiscountStr] = useState('')
  const [taxStr, setTaxStr] = useState('')
  const [discountMode, setDiscountMode] = useState<SaleReturnMoneyMode>('percent')
  const [taxMode, setTaxMode] = useState<SaleReturnMoneyMode>('percent')
  const [error, setError] = useState('')
  const [advanceConfirm, setAdvanceConfirm] = useState(false)
  const skipNextSync = useRef(false)
  const hydratedKey = useRef('')
  const wasOpen = useRef(false)

  const noBillMode = originalBill <= 0 && paidSoFar <= 0 && creditToAdvancePrompt

  function resetGridLocal() {
    setRows([emptyRow()])
    setDiscountStr('')
    setTaxStr('')
    setDiscountMode('percent')
    setTaxMode('percent')
    setError('')
    setAdvanceConfirm(false)
  }

  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      hydratedKey.current = ''
      skipNextSync.current = false
      resetGridLocal()
      return
    }

    const openedNow = !wasOpen.current
    wasOpen.current = true
    const key = `${existingReturns.map((r) => `${r.id}:${r.amount}:${r.quantity}:${r.rate}`).join('|')}|${existingReturns.length}`

    // While open, skip one echo after we push commits to the parent.
    // Always re-hydrate when the modal first opens so a prior return never sticks.
    if (!openedNow && skipNextSync.current) {
      skipNextSync.current = false
      hydratedKey.current = key
      return
    }
    if (!openedNow && key === hydratedKey.current) return

    skipNextSync.current = false
    hydratedKey.current = key
    if (existingReturns.length > 0) {
      const state = saleReturnGridFromEntries(existingReturns)
      setRows(state.rows.length > 0 ? state.rows : [emptyRow()])
      if (state.discountAmount > 0) {
        setDiscountMode('amount')
        setDiscountStr(String(state.discountAmount))
      } else {
        setDiscountMode('percent')
        setDiscountStr('')
      }
      if (state.gstPercent != null && state.gstPercent > 0) {
        setTaxMode('percent')
        setTaxStr(String(state.gstPercent))
      } else if (state.taxAmount > 0) {
        setTaxMode('amount')
        setTaxStr(String(state.taxAmount))
      } else {
        setTaxMode('percent')
        setTaxStr('')
      }
    } else {
      resetGridLocal()
      return
    }
    setError('')
    setAdvanceConfirm(false)
  }, [open, existingReturns])

  const itemsSubtotal = useMemo(
    () =>
      Math.round(
        rows.reduce((sum, row) => sum + saleReturnLineSubtotal(row.quantity, row.rate), 0) * 100,
      ) / 100,
    [rows],
  )

  const resolvedFooter = useMemo(() => {
    const resolved = resolveSaleReturnFooterAmounts(
      itemsSubtotal,
      parsePositiveInput(discountStr),
      discountMode,
      parsePositiveInput(taxStr),
      taxMode,
    )
    return {
      discountAmount: resolved.discountAmount,
      taxAmount: resolved.taxAmount,
      gstPercent: taxMode === 'percent' ? resolved.gstPercent : undefined,
    }
  }, [itemsSubtotal, discountStr, discountMode, taxStr, taxMode])

  const footer = {
    discountAmount: resolvedFooter.discountAmount,
    taxAmount: resolvedFooter.taxAmount,
    gstPercent: resolvedFooter.gstPercent,
  }

  const totals = useMemo(
    () => saleReturnGridTotals(rows, footer),
    [rows, footer.discountAmount, footer.taxAmount],
  )

  const balanceCap = Math.max(0, maxReturnable)
  const creditBeforeReturn = Math.max(0, originalBill - paidSoFar)
  const creditAfterReturn = Math.max(0, creditBeforeReturn - totals.grandTotal)

  function markCommitted(built: SaleReturnEntry[]) {
    skipNextSync.current = true
    hydratedKey.current = `${built.map((r) => `${r.id}:${r.amount}:${r.quantity}:${r.rate}`).join('|')}|${built.length}`
  }

  function commitReturns(nextRows: SaleReturnGridRow[], nextFooter = footer): SaleReturnEntry[] {
    const built = buildSaleReturnEntriesFromGrid(nextRows, nextFooter)
    if (!noBillMode && built.length > 0) {
      const total = built.reduce((sum, row) => sum + row.amount, 0)
      if (total > balanceCap + 0.01) {
        setError(`Return cannot exceed ${formatMoney(balanceCap)}.`)
        return built
      }
    }
    setError('')
    if (noBillMode) return built
    markCommitted(built)
    onChangeReturns(built)
    return built
  }

  function toggleDiscountMode() {
    const next: SaleReturnMoneyMode = discountMode === 'percent' ? 'amount' : 'percent'
    const raw = parsePositiveInput(discountStr)
    if (raw > 0 && itemsSubtotal > 0) {
      if (next === 'amount') {
        const pct = Math.min(100, raw)
        setDiscountStr(String(Math.round(itemsSubtotal * (pct / 100) * 100) / 100))
      } else {
        const pct = Math.min(100, Math.round((raw / itemsSubtotal) * 10000) / 100)
        setDiscountStr(String(pct))
      }
    }
    setDiscountMode(next)
  }

  function toggleTaxMode() {
    const next: SaleReturnMoneyMode = taxMode === 'percent' ? 'amount' : 'percent'
    const raw = parsePositiveInput(taxStr)
    const taxable = Math.max(0, itemsSubtotal - footer.discountAmount)
    if (raw > 0 && taxable > 0) {
      if (next === 'amount') {
        setTaxStr(String(Math.round(taxable * (raw / 100) * 100) / 100))
      } else {
        const pct = Math.round((raw / taxable) * 10000) / 100
        setTaxStr(String(pct))
      }
    }
    setTaxMode(next)
  }

  function updateRow(id: string, patch: Partial<SaleReturnGridRow>, commit = false) {
    setRows((prev) => {
      const next = prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
      if (commit) commitReturns(next)
      return next
    })
  }

  function removeRow(id: string) {
    setRows((prev) => {
      const next = prev.filter((row) => row.id !== id)
      const ensured = next.length > 0 ? next : [emptyRow()]
      commitReturns(ensured)
      return ensured
    })
  }

  /** Drop blank trailing lines (no name + no rate), e.g. when moving to discount. */
  function pruneEmptyTrailingRows(commit = true) {
    setRows((prev) => {
      const next = stripTrailingIncompleteRows(prev)
      if (commit) commitReturns(next)
      return next
    })
  }

  function handleQtyEnter(row: SaleReturnGridRow) {
    const qty = row.quantity > 0 ? row.quantity : 1
    if (qty !== row.quantity) {
      updateRow(row.id, { quantity: qty })
    }
    focusCell(row.id, 'rate')
  }

  function finishGridToDiscount(row: SaleReturnGridRow, qty: number) {
    setError('')
    setRows((prev) => {
      const mapped = prev.map((r) =>
        r.id === row.id ? { ...row, quantity: qty, rate: 0 } : r,
      )
      const next = stripTrailingIncompleteRows(mapped)
      commitReturns(next)
      return next
    })
    focusDiscountField()
  }

  function handleRateEnter(row: SaleReturnGridRow) {
    const qty = row.quantity > 0 ? row.quantity : 1
    const rate = Math.max(0, row.rate)

    // Empty / zero price → leave the item grid and go to discount.
    if (!(rate > 0)) {
      finishGridToDiscount(row, qty)
      return
    }

    if (!row.itemName.trim()) {
      setError('Enter item name.')
      focusCell(row.id, 'item')
      return
    }

    // Rate entered → keep the line and open a new row immediately.
    setError('')
    const blank = emptyRow()
    setRows((prev) => {
      const mapped = prev.map((r) =>
        r.id === row.id ? { ...row, quantity: qty, rate } : r,
      )
      const cleaned = stripTrailingEmptyRows(mapped)
      const idx = cleaned.findIndex((r) => r.id === row.id)
      const next =
        idx >= 0
          ? [...cleaned.slice(0, idx + 1), blank, ...cleaned.slice(idx + 1)]
          : [...cleaned, blank]
      commitReturns(next)
      focusCell(blank.id, 'item')
      return next
    })
  }

  function handleFooterFocus() {
    pruneEmptyTrailingRows(true)
  }

  function handleFooterCommit() {
    const pruned = stripTrailingIncompleteRows(rows)
    if (pruned.length !== rows.length) setRows(pruned)
    commitReturns(pruned, footer)
  }

  function handleDiscountEnter() {
    handleFooterCommit()
    focusTaxField()
  }

  function handleTaxEnter() {
    handleFooterCommit()
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>('[data-return-field="tax"]')
      el?.blur()
    })
  }

  function ensureDraftRow() {
    setRows((prev) => (prev.length === 0 ? [emptyRow()] : prev))
  }

  function handleDone() {
    handleFooterCommit()
    onClose()
  }

  function handleContinueToAdvanceConfirm() {
    const built = buildSaleReturnEntriesFromGrid(rows, footer)
    if (built.length === 0) {
      setError('Add at least one return item.')
      return
    }
    setAdvanceConfirm(true)
    setError('')
  }

  function handleAdvanceConfirm() {
    const built = buildSaleReturnEntriesFromGrid(rows, footer)
    if (built.length === 0) {
      setError('Add at least one return item.')
      return
    }
    // Parent credits advance and closes; do not markCommitted — that skipped
    // empty hydrate and left the previous return visible on the next open.
    onChangeReturns(built)
    setAdvanceConfirm(false)
  }

  const continueHandlerRef = useRef(handleContinueToAdvanceConfirm)
  const advanceConfirmHandlerRef = useRef(handleAdvanceConfirm)
  const doneHandlerRef = useRef(handleDone)
  continueHandlerRef.current = handleContinueToAdvanceConfirm
  advanceConfirmHandlerRef.current = handleAdvanceConfirm
  doneHandlerRef.current = handleDone

  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey) return
      if (e.code !== 'KeyS') return
      e.preventDefault()
      e.stopPropagation()
      if (noBillMode) {
        if (advanceConfirm) {
          advanceConfirmHandlerRef.current()
          return
        }
        continueHandlerRef.current()
        return
      }
      doneHandlerRef.current()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, noBillMode, advanceConfirm])

  if (!open) return null

  return (
    <div className="sale-return-overlay" role="dialog" aria-modal="true" aria-label="Sale return">
      <button type="button" className="sale-return-backdrop" aria-label="Close" onClick={onClose} />
      <div className="sale-return-panel sale-return-panel--grid">
        <div className="sale-return-head">
          <div>
            <h3>{noBillMode ? 'Return → advance' : 'Sale return'}</h3>
            <p>
              {noBillMode
                ? `${customerName?.trim() || 'Customer'} · Enter: name → qty → rate · empty rate → discount → tax · Alt+S to save`
                : `${customerName?.trim() || 'Customer'} · Enter: name → qty → rate · empty rate → discount → tax · Alt+S when done`}
            </p>
          </div>
          <button type="button" className="sale-return-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {!noBillMode ? (
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
              <strong>{formatMoney(totals.grandTotal)}</strong>
            </div>
            <div className="sale-return-summary-credit">
              <span>Balance after</span>
              <strong>{formatMoney(creditAfterReturn)}</strong>
            </div>
          </div>
        ) : null}

        {paymentLines.length > 0 ? (
          <ul className="sale-return-payments">
            {paymentLines.map((line) => (
              <li key={line.key}>
                <span>{line.label}</span>
                <strong>{formatMoney(line.amount)}</strong>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="sale-return-grid-wrap" onFocusCapture={ensureDraftRow}>
          <table className="sale-return-grid">
            <thead>
              <tr>
                <th className="sale-return-grid__num">#</th>
                <th className="sale-return-grid__item">Item</th>
                <th className="sale-return-grid__qty">Qty</th>
                <th className="sale-return-grid__rate">Rate</th>
                <th className="sale-return-grid__amt">Amount</th>
                <th className="sale-return-grid__del" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr className="sale-return-grid__row--draft">
                  <td colSpan={6}>
                    <button
                      type="button"
                      className="sale-return-grid-add"
                      onClick={() => {
                        const blank = emptyRow()
                        setRows([blank])
                        focusCell(blank.id, 'item')
                      }}
                    >
                      + Add item
                    </button>
                  </td>
                </tr>
              ) : null}
              {rows.map((row, index) => {
                const lineAmt = saleReturnLineSubtotal(row.quantity, row.rate)
                const isBlank = isEmptyGridRow(row)
                const rowNumber = index + 1
                return (
                  <tr key={row.id} className={isBlank ? 'sale-return-grid__row--draft' : ''}>
                    <td className="sale-return-grid__num-cell">{rowNumber}</td>
                    <td>
                      <input
                        data-return-row={row.id}
                        data-return-field="item"
                        type="text"
                        value={row.itemName}
                        placeholder="Item name"
                        autoFocus={index === 0 && !row.itemName}
                        onChange={(e) => updateRow(row.id, { itemName: e.target.value })}
                        onBlur={() => updateRow(row.id, {}, true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            // Empty or filled name — always advance to quantity.
                            if (!(row.quantity > 0)) {
                              updateRow(row.id, { quantity: 1 })
                            }
                            focusCell(row.id, 'qty')
                          }
                        }}
                      />
                    </td>
                    <td>
                      <input
                        data-return-row={row.id}
                        data-return-field="qty"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={row.quantity || ''}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) =>
                          updateRow(row.id, {
                            quantity: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        onBlur={() => {
                          if (!(row.quantity > 0)) updateRow(row.id, { quantity: 1 }, true)
                          else updateRow(row.id, {}, true)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleQtyEnter({
                              ...row,
                              quantity: Math.max(
                                0,
                                Number((e.target as HTMLInputElement).value) || row.quantity || 1,
                              ),
                            })
                          }
                        }}
                      />
                    </td>
                    <td>
                      <input
                        data-return-row={row.id}
                        data-return-field="rate"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={row.rate || ''}
                        placeholder="0"
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) =>
                          updateRow(row.id, {
                            rate: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        onBlur={() => updateRow(row.id, {}, true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleRateEnter({
                              ...row,
                              quantity: row.quantity > 0 ? row.quantity : 1,
                              rate: Math.max(
                                0,
                                Number((e.target as HTMLInputElement).value) || 0,
                              ),
                            })
                          }
                        }}
                      />
                    </td>
                    <td className="sale-return-grid__amt-cell">
                      {lineAmt > 0 ? formatMoney(lineAmt) : '—'}
                    </td>
                    <td>
                      {!isBlank ? (
                        <button
                          type="button"
                          className="sale-return-grid-del"
                          aria-label={`Remove ${row.itemName || 'item'}`}
                          onClick={() => removeRow(row.id)}
                        >
                          ✕
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="sale-return-footer-fields">
          <label className="sale-return-field">
            <span className="sale-return-field-label">
              Discount
              <button
                type="button"
                className="sale-return-mode-toggle"
                onClick={(e) => {
                  e.preventDefault()
                  toggleDiscountMode()
                }}
                aria-label={
                  discountMode === 'percent'
                    ? 'Discount as percentage. Click for amount.'
                    : 'Discount as amount. Click for percentage.'
                }
                title={discountMode === 'percent' ? 'Percentage — click for ₹' : 'Amount — click for %'}
              >
                {discountMode === 'percent' ? '%' : '₹'}
              </button>
            </span>
            <input
              data-return-field="discount"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={discountStr}
              placeholder={discountMode === 'percent' ? '0%' : '0'}
              onFocus={handleFooterFocus}
              onChange={(e) => setDiscountStr(e.target.value)}
              onBlur={handleFooterCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleDiscountEnter()
                }
              }}
            />
          </label>
          <label className="sale-return-field">
            <span className="sale-return-field-label">
              Tax
              <button
                type="button"
                className="sale-return-mode-toggle"
                onClick={(e) => {
                  e.preventDefault()
                  toggleTaxMode()
                }}
                aria-label={
                  taxMode === 'percent'
                    ? 'Tax as percentage. Click for amount.'
                    : 'Tax as amount. Click for percentage.'
                }
                title={taxMode === 'percent' ? 'Percentage — click for ₹' : 'Amount — click for %'}
              >
                {taxMode === 'percent' ? '%' : '₹'}
              </button>
            </span>
            <input
              data-return-field="tax"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={taxStr}
              placeholder={taxMode === 'percent' ? '0%' : '0'}
              onFocus={handleFooterFocus}
              onChange={(e) => setTaxStr(e.target.value)}
              onBlur={handleFooterCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleTaxEnter()
                }
              }}
            />
          </label>
        </div>

        {!advanceConfirm ? (
          <div className="sale-return-preview">
            <div>
              <span>Items</span>
              <strong>{formatMoney(totals.itemsSubtotal)}</strong>
            </div>
            <div>
              <span>− Discount</span>
              <strong>{formatMoney(totals.discountAmount)}</strong>
            </div>
            <div>
              <span>+ Tax</span>
              <strong>{formatMoney(totals.taxAmount)}</strong>
            </div>
            <div className="sale-return-preview-credit">
              <span>Return total</span>
              <strong>{formatMoney(totals.grandTotal)}</strong>
            </div>
          </div>
        ) : (
          <div className="sale-return-advance-confirm">
            <p>
              Add <strong>{formatMoney(totals.grandTotal)}</strong> to advance for{' '}
              <strong>{customerName?.trim() || 'this customer'}</strong>?
            </p>
          </div>
        )}

        {error ? <p className="sale-return-error">{error}</p> : null}

        <div className="sale-return-actions">
          {advanceConfirm ? (
            <>
              <button
                type="button"
                className="sale-return-btn sale-return-btn--ghost"
                onClick={() => setAdvanceConfirm(false)}
              >
                Back
              </button>
              <button
                type="button"
                className="sale-return-btn sale-return-btn--add sale-return-btn--with-shortcut"
                onClick={handleAdvanceConfirm}
              >
                <span>Yes, add to advance</span>
                <span className="sale-return-btn-shortcut">Alt+S</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`sale-return-btn sale-return-btn--ghost${
                  noBillMode ? '' : ' sale-return-btn--with-shortcut'
                }`}
                onClick={handleDone}
              >
                <span>Done</span>
                {!noBillMode ? <span className="sale-return-btn-shortcut">Alt+S</span> : null}
              </button>
              {noBillMode ? (
                <button
                  type="button"
                  className="sale-return-btn sale-return-btn--add sale-return-btn--with-shortcut"
                  onClick={handleContinueToAdvanceConfirm}
                >
                  <span>Continue</span>
                  <span className="sale-return-btn-shortcut">Alt+S</span>
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
