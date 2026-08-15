import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import PayTypeChips from '../components/PayTypeChips'
import { PageBackButton, PageCorners } from '../components/PageCorners'
import ExpenseHistoryPanel from '../components/ExpenseHistoryPanel'
import { useAppPageBack } from '../hooks/useAppPageBack'
import { usePageEscape } from '../hooks/usePageEscape'
import type { ExpensePayType } from '../types'
import { formatMoney, parseAmount } from '../utils/format'
import {
  buildExpenseAmountPickerOptions,
  buildExpenseNamePickerOptions,
  searchExpenseNamePickerOptions,
  type ExpenseAmountPickerOption,
  type ExpenseNamePickerOption,
} from '../utils/normalExpenseHistory'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { useRouteNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import { useIsActiveRoute } from '../hooks/useIsActiveRoute'
import {
  currentSalaryMonth,
  findStaffByName,
  formatSalaryMonthLabel,
  getStaffMonthSummary,
  listSalaryMonthPickerOptions,
  salaryMonthChoiceHint,
  shouldPromptSalaryMonthChoice,
  suggestDefaultSalaryMonth,
} from '../utils/staffLedger'
import './Expenses.css'

type ExpenseField = 'name' | 'amount' | 'cashSplit' | 'bankSplit' | 'pay'

function nextExpenseField(current: ExpenseField, splitMode: boolean): ExpenseField {
  const order: ExpenseField[] = splitMode
    ? ['name', 'amount', 'cashSplit', 'bankSplit', 'pay']
    : ['name', 'amount', 'pay']
  const idx = order.indexOf(current)
  if (idx < 0) return order[0]
  return order[(idx + 1) % order.length]
}

function formatSplitPart(amount: number): string {
  if (amount <= 0) return ''
  return Number.isInteger(amount) ? String(amount) : String(amount)
}

export default function Expenses() {
  const routeActive = useIsActiveRoute('/expenses')
  const goBack = useAppPageBack('/', { route: '/expenses' })
  const { recordExpense, data } = useCash()
  const [amountStr, setAmountStr] = useState('')
  const [cashSplitStr, setCashSplitStr] = useState('')
  const [bankSplitStr, setBankSplitStr] = useState('')
  const [name, setName] = useState('')
  const [payType, setPayType] = useState<ExpensePayType>('cash')
  const [activeField, setActiveField] = useState<ExpenseField>('name')
  const [saved, setSaved] = useState(false)
  const [nameDropdownOpen, setNameDropdownOpen] = useState(false)
  const [highlightedNameIndex, setHighlightedNameIndex] = useState(-1)
  const [amountDropdownOpen, setAmountDropdownOpen] = useState(false)
  const [highlightedAmountIndex, setHighlightedAmountIndex] = useState(-1)
  const [linkToSalary, setLinkToSalary] = useState(true)
  const [staffSalaryMonth, setStaffSalaryMonth] = useState(currentSalaryMonth())
  const salaryMonthOptions = useMemo(() => listSalaryMonthPickerOptions(), [])
  const [showExpenseHistory, setShowExpenseHistory] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const paySectionRef = useRef<HTMLDivElement>(null)
  const activeNameSuggestionRef = useRef<HTMLButtonElement>(null)
  const nameSuggestionsListRef = useRef<HTMLUListElement>(null)
  const activeAmountSuggestionRef = useRef<HTMLButtonElement>(null)
  const amountSuggestionsListRef = useRef<HTMLUListElement>(null)
  const nameInputPointerRef = useRef(false)
  const staffPanelRef = useRef<HTMLDivElement>(null)

  const splitMode = payType === 'split'

  const recentExpenseOptions = useMemo(() => buildExpenseNamePickerOptions(data, 12), [data.expenses, data.staff])

  const visibleNameSuggestions = useMemo((): ExpenseNamePickerOption[] => {
    const query = name.trim()
    if (!query) return recentExpenseOptions
    return searchExpenseNamePickerOptions(data, query, 12)
  }, [name, recentExpenseOptions, data])

  const matchedStaff = useMemo(() => findStaffByName(data, name), [data, name])

  const amountSuggestions = useMemo(
    () =>
      buildExpenseAmountPickerOptions(data, {
        staffId: matchedStaff?.id,
        staffSalaryMonth,
        linkToSalary,
      }),
    [data, matchedStaff?.id, staffSalaryMonth, linkToSalary],
  )

  const staffSalarySummary = useMemo(() => {
    if (!matchedStaff || !linkToSalary) return null
    return getStaffMonthSummary(data, matchedStaff.id, staffSalaryMonth)
  }, [data, matchedStaff, linkToSalary, staffSalaryMonth])

  const staffRemainingAmount =
    staffSalarySummary && staffSalarySummary.remaining > 0 && !staffSalarySummary.canApplyToNextMonth
      ? staffSalarySummary.remaining
      : undefined

  const staffRemainingCaption = staffRemainingAmount
    ? `${formatSalaryMonthLabel(staffSalaryMonth)} remaining`
    : undefined
  const showStaffOptions = Boolean(matchedStaff)
  const salaryMonthHint = useMemo(
    () => (showStaffOptions && shouldPromptSalaryMonthChoice() ? salaryMonthChoiceHint() : ''),
    [showStaffOptions],
  )

  useEffect(() => {
    if (!matchedStaff) return
    setLinkToSalary(true)
    setStaffSalaryMonth(suggestDefaultSalaryMonth())
  }, [matchedStaff?.id])

  useEffect(() => {
    if (!matchedStaff) return
    staffPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [matchedStaff?.id, linkToSalary])

  const amount = parseAmount(amountStr)
  const cashSplitAmount = parseAmount(cashSplitStr)
  const bankSplitAmount = parseAmount(bankSplitStr)
  const splitPaidTotal = cashSplitAmount + bankSplitAmount
  const splitShortfall = splitMode && amount > 0 ? Math.max(0, amount - splitPaidTotal) : 0
  const splitExcess = splitMode && amount > 0 ? Math.max(0, splitPaidTotal - amount) : 0

  const isValid = splitMode
    ? amount > 0 &&
      name.trim().length > 0 &&
      splitPaidTotal === amount &&
      (cashSplitAmount > 0 || bankSplitAmount > 0)
    : amount > 0 && name.trim().length > 0

  function applySplitCash(nextCashStr: string) {
    setCashSplitStr(nextCashStr)
    const total = parseAmount(amountStr)
    if (total <= 0) return
    const cash = parseAmount(nextCashStr)
    setBankSplitStr(formatSplitPart(Math.max(0, total - cash)))
  }

  function applySplitBank(nextBankStr: string) {
    setBankSplitStr(nextBankStr)
    const total = parseAmount(amountStr)
    if (total <= 0) return
    const bank = parseAmount(nextBankStr)
    setCashSplitStr(formatSplitPart(Math.max(0, total - bank)))
  }

  function syncSplitFromTotal(nextAmountStr: string) {
    setAmountStr(nextAmountStr)
    const total = parseAmount(nextAmountStr)
    if (total <= 0 || !splitMode) return
    if (cashSplitStr) {
      applySplitCash(cashSplitStr)
    } else if (bankSplitStr) {
      applySplitBank(bankSplitStr)
    }
  }

  function resetStaffFields() {
    setLinkToSalary(true)
    setStaffSalaryMonth(suggestDefaultSalaryMonth())
  }

  function applyNameSuggestion(option: ExpenseNamePickerOption) {
    setName(option.name)
    if (option.staffSalaryMonth) {
      setLinkToSalary(true)
      setStaffSalaryMonth(option.staffSalaryMonth)
    }
    setNameDropdownOpen(false)
    setHighlightedNameIndex(-1)
  }

  function applyAmountSuggestion(option: ExpenseAmountPickerOption) {
    syncSplitFromTotal(String(option.amount))
    setAmountDropdownOpen(false)
    setHighlightedAmountIndex(-1)
  }

  function openAmountDropdown() {
    setAmountDropdownOpen(true)
    setHighlightedAmountIndex(-1)
  }

  function handleSave() {
    if (!isValid || saved) return

    if (matchedStaff && linkToSalary) {
      recordExpense({
        amount,
        name: name.trim(),
        payType,
        cashAmount: splitMode ? cashSplitAmount : undefined,
        bankAmount: splitMode ? bankSplitAmount : undefined,
        kind: 'expense',
        staffId: matchedStaff.id,
        staffSalaryMonth,
        staffSalaryLink: true,
      })
    } else if (matchedStaff && !linkToSalary) {
      recordExpense({
        amount,
        name: name.trim(),
        payType,
        cashAmount: splitMode ? cashSplitAmount : undefined,
        bankAmount: splitMode ? bankSplitAmount : undefined,
        kind: 'expense',
        staffSalaryLink: false,
      })
    } else {
      recordExpense({
        amount,
        name: name.trim(),
        payType,
        cashAmount: splitMode ? cashSplitAmount : undefined,
        bankAmount: splitMode ? bankSplitAmount : undefined,
        kind: 'expense',
      })
    }

    setSaved(true)
    setTimeout(() => {
      setAmountStr('')
      setCashSplitStr('')
      setBankSplitStr('')
      setName('')
      setPayType('cash')
      setActiveField('name')
      resetStaffFields()
      setSaved(false)
      setNameDropdownOpen(false)
      setHighlightedNameIndex(-1)
      setAmountDropdownOpen(false)
      setHighlightedAmountIndex(-1)
      nameInputPointerRef.current = false
      nameInputRef.current?.focus()
    }, 900)
  }

  function openNameDropdown() {
    setNameDropdownOpen(true)
    setHighlightedNameIndex(-1)
  }

  function openNameDropdownFromPointer() {
    nameInputPointerRef.current = true
    openNameDropdown()
  }

  function focusField(field: ExpenseField) {
    setActiveField(field)
    if (field === 'name') {
      nameInputRef.current?.focus()
      setAmountDropdownOpen(false)
      return
    }
    nameInputRef.current?.blur()
    setNameDropdownOpen(false)
    if (field === 'amount') {
      openAmountDropdown()
      return
    }
    setAmountDropdownOpen(false)
  }

  useEffect(() => {
    if (activeField === 'pay') paySectionRef.current?.focus()
  }, [activeField])

  useEffect(() => {
    setActiveField('name')
    nameInputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (highlightedNameIndex < 0) return
    const item = activeNameSuggestionRef.current
    const list = nameSuggestionsListRef.current
    if (!item || !list) return
    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    if (itemTop < list.scrollTop) {
      list.scrollTop = itemTop
    } else if (itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemBottom - list.clientHeight
    }
  }, [highlightedNameIndex])

  useEffect(() => {
    if (highlightedAmountIndex < 0) return
    const item = activeAmountSuggestionRef.current
    const list = amountSuggestionsListRef.current
    if (!item || !list) return
    const itemTop = item.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    if (itemTop < list.scrollTop) {
      list.scrollTop = itemTop
    } else if (itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemBottom - list.clientHeight
    }
  }, [highlightedAmountIndex])

  useEffect(() => {
    if (!routeActive || activeField !== 'amount' || !amountDropdownOpen || amountSuggestions.length === 0) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setAmountDropdownOpen(false)
        setHighlightedAmountIndex(-1)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedAmountIndex((prev) =>
          prev < 0 ? 0 : (prev + 1) % amountSuggestions.length,
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedAmountIndex((prev) =>
          prev <= 0 ? amountSuggestions.length - 1 : prev - 1,
        )
        return
      }
      if (e.key === 'Enter' && highlightedAmountIndex >= 0) {
        e.preventDefault()
        applyAmountSuggestion(amountSuggestions[highlightedAmountIndex])
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeField, amountDropdownOpen, amountSuggestions, highlightedAmountIndex, routeActive])

  function handleEnter() {
    focusField(nextExpenseField(activeField, splitMode))
  }

  function handleNumpad(action: NumpadAction) {
    if (action === 'enter') {
      handleEnter()
      return
    }

    if (activeField === 'amount') {
      setAmountDropdownOpen(false)
      syncSplitFromTotal(applyNumpadAction(amountStr, action))
      return
    }
    if (activeField === 'cashSplit') {
      applySplitCash(applyNumpadAction(cashSplitStr, action))
      return
    }
    if (activeField === 'bankSplit') {
      applySplitBank(applyNumpadAction(bankSplitStr, action))
    }
  }

  const numpadHandlerRef = useRef(handleNumpad)
  numpadHandlerRef.current = handleNumpad
  const stableNumpadPress = useCallback((action: NumpadAction) => {
    numpadHandlerRef.current(action)
  }, [])
  useRouteNumpadKeyboard('/expenses', stableNumpadPress, !saved)

  const saveHandlerRef = useRef(handleSave)
  saveHandlerRef.current = handleSave

  useEffect(() => {
    if (!routeActive || saved) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey) return

      if (e.code === 'KeyS') {
        if (!isValid) return
        e.preventDefault()
        saveHandlerRef.current()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saved, isValid, routeActive])

  function handleClear() {
    setAmountStr('')
    setCashSplitStr('')
    setBankSplitStr('')
    setName('')
    setPayType('cash')
    setActiveField('name')
    resetStaffFields()
    setSaved(false)
    setAmountDropdownOpen(false)
    setHighlightedAmountIndex(-1)
  }

  function handlePayTypeChange(type: ExpensePayType) {
    setPayType(type)
    if (type === 'split') {
      setCashSplitStr('')
      setBankSplitStr('')
      if (amount > 0) setActiveField('cashSplit')
      else setActiveField('amount')
      return
    }
    setCashSplitStr('')
    setBankSplitStr('')
    focusField('pay')
  }

  function handlePageBack() {
    if (showExpenseHistory) {
      setShowExpenseHistory(false)
      return
    }
    goBack()
  }

  usePageEscape(handlePageBack, routeActive && !showExpenseHistory)

  return (
    <div className="expenses-page page-shell">
      <PageCorners
        left={<PageBackButton onClick={handlePageBack} ariaLabel="Back" />}
        right={
          <button
            type="button"
            className="expenses-corner-btn"
            onClick={() => setShowExpenseHistory(true)}
            aria-label="Expense history"
          >
            <span className="expenses-corner-btn-icon" aria-hidden="true">
              📋
            </span>
            <span>History</span>
          </button>
        }
      />
      <header className="expenses-page-head page-head--corners">
        <h1 className="expenses-page-title">Expenses</h1>
        <p className="expenses-page-sub">Record expenses · History includes purchases</p>
      </header>

      <div className="expenses-form">
      <div className={`expenses-top ${splitMode ? 'expenses-top--split' : ''}`}>
        <label
          className="expense-name"
          onPointerDown={(e) => {
            if (e.pointerType === 'mouse' || e.pointerType === 'pen' || e.pointerType === 'touch') {
              openNameDropdownFromPointer()
            }
          }}
        >
          <span className="expense-name-label">Expense Name</span>
          <input
            ref={nameInputRef}
            type="text"
            className={`expense-name-input ${activeField === 'name' ? 'expense-name-input--active' : ''}`}
            value={name}
            onChange={(e) => {
              const next = e.target.value
              setName(next)
              if (next.trim()) {
                setNameDropdownOpen(true)
                setHighlightedNameIndex(-1)
                return
              }
              openNameDropdown()
            }}
            onFocus={() => {
              setActiveField('name')
              openNameDropdown()
            }}
            onBlur={() => {
              setNameDropdownOpen(false)
              nameInputPointerRef.current = false
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setNameDropdownOpen(false)
                setHighlightedNameIndex(-1)
                return
              }
              if (nameDropdownOpen && visibleNameSuggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHighlightedNameIndex((prev) =>
                    prev < 0 ? 0 : (prev + 1) % visibleNameSuggestions.length,
                  )
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHighlightedNameIndex((prev) =>
                    prev <= 0 ? visibleNameSuggestions.length - 1 : prev - 1,
                  )
                  return
                }
                if (e.key === 'Enter' && highlightedNameIndex >= 0) {
                  e.preventDefault()
                  applyNameSuggestion(visibleNameSuggestions[highlightedNameIndex])
                  return
                }
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                setNameDropdownOpen(false)
                handleEnter()
              }
            }}
            placeholder="e.g. Supplies, Rent"
            autoComplete="off"
          />
          {nameDropdownOpen && visibleNameSuggestions.length > 0 && (
            <ul
              ref={nameSuggestionsListRef}
              className="expense-name-suggestions"
              role="listbox"
              onMouseDown={(e) => e.preventDefault()}
              onWheel={(e) => e.preventDefault()}
              onTouchMove={(e) => e.preventDefault()}
            >
              {visibleNameSuggestions.map((item, index) => (
                <li key={item.key}>
                  <button
                    type="button"
                    ref={index === highlightedNameIndex ? activeNameSuggestionRef : null}
                    className={`expense-name-suggestion ${index === highlightedNameIndex ? 'expense-name-suggestion--active' : ''}`}
                    role="option"
                    aria-selected={index === highlightedNameIndex}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      applyNameSuggestion(item)
                    }}
                  >
                    <span className="expense-name-suggestion-row">
                      <span className="expense-name-suggestion-main">
                        <span className="expense-name-suggestion-text">{item.name}</span>
                        {item.isStaff ? (
                          <span className="expense-name-suggestion-tag expense-name-suggestion-tag--staff">
                            Staff
                          </span>
                        ) : null}
                        {item.timeLabel ? (
                          <span className="expense-name-suggestion-time">{item.timeLabel}</span>
                        ) : null}
                      </span>
                      {item.metaLabel ? (
                        <span className="expense-name-suggestion-meta">{item.metaLabel}</span>
                      ) : item.payLabel ? (
                        <span className="expense-name-suggestion-meta">{item.payLabel}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>

        <div
          className="expense-amount"
          onPointerDown={(e) => {
            if (e.pointerType === 'mouse' || e.pointerType === 'pen' || e.pointerType === 'touch') {
              focusField('amount')
            }
          }}
        >
          <AmountDisplay
            label={splitMode ? 'Total Amount' : 'Expense Amount'}
            value={amountStr}
            active={activeField === 'amount'}
            onSelect={() => focusField('amount')}
            remainingAmount={staffRemainingAmount}
            remainingCaption={staffRemainingCaption}
            compact
          />
          {amountDropdownOpen && amountSuggestions.length > 0 ? (
            <ul
              ref={amountSuggestionsListRef}
              className="expense-name-suggestions expense-amount-suggestions"
              role="listbox"
              onMouseDown={(e) => e.preventDefault()}
              onWheel={(e) => e.preventDefault()}
              onTouchMove={(e) => e.preventDefault()}
            >
              {amountSuggestions.map((item, index) => (
                <li key={item.key}>
                  <button
                    type="button"
                    ref={index === highlightedAmountIndex ? activeAmountSuggestionRef : null}
                    className={`expense-name-suggestion ${index === highlightedAmountIndex ? 'expense-name-suggestion--active' : ''}`}
                    role="option"
                    aria-selected={index === highlightedAmountIndex}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      applyAmountSuggestion(item)
                    }}
                  >
                    <span className="expense-name-suggestion-row">
                      <span className="expense-name-suggestion-main">
                        <span className="expense-name-suggestion-text">{item.label}</span>
                      </span>
                      {item.metaLabel ? (
                        <span className="expense-name-suggestion-meta">{item.metaLabel}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {splitMode ? (
          <>
            <AmountDisplay
              label="Cash"
              value={cashSplitStr}
              active={activeField === 'cashSplit'}
              onSelect={() => focusField('cashSplit')}
              compact
            />
            <AmountDisplay
              label="Bank"
              value={bankSplitStr}
              active={activeField === 'bankSplit'}
              onSelect={() => focusField('bankSplit')}
              compact
            />
          </>
        ) : null}
      </div>

      {showStaffOptions && matchedStaff ? (
        <div ref={staffPanelRef} className="expenses-staff expenses-staff--active">
          <p className="expenses-staff-heading">
            Staff salary · <strong>{matchedStaff.name}</strong>
          </p>
          {staffRemainingAmount ? (
            <p className="expenses-staff-remaining">
              Remaining <strong>{formatMoney(staffRemainingAmount)}</strong> for{' '}
              {formatSalaryMonthLabel(staffSalaryMonth)}
            </p>
          ) : null}
          {salaryMonthHint ? <p className="expenses-staff-prompt">{salaryMonthHint}</p> : null}

          <label className="expenses-staff-toggle expenses-staff-toggle--inline">
            <input
              type="checkbox"
              checked={linkToSalary}
              onChange={(e) => setLinkToSalary(e.target.checked)}
            />
            <span>Link to salary balance</span>
          </label>

          {linkToSalary ? (
            <label className="expenses-staff-field">
              <span>Credit to salary month</span>
              <select
                value={staffSalaryMonth}
                onChange={(e) => setStaffSalaryMonth(e.target.value || suggestDefaultSalaryMonth())}
              >
                {salaryMonthOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>Payment will count toward {formatSalaryMonthLabel(staffSalaryMonth)}</small>
            </label>
          ) : (
            <p className="expenses-staff-note">Recorded as a general expense only — salary balance will not change.</p>
          )}
        </div>
      ) : null}

      {splitMode && amount > 0 ? (
        <div
          className={`expenses-split-total ${splitShortfall > 0 || splitExcess > 0 ? 'expenses-split-total--warn' : ''}`}
        >
          <span>Paid Total</span>
          <strong>
            {formatMoney(splitPaidTotal)} / {formatMoney(amount)}
            {splitShortfall > 0 ? ` · need ${formatMoney(splitShortfall)}` : null}
            {splitExcess > 0 ? ` · over ${formatMoney(splitExcess)}` : null}
          </strong>
        </div>
      ) : null}

      <div
        ref={paySectionRef}
        className={`expenses-pay ${activeField === 'pay' ? 'expenses-pay--active' : ''}`}
        onClick={() => focusField('pay')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            handleEnter()
          }
        }}
        role="group"
        tabIndex={activeField === 'pay' ? 0 : -1}
      >
        <PayTypeChips
          value={payType}
          onChange={(type) => handlePayTypeChange(type as ExpensePayType)}
          options={['cash', 'bank', 'split']}
          label="Paid From"
        />
      </div>

      </div>

      <div className="expenses-keyboard">
        <NumberKeyboard onPress={stableNumpadPress} />
      </div>

      <div className="expenses-actions">
        <button type="button" className="btn btn-secondary" onClick={handleClear}>
          Clear
        </button>
        <button
          type="button"
          className={`btn btn-danger btn-with-shortcut ${saved ? 'btn-saved' : ''}`}
          onClick={handleSave}
          disabled={!isValid || saved}
        >
          <span className="btn-text">{saved ? '✓ Saved' : 'Record Expense'}</span>
          {!saved ? <span className="btn-shortcut">Alt+S</span> : null}
        </button>
      </div>

      <ExpenseHistoryPanel
        open={showExpenseHistory}
        onClose={() => setShowExpenseHistory(false)}
        data={data}
      />
    </div>
  )
}
