import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { AppData } from '../types'
import { useCash } from '../context/CashContext'
import type { ExpenseBillMode } from '../utils/expenseBillLabels'
import {
  GST_BILL_LABEL,
  NO_GST_BILL_LABEL,
  purchaseBillLabel,
} from '../utils/expenseBillLabels'
import { formatMoney, parseAmount } from '../utils/format'
import {
  applyMasterBillDateToRows,
  buildBulkPurchasePayloads,
  createEmptyBulkRow,
  getSupplierBulkHistoryRows,
  validateBulkPurchaseDraft,
  type BulkPurchasePayType,
  type BulkPurchaseRow,
} from '../utils/purchaseBulkCreate'
import { searchNamesByPrefix } from '../utils/normalExpenseHistory'
import { buildPurchaseSupplierOptions, buildAllPurchaseItemOptions, buildSupplierItemOptions, filterPurchaseItemSuggestions } from '../utils/supplierSuggestions'
import { toInputDate } from '../utils/salesReport'
import Portal from './Portal'
import './BulkPurchaseCreateModal.css'

type BulkPurchaseCreateModalProps = {
  open: boolean
  data: AppData
  supplierNames: string[]
  initialSupplier?: string
  initialBillMode?: ExpenseBillMode
  onClose: () => void
  onCreated?: (count: number) => void
}

type RowField = 'description' | 'billNo' | 'billDate' | 'amount'

const ROW_FIELD_ORDER: RowField[] = ['description', 'billNo', 'billDate', 'amount']
const PAY_TYPES: BulkPurchasePayType[] = ['cash', 'bank', 'cheque', 'credit']

function scrollActiveOptionIntoView(option: HTMLElement | null, list: HTMLElement | null) {
  if (!option || !list) return
  const listRect = list.getBoundingClientRect()
  const itemRect = option.getBoundingClientRect()
  if (itemRect.top < listRect.top) {
    list.scrollTop -= listRect.top - itemRect.top
  } else if (itemRect.bottom > listRect.bottom) {
    list.scrollTop += itemRect.bottom - listRect.bottom
  }
}

function nextHighlightedIndex(prev: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1
  if (prev < 0) return direction > 0 ? 0 : count - 1
  return (prev + direction + count) % count
}

function initialRows(masterBillDate: string): BulkPurchaseRow[] {
  return [createEmptyBulkRow(masterBillDate), createEmptyBulkRow(masterBillDate)]
}

