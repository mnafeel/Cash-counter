import { useEffect, useMemo, useState } from 'react'
import { useCash } from '../context/CashContext'
import { useIsActiveRoute } from '../hooks/useIsActiveRoute'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import AmountDisplay from './AmountDisplay'
import NumberKeyboard from './NumberKeyboard'
import AdvanceCustomerLedgerList from './AdvanceCustomerLedgerList'
import CustomerNameAutocomplete from './CustomerNameAutocomplete'
import { buildCustomerAdvanceGroups, customerAdvanceBalance } from '../utils/customerAdvance'
import { buildCustomerSummaries } from '../utils/customerLedger'
import { formatMoney, parseAmount } from '../utils/format'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import './AdvanceRecordPanel.css'

export interface AdvanceRecordPanelProps {
  defaultCustomerName?: string
  numpadRoutePrefix?: string
  compact?: boolean
  /** Form only (e.g. inside create modal). */
  formOnly?: boolean
  onSaved?: () => void
}

export default function AdvanceRecordPanel({
  defaultCustomerName = '',
  numpadRoutePrefix,
  compact = false,
  formOnly = false,
  onSaved,
}: AdvanceRecordPanelProps) {
  const { data, recordCustomerAdvance } = useCash()
  const [customerName, setCustomerName] = useState(defaultCustomerName)
  const [amountStr, setAmountStr] = useState('')
  const [payType, setPayType] = useState<'cash' | 'bank'>('cash')
  const [note, setNote] = useState('')
  const [amountFocused, setAmountFocused] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (defaultCustomerName) setCustomerName(defaultCustomerName)
  }, [defaultCustomerName])

  const nameSuggestions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const row of buildCustomerSummaries(data)) {
      const key = row.name.trim().toLowerCase()
      if (!seen.has(key)) seen.set(key, row.name.trim())
    }
    for (const group of buildCustomerAdvanceGroups(data)) {
      const key = group.customerName.trim().toLowerCase()
      if (!seen.has(key)) seen.set(key, group.customerName)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [data])

  const balance = useMemo(
    () => customerAdvanceBalance(data, customerName),
    [data, customerName],
  )

  const amount = parseAmount(amountStr)
  const canSave = customerName.trim().length > 0 && amount > 0

  function onNumpad(action: NumpadAction) {
    if (!amountFocused) return
    setAmountStr((prev) => applyNumpadAction(prev, action))
  }

  const routeActive = useIsActiveRoute(numpadRoutePrefix ?? '/__advance-record-inactive__')
  useNumpadKeyboard(
    onNumpad,
    Boolean(numpadRoutePrefix) && routeActive && amountFocused && !compact,
  )

  function handleSave() {
    if (!canSave) return
    const ok = recordCustomerAdvance({
      customerName: customerName.trim(),
      amount,
      payType,
      note: note.trim() || undefined,
    })
    if (ok) {
      setAmountStr('')
      setNote('')
      setAmountFocused(false)
      setSaved(true)
      onSaved?.()
      window.setTimeout(() => setSaved(false), 1400)
    }
  }

  return (
    <div className={`advance-record ${compact ? 'advance-record--compact' : ''}`}>
      {!compact && !formOnly ? (
        <AdvanceCustomerLedgerList
          compact
          mode="open"
          onPickCustomer={(name) => setCustomerName(name)}
        />
      ) : null}

      <div className="advance-record-form">
        <CustomerNameAutocomplete
          id="advance-record-customer"
          label="Customer"
          value={customerName}
          suggestions={nameSuggestions}
          onChange={setCustomerName}
          placeholder="Type to search customers"
        />
        {balance > 0.01 ? (
          <span className="advance-record-pill">Open balance {formatMoney(balance)}</span>
        ) : customerName.trim() ? (
          <span className="advance-record-pill advance-record-pill--muted">No open advance</span>
        ) : null}
        {compact ? (
          <div className="advance-record-field">
            <label htmlFor="advance-record-amount-compact">Amount</label>
            <input
              id="advance-record-amount-compact"
              className="advance-record-amount-input"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0"
            />
          </div>
        ) : (
          <>
            <div className="advance-record-field">
              <label>Amount</label>
              <button
                type="button"
                className="advance-record-amount-hit"
                onClick={() => setAmountFocused(true)}
              >
                <AmountDisplay label="Amount" value={amountStr || '0'} active={amountFocused} compact />
              </button>
            </div>
            {amountFocused ? <NumberKeyboard onPress={onNumpad} /> : null}
          </>
        )}
        <div className="advance-record-pay" role="group" aria-label="Payment method">
          <button type="button" aria-pressed={payType === 'cash'} onClick={() => setPayType('cash')}>
            Cash
          </button>
          <button type="button" aria-pressed={payType === 'bank'} onClick={() => setPayType('bank')}>
            Bank
          </button>
        </div>
        <div className="advance-record-field">
          <label htmlFor="advance-record-note">Note (optional)</label>
          <input
            id="advance-record-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reference"
          />
        </div>
        <button type="button" className="advance-record-save" disabled={!canSave} onClick={handleSave}>
          {saved ? 'Saved ✓' : 'Save advance'}
        </button>
      </div>
    </div>
  )
}
