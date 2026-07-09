import { useMemo, useState } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import PayTypeChips, { type PayType } from '../components/PayTypeChips'
import PendingBillsPanel from '../components/PendingBillsPanel'
import RoundTypeChips from '../components/RoundTypeChips'
import type { Sale } from '../types'
import { formatMoney, parseAmount } from '../utils/format'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { getBillRoundOptions } from '../utils/roundSuggestions'
import './Counter.css'

type ActiveField = 'bill' | 'give' | 'paid' | 'cashSplit' | 'bankSplit'

function needsGive(payType: PayType): boolean {
  return payType === 'cash' || payType === 'split'
}

function paymentFields(payType: PayType, paymentStep: boolean): ActiveField[] {
  if (!paymentStep) {
    return needsGive(payType) ? ['bill', 'give'] : ['bill']
  }
  if (payType === 'split') return ['cashSplit', 'bankSplit']
  return ['paid']
}

function nextField(
  current: ActiveField,
  payType: PayType,
  paymentStep: boolean,
): ActiveField {
  const allowed: ActiveField[] =
    payType === 'split'
      ? ['bill', 'give', 'cashSplit', 'bankSplit']
      : ['bill', 'give', ...paymentFields(payType, paymentStep)]
  const idx = allowed.indexOf(current)
  if (idx === -1 || idx === allowed.length - 1) return allowed[0]
  return allowed[idx + 1]
}

function keyboardHint(activeField: ActiveField, payType: PayType): string {
  if (activeField === 'bill') return 'Bill Amount'
  if (activeField === 'give') return 'Customer Give'
  if (activeField === 'paid') return 'Customer Paid'
  if (activeField === 'cashSplit') return payType === 'split' ? 'Cash · Bank auto-fills' : 'Cash'
  if (activeField === 'bankSplit') return payType === 'split' ? 'Bank · Cash auto-fills' : 'Bank'
  return 'Amount'
}

function formatSplitPart(amount: number): string {
  if (amount <= 0) return '0'
  return Number.isInteger(amount) ? String(amount) : String(amount)
}

