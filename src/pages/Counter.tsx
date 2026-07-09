import { useMemo, useState } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import PayTypeChips, { type PayType } from '../components/PayTypeChips'
import RoundTypeChips from '../components/RoundTypeChips'
import { formatMoney, parseAmount } from '../utils/format'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { getBillRoundOptions } from '../utils/roundSuggestions'
import './Counter.css'

type ActiveField = 'bill' | 'give' | 'paid' | 'cashSplit' | 'bankSplit'

const FIELD_ORDER: ActiveField[] = ['bill', 'give', 'paid', 'cashSplit', 'bankSplit']

export default function Counter() {
  const { recordSale } = useCash()
  const [billStr, setBillStr] = useState('')
  const [giveStr, setGiveStr] = useState('')
  const [paidStr, setPaidStr] = useState('')
  const [cashSplitStr, setCashSplitStr] = useState('')
  const [bankSplitStr, setBankSplitStr] = useState('')
  const [roundOffAmount, setRoundOffAmount] = useState<number | null>(null)
  const [paymentStep, setPaymentStep] = useState(false)
  const [payType, setPayType] = useState<PayType>('cash')
  const [activeField, setActiveField] = useState<ActiveField>('bill')
  const [saved, setSaved] = useState(false)

  const billAmount = parseAmount(billStr)
  const giveAmount = parseAmount(giveStr)
  const paidAmount = parseAmount(paidStr)
  const cashSplitAmount = parseAmount(cashSplitStr)
  const bankSplitAmount = parseAmount(bankSplitStr)
  const dueAmount = roundOffAmount ?? billAmount

  const splitPaidTotal = cashSplitAmount + bankSplitAmount
  const customerPaidAmount = payType === 'split' ? splitPaidTotal : paidAmount

  const changeAmount =
    payType === 'bank'
      ? 0
      : payType === 'split'
        ? Math.max(0, giveAmount - cashSplitAmount)
        : Math.max(0, giveAmount - paidAmount)

  const needMore =
    paymentStep &&
    (payType === 'cash'
      ? paidAmount > 0 && giveAmount > 0 && giveAmount < paidAmount
      : payType === 'split'
        ? cashSplitAmount > 0 && giveAmount > 0 && giveAmount < cashSplitAmount
        : false)

  const splitMismatch =
    paymentStep &&
    payType === 'split' &&
    splitPaidTotal > 0 &&
    paidAmount > 0 &&
    splitPaidTotal !== paidAmount

  const isValid =
    paymentStep &&
    billAmount > 0 &&
    (payType === 'bank'
      ? paidAmount > 0
      : payType === 'cash'
        ? paidAmount > 0 && giveAmount >= paidAmount
        : paidAmount > 0 &&
          cashSplitAmount > 0 &&
          bankSplitAmount > 0 &&
          splitPaidTotal === paidAmount &&
          giveAmount >= cashSplitAmount)

  const billRoundOptions = useMemo(() => getBillRoundOptions(billAmount), [billAmount])
  const showRoundChips = billAmount > 0 && billRoundOptions.length > 0

  const customerPaidPreview =
    paymentStep && payType === 'split'
      ? customerPaidAmount > 0
        ? formatMoney(customerPaidAmount)
        : '—'
      : paymentStep && paidAmount > 0
        ? formatMoney(paidAmount)
        : billStr
          ? formatMoney(dueAmount)
          : '—'

  function nextField(current: ActiveField): ActiveField {
    const allowed = FIELD_ORDER.filter((field) => {
      if (field === 'give') return payType !== 'bank'
      if (field === 'paid') return paymentStep
      if (field === 'cashSplit' || field === 'bankSplit')
        return paymentStep && payType === 'split'
      return true
    })
    const idx = allowed.indexOf(current)
    if (idx === -1 || idx === allowed.length - 1) return allowed[0]
    return allowed[idx + 1]
  }

  function openPaymentStep() {
    setPaymentStep(true)
    setActiveField('paid')
    if (!paidStr && dueAmount > 0) setPaidStr(String(dueAmount))
  }

  function handleEnter() {
    if (activeField === 'bill') {
      setActiveField('give')
      return
    }
    if (activeField === 'give') {
      openPaymentStep()
      return
    }

    const next = nextField(activeField)
    setActiveField(next)
    if (next === 'paid' && !paidStr && dueAmount > 0) {
      setPaidStr(String(dueAmount))
    }
  }

  function handlePayTypeChange(type: PayType) {
    setPayType(type)
    setCashSplitStr('')
    setBankSplitStr('')
    if (!paidStr && dueAmount > 0) setPaidStr(String(dueAmount))
    if (paymentStep) {
      if (type === 'split') setActiveField('cashSplit')
      else if (type === 'bank') setActiveField('paid')
      else setActiveField('paid')
    }
  }

  function handleNumpad(action: NumpadAction) {
    if (action === 'enter') {
      handleEnter()
      return
    }

    if (activeField === 'bill') {
      setBillStr((prev) => applyNumpadAction(prev, action))
      setRoundOffAmount(null)
      setPaymentStep(false)
      setPaidStr('')
      setCashSplitStr('')
      setBankSplitStr('')
    } else if (activeField === 'give') {
      setGiveStr((prev) => applyNumpadAction(prev, action))
    } else if (activeField === 'paid') {
      setPaidStr((prev) => applyNumpadAction(prev, action))
    } else if (activeField === 'cashSplit') {
      setCashSplitStr((prev) => applyNumpadAction(prev, action))
    } else if (activeField === 'bankSplit') {
      setBankSplitStr((prev) => applyNumpadAction(prev, action))
    }
  }

  function resetForm() {
    setBillStr('')
    setGiveStr('')
    setPaidStr('')
    setCashSplitStr('')
    setBankSplitStr('')
    setRoundOffAmount(null)
    setPaymentStep(false)
    setPayType('cash')
    setActiveField('bill')
    setSaved(false)
  }

  function handleSave() {
    if (!isValid) return

    const cashAmount =
      payType === 'cash' ? paidAmount : payType === 'split' ? cashSplitAmount : 0
    const bankAmount =
      payType === 'bank' ? paidAmount : payType === 'split' ? bankSplitAmount : 0

    recordSale({
      billAmount: paidAmount,
      originalBillAmount: billAmount,
      paidAmount: payType === 'bank' ? paidAmount : giveAmount,
      changeAmount,
      payType,
      cashAmount,
      bankAmount,
    })
    setSaved(true)
    setTimeout(resetForm, 900)
  }

  return (
    <div className="counter-page">
      <div className="counter-amounts">
        <AmountDisplay
          label="Bill"
          value={billStr}
          active={activeField === 'bill'}
          onSelect={() => setActiveField('bill')}
          compact
        />
        <AmountDisplay
          label="Customer Give"
          value={giveStr}
          active={activeField === 'give'}
          onSelect={() => setActiveField('give')}
          compact
        />
        {paymentStep && payType !== 'split' ? (
          <AmountDisplay
            label="Customer Paid"
            value={paidStr}
            active={activeField === 'paid'}
            onSelect={() => setActiveField('paid')}
            compact
          />
        ) : (
          <div
            className={`counter-readonly ${!paymentStep && billStr ? 'counter-readonly--mirror' : ''}`}
          >
            <span className="counter-readonly-label">Customer Paid</span>
            <span className="counter-readonly-value">{customerPaidPreview}</span>
          </div>
        )}
        <div
          className={`counter-readonly counter-readonly--return ${isValid ? 'counter-readonly--ready' : ''} ${needMore || splitMismatch ? 'counter-readonly--warn' : ''}`}
        >
          <span className="counter-readonly-label">Return</span>
          <span className="counter-readonly-value">
            {splitMismatch
              ? '≠'
              : needMore
                ? `+${formatMoney((payType === 'split' ? cashSplitAmount : paidAmount) - giveAmount)}`
                : paymentStep && (isValid || changeAmount > 0)
                  ? formatMoney(changeAmount)
                  : '—'}
          </span>
        </div>
      </div>

      <div className="counter-pay">
        <PayTypeChips value={payType} onChange={handlePayTypeChange} />
      </div>

      {paymentStep && payType === 'split' && (
        <div className="counter-split counter-box">
          <AmountDisplay
            label="Cash"
            value={cashSplitStr}
            active={activeField === 'cashSplit'}
            onSelect={() => setActiveField('cashSplit')}
            compact
          />
          <AmountDisplay
            label="Bank"
            value={bankSplitStr}
            active={activeField === 'bankSplit'}
            onSelect={() => setActiveField('bankSplit')}
            compact
          />
          <AmountDisplay
            label="Paid Total"
            value={paidStr}
            active={activeField === 'paid'}
            onSelect={() => setActiveField('paid')}
            compact
          />
        </div>
      )}

      <div className="counter-keyboard-wrap">
        <NumberKeyboard onPress={handleNumpad} />
      </div>

      <div className="counter-round">
        {showRoundChips ? (
          <RoundTypeChips
            label="Round down"
            options={billRoundOptions}
            onSelect={(amt) => {
              setRoundOffAmount(amt)
              if (paymentStep) setPaidStr(String(amt))
              else setActiveField('give')
            }}
            activeAmount={roundOffAmount ?? undefined}
            compact
          />
        ) : (
          <p className="counter-round-empty">Round down</p>
        )}
      </div>

      <div className="counter-actions">
        <button type="button" className="btn btn-secondary" onClick={resetForm}>
          Clear
        </button>
        <button
          type="button"
          className={`btn btn-primary ${saved ? 'btn-saved' : ''}`}
          onClick={handleSave}
          disabled={!isValid || saved}
        >
          {saved ? '✓ Saved' : 'Save & Collect'}
        </button>
      </div>
    </div>
  )
}
