import { useMemo, useState } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import RoundTypeChips from '../components/RoundTypeChips'
import { formatMoney, parseAmount } from '../utils/format'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { getBillRoundOptions } from '../utils/roundSuggestions'
import './Counter.css'

type ActiveField = 'bill' | 'paid'

export default function Counter() {
  const { recordSale } = useCash()
  const [billStr, setBillStr] = useState('')
  const [paidStr, setPaidStr] = useState('')
  const [activeField, setActiveField] = useState<ActiveField>('bill')
  const [saved, setSaved] = useState(false)

  const billAmount = parseAmount(billStr)
  const paidAmount = parseAmount(paidStr)
  const changeAmount = Math.max(0, paidAmount - billAmount)
  const isValid = billAmount > 0 && paidAmount >= billAmount
  const needMore = billAmount > 0 && paidAmount > 0 && paidAmount < billAmount

  const billRoundOptions = useMemo(() => getBillRoundOptions(billAmount), [billAmount])

  function handleNumpad(action: NumpadAction) {
    if (activeField === 'bill') {
      setBillStr((prev) => applyNumpadAction(prev, action))
    } else {
      setPaidStr((prev) => applyNumpadAction(prev, action))
    }
  }

  function handleSave() {
    if (!isValid) return
    recordSale({
      billAmount,
      paidAmount,
      changeAmount,
    })
    setSaved(true)
    setTimeout(() => {
      setBillStr('')
      setPaidStr('')
      setActiveField('bill')
      setSaved(false)
    }, 900)
  }

  function handleClear() {
    setBillStr('')
    setPaidStr('')
    setActiveField('bill')
    setSaved(false)
  }

  const roundOffFooter =
    billAmount > 0 ? (
      <RoundTypeChips
        label="Round off"
        options={billRoundOptions}
        onSelect={(amt) => {
          setBillStr(String(amt))
          setActiveField('bill')
        }}
        activeAmount={billAmount}
        compact
      />
    ) : (
      <p className="counter-round-empty">Round off appears after bill amount</p>
    )

  return (
    <div className="counter-page">
      <div className="counter-top">
        <AmountDisplay
          label="Bill"
          value={billStr}
          active={activeField === 'bill'}
          onSelect={() => setActiveField('bill')}
          compact
        />
        <AmountDisplay
          label="Customer"
          value={paidStr}
          active={activeField === 'paid'}
          onSelect={() => setActiveField('paid')}
          compact
        />
        <div
          className={`counter-change ${isValid ? 'counter-change--ready' : ''} ${needMore ? 'counter-change--warn' : ''}`}
        >
          <span className="counter-change-label">Return</span>
          <span className="counter-change-value">
            {needMore
              ? `+${formatMoney(billAmount - paidAmount)}`
              : isValid
                ? formatMoney(changeAmount)
                : '—'}
          </span>
        </div>
      </div>

      <NumberKeyboard onPress={handleNumpad} footer={roundOffFooter} />

      <div className="counter-actions">
        <button type="button" className="btn btn-secondary btn-compact" onClick={handleClear}>
          Clear
        </button>
        <button
          type="button"
          className={`btn btn-primary btn-compact ${saved ? 'btn-saved' : ''}`}
          onClick={handleSave}
          disabled={!isValid || saved}
        >
          {saved ? '✓ Saved' : 'Save & Collect'}
        </button>
      </div>
    </div>
  )
}