export default function BulkPurchaseCreateModal({
  open,
  data,
  supplierNames: supplierNamesProp,
  initialSupplier = '',
  initialBillMode = 'no1',
  onClose,
  onCreated,
}: BulkPurchaseCreateModalProps) {
  const { recordIndependentExpenses, addSupplier, addSupplierItem } = useCash()
  const [billMode, setBillMode] = useState<ExpenseBillMode>(initialBillMode)
  const [supplierName, setSupplierName] = useState(initialSupplier)
  const [billDate, setBillDate] = useState(toInputDate())
  const [payType, setPayType] = useState<BulkPurchasePayType>('credit')
  const [rows, setRows] = useState<BulkPurchaseRow[]>(() => initialRows(toInputDate()))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false)
  const [highlightedSupplierIndex, setHighlightedSupplierIndex] = useState(-1)
  const [activeItemRowId, setActiveItemRowId] = useState<string | null>(null)
  const [highlightedItemIndex, setHighlightedItemIndex] = useState(-1)

  const supplierInputRef = useRef<HTMLInputElement>(null)
  const supplierSuggestionsListRef = useRef<HTMLUListElement>(null)
  const activeSupplierSuggestionRef = useRef<HTMLButtonElement>(null)
  const itemSuggestionsListRef = useRef<HTMLUListElement>(null)
  const activeItemSuggestionRef = useRef<HTMLButtonElement>(null)
  const supplierKeyboardNavRef = useRef(false)
  const itemKeyboardNavRef = useRef(false)
  const payButtonRefs = useRef<Partial<Record<BulkPurchasePayType, HTMLButtonElement | null>>>({})
  const rowInputRefs = useRef<Record<string, Partial<Record<RowField, HTMLInputElement | null>>>>({})

  useEffect(() => {
    if (!open) return
    const today = toInputDate()
    setBillMode(initialBillMode)
    setSupplierName(initialSupplier)
    setBillDate(today)
    setPayType('credit')
    setRows(initialRows(today))
    setError('')
    setBusy(false)
    setSupplierDropdownOpen(false)
    setHighlightedSupplierIndex(-1)
    setActiveItemRowId(null)
    setHighlightedItemIndex(-1)
    rowInputRefs.current = {}
  }, [open, initialSupplier, initialBillMode])

  const supplierOptions = useMemo(() => {
    const merged = buildPurchaseSupplierOptions(data)
    if (supplierNamesProp.length === 0) return merged
    const seen = new Map<string, string>()
    for (const name of [...supplierNamesProp, ...merged]) {
      const trimmed = name.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (!seen.has(key)) seen.set(key, trimmed)
    }
    return Array.from(seen.values())
  }, [data, supplierNamesProp])

  const filteredSupplierSuggestions = useMemo(() => {
    const query = supplierName.trim()
    if (!query) return supplierOptions
    return searchNamesByPrefix(supplierOptions, query, 20)
  }, [supplierName, supplierOptions])

  const validRowCount = useMemo(
    () => rows.filter((row) => parseAmount(row.amount) > 0 && row.description.trim()).length,
    [rows],
  )

  const totalAmount = useMemo(
    () => rows.reduce((sum, row) => sum + Math.max(0, parseAmount(row.amount)), 0),
    [rows],
  )

  const itemOptions = useMemo(() => {
    const base = supplierName.trim()
      ? buildSupplierItemOptions(data, supplierName)
      : buildAllPurchaseItemOptions(data)
    const seen = new Map<string, string>()
    for (const item of base) seen.set(item.toLowerCase(), item)
    for (const row of rows) {
      const detail = row.description.trim()
      if (detail) seen.set(detail.toLowerCase(), detail)
    }
    return Array.from(seen.values())
  }, [data, supplierName, rows])

  function itemSuggestionsForRow(description: string): string[] {
    return filterPurchaseItemSuggestions(description, itemOptions, 12)
  }

  useEffect(() => {
    if (!open || highlightedSupplierIndex < 0) return
    scrollActiveOptionIntoView(
      activeSupplierSuggestionRef.current,
      supplierSuggestionsListRef.current,
    )
  }, [highlightedSupplierIndex, open, filteredSupplierSuggestions.length])

  useEffect(() => {
    if (!open || highlightedItemIndex < 0 || !activeItemRowId) return
    scrollActiveOptionIntoView(activeItemSuggestionRef.current, itemSuggestionsListRef.current)
  }, [highlightedItemIndex, activeItemRowId, open])

  useEffect(() => {
    if (!open || !activeItemRowId || highlightedItemIndex < 0) return
    rowInputRefs.current[activeItemRowId]?.description?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [highlightedItemIndex, activeItemRowId, open])

  if (!open) return null

  function setRowRef(rowId: string, field: RowField, element: HTMLInputElement | null) {
    if (!rowInputRefs.current[rowId]) rowInputRefs.current[rowId] = {}
    rowInputRefs.current[rowId][field] = element
  }

  function focusRowField(rowIndex: number, field: RowField) {
    const row = rows[rowIndex]
    if (!row) return
    rowInputRefs.current[row.id]?.[field]?.focus()
  }

  function selectSupplier(value: string) {
    setSupplierName(value)
    setSupplierDropdownOpen(false)
    setHighlightedSupplierIndex(-1)
    window.setTimeout(() => focusRowField(0, 'description'), 0)
  }

  function handleMasterBillDateChange(next: string) {
    setBillDate(next)
    setRows((current) => applyMasterBillDateToRows(current, next))
  }

  function updateRow(id: string, patch: Partial<BulkPurchaseRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  function updateRowBillDate(id: string, nextDate: string) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row
        const usesMasterBillDate = nextDate === billDate
        return {
          ...row,
          billDate: nextDate,
          usesMasterBillDate,
        }
      }),
    )
  }

  function appendRowAndFocusDescription() {
    const newRow = createEmptyBulkRow(billDate)
    setRows((current) => {
      const next = [...current, newRow]
      window.setTimeout(() => rowInputRefs.current[newRow.id]?.description?.focus(), 0)
      return next
    })
  }

  function focusNextFromRow(rowIndex: number, field: RowField) {
    const fieldIndex = ROW_FIELD_ORDER.indexOf(field)
    if (fieldIndex >= 0 && fieldIndex < ROW_FIELD_ORDER.length - 1) {
      focusRowField(rowIndex, ROW_FIELD_ORDER[fieldIndex + 1]!)
      return
    }

    if (rowIndex < rows.length - 1) {
      focusRowField(rowIndex + 1, 'description')
      return
    }

    appendRowAndFocusDescription()
  }

  function focusPaymentField() {
    payButtonRefs.current[payType]?.focus()
  }

  function selectRowItem(rowId: string, item: string) {
    updateRow(rowId, { description: item })
    setActiveItemRowId(null)
    setHighlightedItemIndex(-1)
    const rowIndex = rows.findIndex((row) => row.id === rowId)
    if (rowIndex >= 0) window.setTimeout(() => focusRowField(rowIndex, 'billNo'), 0)
  }

  function handleDescriptionKeyDown(
    rowIndex: number,
    rowId: string,
    description: string,
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    const suggestions = itemSuggestionsForRow(description)
    const dropdownOpen = activeItemRowId === rowId && suggestions.length > 0

    if (event.key === 'Escape') {
      setActiveItemRowId(null)
      setHighlightedItemIndex(-1)
      itemKeyboardNavRef.current = false
      return
    }

    if (suggestions.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      itemKeyboardNavRef.current = true
      if (!dropdownOpen) setActiveItemRowId(rowId)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setHighlightedItemIndex((prev) => nextHighlightedIndex(prev, suggestions.length, direction))
      return
    }

    if (dropdownOpen) {
      if (event.key === 'Enter' && highlightedItemIndex >= 0) {
        event.preventDefault()
        const picked = suggestions[highlightedItemIndex]
        if (picked) selectRowItem(rowId, picked)
        return
      }
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      setActiveItemRowId(null)
      setHighlightedItemIndex(-1)
      handleRowEnter(rowIndex, 'description')
    }
  }

  function handleRowEnter(rowIndex: number, field: RowField) {
    if (field === 'amount') {
      const row = rows[rowIndex]
      const hasContent = Boolean(row?.description.trim() || row?.billNo.trim() || parseAmount(row?.amount ?? '') > 0)
      if (rowIndex === rows.length - 1 && hasContent) {
        appendRowAndFocusDescription()
        return
      }
      if (rowIndex < rows.length - 1) {
        focusRowField(rowIndex + 1, 'description')
        return
      }
      focusPaymentField()
      return
    }

    focusNextFromRow(rowIndex, field)
  }

  function handleSupplierEnter() {
    if (supplierDropdownOpen && highlightedSupplierIndex >= 0) {
      const picked = filteredSupplierSuggestions[highlightedSupplierIndex]
      if (picked) {
        selectSupplier(picked)
        return
      }
    }
    setSupplierDropdownOpen(false)
    focusRowField(0, 'description')
  }

  function cyclePayType(direction: 1 | -1) {
    const index = PAY_TYPES.indexOf(payType)
    const next = PAY_TYPES[(index + direction + PAY_TYPES.length) % PAY_TYPES.length]!
    setPayType(next)
    window.setTimeout(() => payButtonRefs.current[next]?.focus(), 0)
  }

  function loadFromHistory(append = false) {
    const historyRows = getSupplierBulkHistoryRows(data, supplierName, billMode, billDate)
    if (historyRows.length === 0) {
      setError('No purchase history found for this supplier and bill type.')
      return
    }
    setError('')
    setRows((current) => (append ? [...current, ...historyRows] : historyRows))
  }

  function removeRow(id: string) {
    setRows((current) => (current.length <= 1 ? current : current.filter((row) => row.id !== id)))
  }

  function handleCreate() {
    const validation = validateBulkPurchaseDraft(supplierName, rows)
    if (!validation.ok) {
      setError(validation.message ?? 'Could not create bills.')
      return
    }

    const payloads = buildBulkPurchasePayloads(billMode, supplierName, billDate, payType, rows)
    if (payloads.length === 0) {
      setError('Add at least one bill with an amount.')
      return
    }

    setBusy(true)
    setError('')

    const supplier = supplierName.trim()
    addSupplier(supplier)
    for (const payload of payloads) {
      if (payload.description) addSupplierItem(supplier, payload.description)
    }

    recordIndependentExpenses(payloads)
    onCreated?.(payloads.length)
    onClose()
  }

  return (
    <Portal>
      <div className="bulk-purchase-overlay" role="dialog" aria-modal="true" aria-label="Bulk purchase create">
        <button type="button" className="bulk-purchase-backdrop" aria-label="Close bulk purchase" onClick={onClose} />
        <section className="bulk-purchase-panel">
          <header className="bulk-purchase-head">
            <div>
              <h2>Bulk Purchase Create</h2>
              <p>Enter moves down each field. Use arrows on payment to pick cash, bank, cheque, or credit.</p>
            </div>
            <button type="button" className="bulk-purchase-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </header>

          <div className="bulk-purchase-bill-type">
            <button
              type="button"
              className={`bulk-purchase-bill-type-btn ${billMode === 'no1' ? 'bulk-purchase-bill-type-btn--active' : ''}`}
              onClick={() => setBillMode('no1')}
            >
              <strong>{purchaseBillLabel(1)}</strong>
              <small>{GST_BILL_LABEL}</small>
            </button>
            <button
              type="button"
              className={`bulk-purchase-bill-type-btn ${billMode === 'no2' ? 'bulk-purchase-bill-type-btn--active' : ''}`}
              onClick={() => setBillMode('no2')}
            >
              <strong>{purchaseBillLabel(2)}</strong>
              <small>{NO_GST_BILL_LABEL}</small>
            </button>
          </div>

          <div className="bulk-purchase-meta bulk-purchase-meta--stacked">
            <label className="bulk-purchase-field">
              <span>Bill date (applies to all rows)</span>
              <input
                type="date"
                className="bulk-purchase-input"
                value={billDate}
                onChange={(e) => handleMasterBillDateChange(e.target.value)}
              />
            </label>
            <label className="bulk-purchase-field bulk-purchase-field--supplier">
              <span>Supplier</span>
              <input
                ref={supplierInputRef}
                type="text"
                className="bulk-purchase-input"
                value={supplierName}
                onChange={(e) => {
                  setSupplierName(e.target.value)
                  setSupplierDropdownOpen(true)
                  setHighlightedSupplierIndex(-1)
                }}
                onFocus={() => {
                  setSupplierDropdownOpen(true)
                  setHighlightedSupplierIndex(-1)
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    setSupplierDropdownOpen(false)
                    supplierKeyboardNavRef.current = false
                  }, 120)
                }}
                onKeyDown={(e) => {
                  const count = filteredSupplierSuggestions.length
                  if (count > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                    e.preventDefault()
                    supplierKeyboardNavRef.current = true
                    if (!supplierDropdownOpen) setSupplierDropdownOpen(true)
                    const direction = e.key === 'ArrowDown' ? 1 : -1
                    setHighlightedSupplierIndex((prev) => nextHighlightedIndex(prev, count, direction))
                    return
                  }
                  if (supplierDropdownOpen && count > 0) {
                    if (e.key === 'Enter' && highlightedSupplierIndex >= 0) {
                      e.preventDefault()
                      const picked = filteredSupplierSuggestions[highlightedSupplierIndex]
                      if (picked) selectSupplier(picked)
                      return
                    }
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSupplierEnter()
                  }
                }}
                placeholder="Party / supplier name"
                autoComplete="off"
                spellCheck={false}
              />
              {supplierDropdownOpen && filteredSupplierSuggestions.length > 0 ? (
                <ul
                  ref={supplierSuggestionsListRef}
                  className="bulk-purchase-suggestions"
                  role="listbox"
                  onMouseMove={() => {
                    supplierKeyboardNavRef.current = false
                  }}
                  onWheel={(event) => event.stopPropagation()}
                >
                  {filteredSupplierSuggestions.map((name, index) => (
                    <li key={name}>
                      <button
                        type="button"
                        ref={index === highlightedSupplierIndex ? activeSupplierSuggestionRef : null}
                        className={`bulk-purchase-suggestion ${index === highlightedSupplierIndex ? 'bulk-purchase-suggestion--active' : ''}`}
                        aria-selected={index === highlightedSupplierIndex}
                        onMouseEnter={() => {
                          if (!supplierKeyboardNavRef.current) setHighlightedSupplierIndex(index)
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectSupplier(name)}
                      >
                        {name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </label>
          </div>

          <div className="bulk-purchase-rows-head" aria-hidden="true">
            <span>Item / Description</span>
            <span>Bill no.</span>
            <span>Bill date</span>
            <span>Amount</span>
            <span />
          </div>

          <div className="bulk-purchase-rows">
            {rows.map((row, index) => {
              const itemSuggestions = itemSuggestionsForRow(row.description)
              const itemDropdownOpen = activeItemRowId === row.id && itemSuggestions.length > 0

              return (
              <div
                key={row.id}
                className={`bulk-purchase-row ${row.usesMasterBillDate ? '' : 'bulk-purchase-row--custom-date'}`}
              >
                <div className="bulk-purchase-row-cell bulk-purchase-row-cell--item">
                  <input
                    ref={(element) => setRowRef(row.id, 'description', element)}
                    type="text"
                    className="bulk-purchase-input"
                    value={row.description}
                    onChange={(e) => {
                      updateRow(row.id, { description: e.target.value })
                      setActiveItemRowId(row.id)
                      setHighlightedItemIndex(-1)
                    }}
                    onFocus={() => {
                      setActiveItemRowId(row.id)
                      setHighlightedItemIndex(-1)
                    }}
                    onBlur={() => {
                      window.setTimeout(() => {
                        setActiveItemRowId((current) => (current === row.id ? null : current))
                        setHighlightedItemIndex(-1)
                        itemKeyboardNavRef.current = false
                      }, 120)
                    }}
                    onKeyDown={(e) => handleDescriptionKeyDown(index, row.id, row.description, e)}
                    placeholder={`Item ${index + 1}`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {itemDropdownOpen ? (
                    <ul
                      ref={itemSuggestionsListRef}
                      className="bulk-purchase-suggestions bulk-purchase-suggestions--item"
                      role="listbox"
                      onMouseMove={() => {
                        itemKeyboardNavRef.current = false
                      }}
                      onWheel={(event) => event.stopPropagation()}
                    >
                      {itemSuggestions.map((item, suggestionIndex) => (
                        <li key={`${row.id}-${item}`}>
                          <button
                            type="button"
                            ref={
                              suggestionIndex === highlightedItemIndex ? activeItemSuggestionRef : null
                            }
                            className={`bulk-purchase-suggestion ${suggestionIndex === highlightedItemIndex ? 'bulk-purchase-suggestion--active' : ''}`}
                            aria-selected={suggestionIndex === highlightedItemIndex}
                            onMouseEnter={() => {
                              if (!itemKeyboardNavRef.current) setHighlightedItemIndex(suggestionIndex)
                            }}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectRowItem(row.id, item)}
                          >
                            {item}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <input
                  ref={(element) => setRowRef(row.id, 'billNo', element)}
                  type="text"
                  className="bulk-purchase-input"
                  value={row.billNo}
                  onChange={(e) => updateRow(row.id, { billNo: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleRowEnter(index, 'billNo')
                    }
                  }}
                  placeholder="Bill no."
                  autoComplete="off"
                  spellCheck={false}
                />
                <input
                  ref={(element) => setRowRef(row.id, 'billDate', element)}
                  type="date"
                  className="bulk-purchase-input bulk-purchase-input--date"
                  value={row.billDate}
                  onChange={(e) => updateRowBillDate(row.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleRowEnter(index, 'billDate')
                    }
                  }}
                  aria-label={`Bill date for row ${index + 1}`}
                />
                <input
                  ref={(element) => setRowRef(row.id, 'amount', element)}
                  type="text"
                  inputMode="decimal"
                  className="bulk-purchase-input"
                  value={row.amount}
                  onChange={(e) => updateRow(row.id, { amount: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleRowEnter(index, 'amount')
                    }
                  }}
                  placeholder="0"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="bulk-purchase-row-remove"
                  onClick={() => removeRow(row.id)}
                  aria-label={`Remove row ${index + 1}`}
                >
                  ×
                </button>
              </div>
            )})}
          </div>

          <div className="bulk-purchase-row-actions">
            <button type="button" className="bulk-purchase-chip-btn" onClick={appendRowAndFocusDescription}>
              + Add row
            </button>
            <button
              type="button"
              className="bulk-purchase-chip-btn"
              onClick={() => loadFromHistory(false)}
              disabled={!supplierName.trim()}
            >
              Load from history
            </button>
            <button
              type="button"
              className="bulk-purchase-chip-btn"
              onClick={() => loadFromHistory(true)}
              disabled={!supplierName.trim()}
            >
              Append history
            </button>
          </div>

          <div className="bulk-purchase-pay">
            <span className="bulk-purchase-field">
              <span>Payment for all bills</span>
            </span>
            <div className="bulk-purchase-pay-options">
              {PAY_TYPES.map((type) => (
                <button
                  key={type}
                  ref={(element) => {
                    payButtonRefs.current[type] = element
                  }}
                  type="button"
                  className={`bulk-purchase-pay-btn ${payType === type ? 'bulk-purchase-pay-btn--active' : ''}`}
                  onClick={() => setPayType(type)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                      e.preventDefault()
                      cyclePayType(1)
                    }
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                      e.preventDefault()
                      cyclePayType(-1)
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleCreate()
                    }
                  }}
                >
                  {type === 'cash' ? '💵 Cash' : null}
                  {type === 'bank' ? '🏦 Bank' : null}
                  {type === 'cheque' ? '🧾 Cheque' : null}
                  {type === 'credit' ? '💳 Credit' : null}
                </button>
              ))}
            </div>
          </div>

          <div className="bulk-purchase-summary">
            <span>
              {validRowCount} bill{validRowCount === 1 ? '' : 's'} · {purchaseBillLabel(billMode === 'no1' ? 1 : 2)}
            </span>
            <strong>{formatMoney(totalAmount)}</strong>
          </div>

          {error ? <p className="bulk-purchase-error">{error}</p> : null}

          <div className="bulk-purchase-foot">
            <button type="button" className="bulk-purchase-btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="bulk-purchase-btn bulk-purchase-btn--primary"
              onClick={handleCreate}
              disabled={busy || validRowCount === 0}
            >
              Create {validRowCount || ''} bill{validRowCount === 1 ? '' : 's'}
            </button>
          </div>
        </section>
      </div>
    </Portal>
  )
}