export default function Counter() {
  const { recordSale, pendingBills } = useCash()
  const [billStr, setBillStr] = useState('')
  const [giveStr, setGiveStr] = useState('')
  const [paidStr, setPaidStr] = useState('')
  const [cashSplitStr, setCashSplitStr] = useState('')
  const [bankSplitStr, setBankSplitStr] = useState('')
  const [roundOffAmount, setRoundOffAmount] = useState<number | null>(null)
  const [paymentStep, setPaymentStep] = useState(false)
  const [payType, setPayType] = useState<PayType>('cash')
  const [customerName, setCustomerName] = useState('')
  const [activeField, setActiveField] = useState<ActiveField>('bill')
  const [saved, setSaved] = useState(false)

  const billAmount = parseAmount(billStr)
  const giveAmount = parseAmount(giveStr)
  const paidAmount = parseAmount(paidStr)
  const cashSplitAmount = parseAmount(cashSplitStr)
  const bankSplitAmount = parseAmount(bankSplitStr)
  const dueAmount = roundOffAmount ?? billAmount

  const splitTotal = paidAmount > 0 ? paidAmount : dueAmount

  const splitPaidTotal = cashSplitAmount + bankSplitAmount

  const paidForReturn =
    payType === 'split'
      ? cashSplitAmount
      : paymentStep
        ? paidAmount
        : dueAmount

  const changeAmount =
    payType === 'bank' || payType === 'credit'
      ? 0
      : Math.max(0, giveAmount - paidForReturn)

  const needMore =
    needsGive(payType) &&
    giveAmount > 0 &&
    paidForReturn > 0 &&
    giveAmount < paidForReturn

  const shortfallAmount = needMore ? paidForReturn - giveAmount : 0

  const splitMismatch =
    payType === 'split' &&
    splitTotal > 0 &&
    splitPaidTotal > 0 &&
    splitPaidTotal !== splitTotal

  const showReturnLive =
    needsGive(payType) && giveAmount > 0 && paidForReturn > 0 && !splitMismatch

  const returnDisplay = (() => {
    if (payType === 'bank' || payType === 'credit') return '—'
    if (splitMismatch) return '≠'
    if (needMore) return `+${formatMoney(shortfallAmount)}`
    if (showReturnLive) return formatMoney(changeAmount)
    return '—'
  })()

  const isValid =
    billAmount > 0 &&
    (payType === 'bank' || payType === 'credit'
      ? paymentStep && paidAmount > 0
      : payType === 'cash'
        ? paymentStep && paidAmount > 0 && giveAmount >= paidAmount
        : payType === 'split'
          ? splitTotal > 0 &&
            splitPaidTotal === splitTotal &&
            cashSplitAmount >= 0 &&
            bankSplitAmount >= 0 &&
            (cashSplitAmount > 0 || bankSplitAmount > 0) &&
            giveAmount >= cashSplitAmount
          : false)

  const canSavePending = dueAmount > 0 && !saved

  const billRoundOptions = useMemo(() => getBillRoundOptions(billAmount), [billAmount])
  const showRoundChips = billAmount > 0 && billRoundOptions.length > 0

  const customerPaidPreview =
    payType === 'split'
      ? splitPaidTotal > 0
        ? formatMoney(splitPaidTotal)
        : splitTotal > 0
          ? formatMoney(splitTotal)
          : '—'
      : paymentStep && paidAmount > 0
        ? formatMoney(paidAmount)
        : billStr
          ? formatMoney(dueAmount)
          : '—'

  function applySplitCash(nextCashStr: string, totalOverride?: number) {
    setCashSplitStr(nextCashStr)
    const total = totalOverride ?? splitTotal
    if (total <= 0) {
      setBankSplitStr('')
      return
    }
    if (nextCashStr === '') {
      setBankSplitStr('')
      return
    }
    const cash = parseAmount(nextCashStr)
    const bank = Math.max(0, total - cash)
    setBankSplitStr(formatSplitPart(bank))
  }

  function applySplitBank(nextBankStr: string, totalOverride?: number) {
    setBankSplitStr(nextBankStr)
    const total = totalOverride ?? splitTotal
    if (total <= 0) {
      setCashSplitStr('')
      return
    }
    if (nextBankStr === '') {
      setCashSplitStr('')
      return
    }
    const bank = parseAmount(nextBankStr)
    const cash = Math.max(0, total - bank)
    setCashSplitStr(formatSplitPart(cash))
  }

  function openSplitMode() {
    setPaymentStep(true)
    if (dueAmount > 0) setPaidStr(String(dueAmount))
    setCashSplitStr('')
    setBankSplitStr('')
    setActiveField('cashSplit')
  }

  function openPaymentStep() {
    if (payType === 'split') {
      openSplitMode()
      return
    }
    setPaymentStep(true)
    if (!paidStr && dueAmount > 0) setPaidStr(String(dueAmount))
    setActiveField('paid')
  }

  function handleEnter() {
    if (activeField === 'bill') {
      if (needsGive(payType)) setActiveField('give')
      else openPaymentStep()
      return
    }
    if (activeField === 'give') {
      openPaymentStep()
      return
    }

    const next = nextField(activeField, payType, paymentStep)
    setActiveField(next)
    if (next === 'paid' && !paidStr && dueAmount > 0) {
      setPaidStr(String(dueAmount))
    }
  }

  function handlePayTypeChange(type: PayType) {
    setPayType(type)
    setCashSplitStr('')
    setBankSplitStr('')
    if (!needsGive(type)) setGiveStr('')
    if (!paidStr && dueAmount > 0) setPaidStr(String(dueAmount))

    if (type === 'split') {
      openSplitMode()
    } else if (paymentStep) {
      setActiveField('paid')
    } else if (!needsGive(type) && billAmount > 0) {
      setActiveField('bill')
    }
  }

  function handleNumpad(action: NumpadAction) {
    if (action === 'enter') {
      handleEnter()
      return
    }

    if (activeField === 'bill') {
      const next = applyNumpadAction(billStr, action)
      setBillStr(next)
      setRoundOffAmount(null)
      if (payType === 'split') {
        const newDue = parseAmount(next)
        if (newDue > 0) {
          setPaidStr(String(newDue))
          if (cashSplitStr) applySplitCash(cashSplitStr, newDue)
          else if (bankSplitStr) applySplitBank(bankSplitStr, newDue)
        } else {
          setPaidStr('')
          setCashSplitStr('')
          setBankSplitStr('')
        }
      } else {
        setPaymentStep(false)
        setPaidStr('')
        setCashSplitStr('')
        setBankSplitStr('')
      }
    } else if (activeField === 'give') {
      setGiveStr((prev) => applyNumpadAction(prev, action))
    } else if (activeField === 'paid') {
      setPaidStr((prev) => applyNumpadAction(prev, action))
    } else if (activeField === 'cashSplit') {
      applySplitCash(applyNumpadAction(cashSplitStr, action))
    } else if (activeField === 'bankSplit') {
      applySplitBank(applyNumpadAction(bankSplitStr, action))
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
    setCustomerName('')
    setActiveField('bill')
    setSaved(false)
  }

  function loadPendingBill(bill: Sale) {
    setBillStr(String(bill.originalBillAmount ?? bill.billAmount))
    setGiveStr('')
    setPaidStr(String(bill.billAmount))
    setRoundOffAmount(null)
    setCashSplitStr('')
    setBankSplitStr('')
    setCustomerName(bill.customerName ?? '')
    setPayType('credit')
    setPaymentStep(true)
    setActiveField('paid')
    setSaved(false)
  }

  function handleSavePending() {
    if (!canSavePending) return

    recordSale({
      billAmount: dueAmount,
      originalBillAmount: billAmount,
      paidAmount: 0,
      changeAmount: 0,
      payType: 'credit',
      creditAmount: dueAmount,
      status: 'pending',
      customerName: customerName.trim() || undefined,
    })
    setSaved(true)
    setTimeout(resetForm, 900)
  }

  function handleSave() {
    if (!isValid) return

    const cashAmount =
      payType === 'cash' ? paidAmount : payType === 'split' ? cashSplitAmount : 0
    const bankAmount =
      payType === 'bank' ? paidAmount : payType === 'split' ? bankSplitAmount : 0
    const creditAmount = payType === 'credit' ? paidAmount : 0
    const name = customerName.trim() || undefined

    recordSale({
      billAmount: payType === 'split' ? splitTotal : paidAmount,
      originalBillAmount: billAmount,
      paidAmount: payType === 'bank' || payType === 'credit' ? paidAmount : giveAmount,
      changeAmount,
      payType,
      cashAmount,
      bankAmount,
      creditAmount,
      customerName: name,
      status: payType === 'credit' ? 'pending' : 'paid',
    })
    setSaved(true)
    setTimeout(resetForm, 900)
  }

  const saveLabel =
    payType === 'credit'
      ? saved
        ? '✓ Saved'
        : 'Save\nCredit'
      : saved
        ? '✓ Saved'
        : 'Save &\nCollect'

  return (
    <div className="counter-page">
      <div className="counter-body">
        <div className="counter-main">
          <div className="counter-top">
            <div className={`counter-amounts ${payType === 'split' ? 'counter-amounts--split' : ''}`}>
            <AmountDisplay
              label="Bill"
              value={billStr}
              active={activeField === 'bill'}
              onSelect={() => setActiveField('bill')}
              compact
            />
            {needsGive(payType) ? (
              <AmountDisplay
                label="Customer Give"
                value={giveStr}
                active={activeField === 'give'}
                onSelect={() => setActiveField('give')}
                compact
              />
            ) : (
              <div className="counter-readonly counter-readonly--na">
                <span className="counter-readonly-label">Customer Give</span>
                <span className="counter-readonly-value">—</span>
              </div>
            )}
            {payType === 'split' ? (
              <>
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
              </>
            ) : paymentStep ? (
              <AmountDisplay
                label="Customer Paid"
                value={paidStr}
                active={activeField === 'paid'}
                onSelect={() => setActiveField('paid')}
                compact
              />
            ) : (
              <div
                className={`counter-readonly ${billStr ? 'counter-readonly--mirror' : ''}`}
              >
                <span className="counter-readonly-label">Customer Paid</span>
                <span className="counter-readonly-value">{customerPaidPreview}</span>
              </div>
            )}
            <div
              className={`counter-readonly counter-readonly--return ${showReturnLive && changeAmount > 0 && !needMore ? 'counter-readonly--ready' : ''} ${needMore || splitMismatch ? 'counter-readonly--warn' : ''} ${(activeField === 'give' || activeField === 'paid' || activeField === 'cashSplit' || activeField === 'bankSplit') && showReturnLive ? 'counter-readonly--live' : ''}`}
            >
              <span className="counter-readonly-label">Return</span>
              <span className="counter-readonly-value">{returnDisplay}</span>
            </div>
          </div>

          {payType === 'split' && (
            <div className="counter-split-total">
              <span>Paid Total</span>
              <strong>{splitTotal > 0 ? formatMoney(splitTotal) : '—'}</strong>
            </div>
          )}

          <div className="counter-customer">
            <label className="counter-customer-label" htmlFor="customer-name">
              Customer Name
            </label>
            <input
              id="customer-name"
              type="text"
              className="counter-customer-input"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Optional"
              autoComplete="name"
            />
          </div>

          <div className="counter-pay">
            <PayTypeChips value={payType} onChange={handlePayTypeChange} />
          </div>

          </div>

          <div className="counter-keyboard-wrap">
            <NumberKeyboard
              onPress={handleNumpad}
              hint={keyboardHint(activeField, payType)}
            />
          </div>

          <div className="counter-footer">
            <div className="counter-round">
            {showRoundChips ? (
              <RoundTypeChips
                label="Round down"
                options={billRoundOptions}
                onSelect={(amt) => {
                  setRoundOffAmount(amt)
                  if (payType === 'split') {
                    setPaidStr(String(amt))
                    if (cashSplitStr) applySplitCash(cashSplitStr, amt)
                    else if (bankSplitStr) applySplitBank(bankSplitStr, amt)
                    else openSplitMode()
                  } else if (paymentStep) setPaidStr(String(amt))
                  else if (needsGive(payType)) setActiveField('give')
                  else openPaymentStep()
                }}
                activeAmount={roundOffAmount ?? undefined}
                compact
              />
            ) : (
              <p className="counter-round-empty">Round down</p>
            )}
            </div>

          <div className="counter-actions counter-actions--3">
            <button type="button" className="btn btn-secondary" onClick={resetForm}>
              Clear
            </button>
            <button
              type="button"
              className={`btn btn-pending ${saved ? 'btn-saved' : ''}`}
              onClick={handleSavePending}
              disabled={!canSavePending}
            >
              {saved ? '✓ Saved' : 'Bill\nPending'}
            </button>
            <button
              type="button"
              className={`btn btn-primary ${saved ? 'btn-saved' : ''} ${payType === 'credit' ? 'btn-credit' : ''}`}
              onClick={handleSave}
              disabled={!isValid || saved}
            >
              {saveLabel}
            </button>
          </div>
          </div>
        </div>

        <PendingBillsPanel bills={pendingBills} onSelect={loadPendingBill} />
      </div>
    </div>
  )
}
