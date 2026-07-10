import { useEffect, useMemo, useRef, useState } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import PayTypeChips, { type PayType } from '../components/PayTypeChips'
import PendingBillsPanel from '../components/PendingBillsPanel'
import RoundTypeChips from '../components/RoundTypeChips'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import type { Sale } from '../types'
import { formatMoney, parseAmount } from '../utils/format'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { getBillRoundOptions } from '../utils/roundSuggestions'
import './Counter.css'

type ActiveField = 'bill' | 'give' | 'paid' | 'cashSplit' | 'bankSplit'

const COUNTER_PAY_TYPES: PayType[] = ['cash', 'bank', 'split']

function needsGive(payType: PayType): boolean {
  return payType === 'cash'
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

type SavedAction = 'collect' | 'pending' | null

export default function Counter() {
  const { recordSale, updatePendingSale, collectPendingSale, pendingBills, data } = useCash()
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
  const [savedAction, setSavedAction] = useState<SavedAction>(null)
  const [loadedPendingId, setLoadedPendingId] = useState<string | null>(null)
  const [nameSectionFocus, setNameSectionFocus] = useState(false)
  const [nameDropdownOpen, setNameDropdownOpen] = useState(false)
  const [highlightedNameIndex, setHighlightedNameIndex] = useState(-1)
  const [pendingSectionFocus, setPendingSectionFocus] = useState(false)
  const [highlightedPendingIndex, setHighlightedPendingIndex] = useState<number | null>(null)
  const customerNameInputRef = useRef<HTMLInputElement>(null)
  const pendingPanelRef = useRef<HTMLElement>(null)

  const customerNameSuggestions = useMemo(() => {
    const seen = new Map<string, string>()
    for (let i = data.sales.length - 1; i >= 0; i--) {
      const raw = data.sales[i]?.customerName?.trim()
      if (!raw) continue
      const key = raw.toLowerCase()
      if (!seen.has(key)) seen.set(key, raw)
    }
    return Array.from(seen.values())
  }, [data.sales])

  const filteredNameSuggestions = useMemo(() => {
    const query = customerName.trim().toLowerCase()
    if (!query) return customerNameSuggestions.slice(0, 8)
    return customerNameSuggestions
      .filter((name) => {
        const lower = name.toLowerCase()
        return lower.includes(query) && lower !== query
      })
      .slice(0, 8)
  }, [customerName, customerNameSuggestions])

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

  const splitShortfall =
    payType === 'split' && splitTotal > 0 && splitPaidTotal > 0 && splitPaidTotal < splitTotal
      ? splitTotal - splitPaidTotal
      : 0

  const splitExcess =
    payType === 'split' && splitTotal > 0 && splitPaidTotal > splitTotal
      ? splitPaidTotal - splitTotal
      : 0

  const changeAmount =
    payType === 'bank' || payType === 'split'
      ? 0
      : Math.max(0, giveAmount - paidForReturn)

  const needMore =
    payType === 'cash' &&
    giveAmount > 0 &&
    paidForReturn > 0 &&
    giveAmount < paidForReturn

  const shortfallAmount = needMore ? paidForReturn - giveAmount : 0

  const showReturnLive =
    payType === 'split'
      ? splitTotal > 0 && splitPaidTotal > 0
      : payType === 'cash' && giveAmount > 0 && paidForReturn > 0

  const returnDisplay = (() => {
    if (payType === 'bank') return '—'
    if (payType === 'split') {
      if (splitTotal <= 0 || splitPaidTotal <= 0) return '—'
      if (splitShortfall > 0) return `+${formatMoney(splitShortfall)}`
      if (splitExcess > 0) return formatMoney(splitExcess)
      return '—'
    }
    if (needMore) return `+${formatMoney(shortfallAmount)}`
    if (showReturnLive && changeAmount > 0) return formatMoney(changeAmount)
    return '—'
  })()

  const isValid =
    billAmount > 0 &&
    (payType === 'bank'
      ? paymentStep && paidAmount > 0
      : payType === 'cash'
        ? paymentStep && paidAmount > 0 && giveAmount >= paidAmount
        : payType === 'split'
          ? splitTotal > 0 &&
            splitPaidTotal === splitTotal &&
            cashSplitAmount >= 0 &&
            bankSplitAmount >= 0 &&
            (cashSplitAmount > 0 || bankSplitAmount > 0)
          : false)

  const canSavePending = dueAmount > 0 && savedAction === null
  const isSaving = savedAction !== null

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
    if (billAmount <= 0) {
      setPaymentStep(false)
      setActiveField('bill')
      return
    }

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
      if (payType === 'split') {
        if (billAmount > 0) openPaymentStep()
        return
      }
      if (needsGive(payType)) setActiveField('give')
      else openPaymentStep()
      return
    }
    if (activeField === 'give') {
      openPaymentStep()
      return
    }
    if (activeField === 'paid') {
      if (needsGive(payType)) setActiveField('give')
      else setActiveField('bill')
      return
    }
    if (activeField === 'cashSplit') {
      setActiveField('bankSplit')
      return
    }
    if (activeField === 'bankSplit') {
      setActiveField('cashSplit')
      return
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

  function cyclePayType() {
    const idx = COUNTER_PAY_TYPES.indexOf(payType)
    const next = COUNTER_PAY_TYPES[(idx + 1) % COUNTER_PAY_TYPES.length]
    handlePayTypeChange(next)
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

  const numpadHandlerRef = useRef(handleNumpad)
  numpadHandlerRef.current = handleNumpad
  useNumpadKeyboard(
    (action) => numpadHandlerRef.current(action),
    !isSaving && !pendingSectionFocus,
  )

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
    setSavedAction(null)
    setLoadedPendingId(null)
  }

  function buildPendingPayload() {
    const name = customerName.trim() || undefined
    const due = payType === 'split' ? splitTotal : dueAmount
    const base = {
      billAmount: due,
      originalBillAmount: billAmount,
      customerName: name,
      payType,
    }

    if (payType === 'split') {
      return {
        ...base,
        cashAmount: cashSplitAmount,
        bankAmount: bankSplitAmount,
      }
    }

    return base
  }

  function loadPendingBill(bill: Sale) {
    const due = bill.billAmount
    const original = bill.originalBillAmount ?? bill.billAmount
    const type = bill.payType ?? 'cash'

    setLoadedPendingId(bill.id)
    setBillStr(String(original))
    setGiveStr('')
    setPaidStr(String(due))
    setRoundOffAmount(original !== due ? due : null)
    setCustomerName(bill.customerName ?? '')
    setPayType(type)
    setPaymentStep(true)
    setSavedAction(null)

    if (type === 'split') {
      setCashSplitStr(bill.cashAmount ? formatSplitPart(bill.cashAmount) : '')
      setBankSplitStr(bill.bankAmount ? formatSplitPart(bill.bankAmount) : '')
      setActiveField('cashSplit')
      return
    }

    setCashSplitStr('')
    setBankSplitStr('')

    if (type === 'bank') {
      setActiveField('paid')
      return
    }

    setActiveField('give')
  }

  function selectPendingBill(bill: Sale) {
    loadPendingBill(bill)
    setPendingSectionFocus(false)
    setHighlightedPendingIndex(null)
  }

  function clearPendingSection() {
    setPendingSectionFocus(false)
    setHighlightedPendingIndex(null)
  }

  function handleSavePending() {
    if (!canSavePending) return

    const pendingPayload = buildPendingPayload()

    if (loadedPendingId) {
      updatePendingSale(loadedPendingId, pendingPayload)
    } else {
      recordSale({
        ...pendingPayload,
        paidAmount: 0,
        changeAmount: 0,
        status: 'pending',
      })
    }
    setSavedAction('pending')
    setTimeout(resetForm, 900)
  }

  function handleSave() {
    if (!isValid) return

    const cashAmount =
      payType === 'cash' ? paidAmount : payType === 'split' ? cashSplitAmount : 0
    const bankAmount =
      payType === 'bank' ? paidAmount : payType === 'split' ? bankSplitAmount : 0
    const name = customerName.trim() || undefined

    const salePayload = {
      billAmount: payType === 'split' ? splitTotal : paidAmount,
      originalBillAmount: billAmount,
      paidAmount: payType === 'bank' ? paidAmount : payType === 'split' ? cashSplitAmount : giveAmount,
      changeAmount: payType === 'split' ? 0 : changeAmount,
      payType,
      cashAmount,
      bankAmount,
      customerName: name,
    }

    if (loadedPendingId) {
      collectPendingSale(loadedPendingId, salePayload)
    } else {
      recordSale(salePayload)
    }
    setSavedAction('collect')
    setTimeout(resetForm, 900)
  }

  const saveLabel = savedAction === 'collect' ? '✓ Saved' : 'Save &\nCollect'

  function jumpToAmountField() {
    if (payType === 'split') {
      if (billAmount > 0) {
        setPaymentStep(true)
        if (!paidStr && dueAmount > 0) setPaidStr(String(dueAmount))
        setActiveField('cashSplit')
      } else {
        setActiveField('bill')
      }
      return
    }
    if (payType === 'cash') {
      if (billAmount > 0) {
        setPaymentStep(true)
        if (!paidStr && dueAmount > 0) setPaidStr(String(dueAmount))
        setActiveField('give')
      } else {
        setActiveField('bill')
      }
      return
    }
    if (billAmount > 0) openPaymentStep()
    else setActiveField('bill')
  }

  function focusNameSection() {
    setNameSectionFocus(true)
    clearPendingSection()
    customerNameInputRef.current?.focus()
    customerNameInputRef.current?.select()
  }

  function focusPendingSection() {
    setPendingSectionFocus(true)
    setNameSectionFocus(false)
    customerNameInputRef.current?.blur()

    const panel = pendingPanelRef.current
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      panel.focus()
    }

    if (pendingBills.length === 0) {
      setHighlightedPendingIndex(null)
      return
    }

    if (loadedPendingId) {
      const idx = pendingBills.findIndex((bill) => bill.id === loadedPendingId)
      setHighlightedPendingIndex(idx >= 0 ? idx : 0)
      return
    }

    setHighlightedPendingIndex(0)
  }

  function focusAmountSection() {
    const fromOtherSection =
      nameSectionFocus ||
      pendingSectionFocus ||
      document.activeElement === customerNameInputRef.current

    setNameSectionFocus(false)
    clearPendingSection()
    customerNameInputRef.current?.blur()

    if (fromOtherSection) {
      jumpToAmountField()
    } else {
      handleEnter()
    }
  }

  const focusNameRef = useRef(focusNameSection)
  const focusPendingRef = useRef(focusPendingSection)
  const focusAmountRef = useRef(focusAmountSection)
  focusNameRef.current = focusNameSection
  focusPendingRef.current = focusPendingSection
  focusAmountRef.current = focusAmountSection

  const saveHandlerRef = useRef(handleSave)
  const savePendingHandlerRef = useRef(handleSavePending)
  const cyclePayTypeRef = useRef(cyclePayType)
  const pendingBillsRef = useRef(pendingBills)
  const highlightedPendingIndexRef = useRef(highlightedPendingIndex)
  const selectPendingBillRef = useRef(selectPendingBill)
  saveHandlerRef.current = handleSave
  savePendingHandlerRef.current = handleSavePending
  cyclePayTypeRef.current = cyclePayType
  pendingBillsRef.current = pendingBills
  highlightedPendingIndexRef.current = highlightedPendingIndex
  selectPendingBillRef.current = selectPendingBill

  useEffect(() => {
    if (!pendingSectionFocus) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return

      const target = e.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return
        }
      }

      const bills = pendingBillsRef.current
      if (bills.length === 0) return

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedPendingIndex((current) => {
          const idx = current ?? 0
          if (e.key === 'ArrowDown') return (idx + 1) % bills.length
          return (idx - 1 + bills.length) % bills.length
        })
        return
      }

      if (e.key === 'Enter') {
        const idx = highlightedPendingIndexRef.current
        if (idx == null || idx < 0 || idx >= bills.length) return
        e.preventDefault()
        selectPendingBillRef.current(bills[idx])
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pendingSectionFocus])

  useEffect(() => {
    if (!pendingSectionFocus || highlightedPendingIndex == null) return

    const panel = pendingPanelRef.current
    const billId = pendingBills[highlightedPendingIndex]?.id
    if (!panel || !billId) return

    const item = panel.querySelector(`[data-bill-id="${billId}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [pendingSectionFocus, highlightedPendingIndex, pendingBills])

  useEffect(() => {
    if (isSaving) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey) return

      if (e.code === 'KeyS') {
        if (!isValid) return
        e.preventDefault()
        saveHandlerRef.current()
        return
      }

      if (e.code === 'KeyB') {
        if (!canSavePending) return
        e.preventDefault()
        savePendingHandlerRef.current()
        return
      }

      if (e.code === 'KeyA') {
        e.preventDefault()
        cyclePayTypeRef.current()
        return
      }

      if (e.code === 'KeyN') {
        e.preventDefault()
        focusNameRef.current()
        return
      }

      if (e.code === 'KeyW') {
        e.preventDefault()
        focusPendingRef.current()
        return
      }

      if (e.code === 'KeyE') {
        e.preventDefault()
        focusAmountRef.current()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isSaving, isValid, canSavePending])

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
              onSelect={() => {
                setNameSectionFocus(false)
                clearPendingSection()
                setActiveField('bill')
              }}
              compact
              shortcutHint="Alt+E"
            />
            {payType === 'split' ? (
              <div className="counter-readonly counter-readonly--mirror counter-readonly--disabled">
                <span className="counter-readonly-label">Customer Give</span>
                <span className="counter-readonly-value">
                  {cashSplitAmount > 0 ? formatMoney(cashSplitAmount) : '—'}
                </span>
              </div>
            ) : needsGive(payType) ? (
              <AmountDisplay
                label="Customer Give"
                value={giveStr}
                active={activeField === 'give'}
                onSelect={() => {
                  setNameSectionFocus(false)
                  clearPendingSection()
                  setActiveField('give')
                }}
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
              className={`counter-readonly counter-readonly--return ${showReturnLive && !needMore && !splitShortfall && (changeAmount > 0 || (payType === 'split' && splitPaidTotal === splitTotal)) ? 'counter-readonly--ready' : ''} ${needMore || splitShortfall ? 'counter-readonly--warn' : ''} ${(activeField === 'give' || activeField === 'paid' || activeField === 'cashSplit' || activeField === 'bankSplit') && showReturnLive ? 'counter-readonly--live' : ''}`}
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

          <div className={`counter-customer ${nameSectionFocus ? 'counter-customer--focused' : ''}`}>
            <label className="counter-customer-label" htmlFor="customer-name">
              Customer Name <span className="counter-shortcut-hint">Alt+N</span>
            </label>
            <input
              ref={customerNameInputRef}
              id="customer-name"
              type="text"
              className="counter-customer-input"
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value)
                setNameDropdownOpen(true)
                setHighlightedNameIndex(-1)
              }}
              onFocus={() => {
                setNameSectionFocus(true)
                setNameDropdownOpen(true)
                setHighlightedNameIndex(-1)
                clearPendingSection()
              }}
              onBlur={() => {
                setNameSectionFocus(false)
                setNameDropdownOpen(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setNameDropdownOpen(false)
                  setHighlightedNameIndex(-1)
                  return
                }
                if (!nameDropdownOpen || filteredNameSuggestions.length === 0) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHighlightedNameIndex((prev) => (prev + 1) % filteredNameSuggestions.length)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHighlightedNameIndex((prev) =>
                    prev <= 0 ? filteredNameSuggestions.length - 1 : prev - 1,
                  )
                } else if (e.key === 'Enter' && highlightedNameIndex >= 0) {
                  e.preventDefault()
                  setCustomerName(filteredNameSuggestions[highlightedNameIndex])
                  setNameDropdownOpen(false)
                  setHighlightedNameIndex(-1)
                }
              }}
              placeholder="Optional"
              autoComplete="off"
            />
            {nameDropdownOpen && filteredNameSuggestions.length > 0 && (
              <ul className="counter-customer-suggestions" role="listbox">
                {filteredNameSuggestions.map((name, index) => (
                  <li key={name}>
                    <button
                      type="button"
                      className={`counter-customer-suggestion ${index === highlightedNameIndex ? 'counter-customer-suggestion--active' : ''}`}
                      onMouseEnter={() => setHighlightedNameIndex(index)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setCustomerName(name)
                        setNameDropdownOpen(false)
                        setHighlightedNameIndex(-1)
                      }}
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="counter-pay">
            <PayTypeChips
              value={payType}
              onChange={handlePayTypeChange}
              options={COUNTER_PAY_TYPES}
              shortcutHint="Alt+A"
            />
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
              className={`btn btn-pending btn-with-shortcut ${savedAction === 'pending' ? 'btn-saved' : ''}`}
              onClick={handleSavePending}
              disabled={!canSavePending}
            >
              <span className="btn-text">
                {savedAction === 'pending' ? '✓ Saved' : 'Bill\nPending'}
              </span>
              {savedAction !== 'pending' ? (
                <span className="btn-shortcut">Alt+B</span>
              ) : null}
            </button>
            <button
              type="button"
              className={`btn btn-primary btn-with-shortcut ${savedAction === 'collect' ? 'btn-saved' : ''}`}
              onClick={handleSave}
              disabled={!isValid || isSaving}
            >
              <span className="btn-text">{saveLabel}</span>
              {savedAction !== 'collect' ? (
                <span className="btn-shortcut">Alt+S</span>
              ) : null}
            </button>
          </div>
          </div>
        </div>

        <PendingBillsPanel
          bills={pendingBills}
          onSelect={selectPendingBill}
          focused={pendingSectionFocus}
          highlightedBillId={
            highlightedPendingIndex != null
              ? pendingBills[highlightedPendingIndex]?.id
              : null
          }
          panelRef={pendingPanelRef}
          shortcutHint="Alt+W"
        />
      </div>
    </div>
  )
}
