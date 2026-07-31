import { useEffect, useMemo, useRef, useState } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import PayTypeChips from '../components/PayTypeChips'
import type { ExpensePayType } from '../types'
import { formatMoney, parseAmount } from '../utils/format'
import { buildExpenseNamePickerOptions, findRecentExpenseNameOption, type ExpenseNamePickerOption } from '../utils/normalExpenseHistory'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import {
  currentSalaryMonth,
  findStaffByName,
  formatSalaryMonthLabel,
  listSalaryMonthPickerOptions,
  salaryMonthChoiceHint,
  searchStaffNames,
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
  const { recordExpense, data } = useCash()
  const [amountStr, setAmountStr] = useState('')
  const [cashSplitStr, setCashSplitStr] = useState('')
  const [bankSplitStr, setBankSplitStr] = useState('')
  const [name, setName] = useState('')
  const [payType, setPayType] = useState<ExpensePayType>('cash')
  const [activeField, setActiveField] = useState<ExpenseField>('name')
  const [saved, setSaved] = useState(false)
  const [nameDropdownOpen, setNameDropdownOpen] = useState(false)
  const [nameDropdownExpanded, setNameDropdownExpanded] = useState(false)
  const [highlightedNameIndex, setHighlightedNameIndex] = useState(-1)
  const [linkToSalary, setLinkToSalary] = useState(true)
  const [staffSalaryMonth, setStaffSalaryMonth] = useState(currentSalaryMonth())
  const salaryMonthOptions = useMemo(() => listSalaryMonthPickerOptions(), [])
  const nameInputRef = useRef<HTMLInputElement>(null)
  const paySectionRef = useRef<HTMLDivElement>(null)
  const activeNameSuggestionRef = useRef<HTMLButtonElement>(null)
  const nameSuggestionsListRef = useRef<HTMLUListElement>(null)
  const nameInputPointerRef = useRef(false)

  const splitMode = payType === 'split'

  const recentExpenseOptions = useMemo(() => buildExpenseNamePickerOptions(data, 12), [data.expenses, data.staff])

  const visibleNameSuggestions = useMemo((): ExpenseNamePickerOption[] => {
    const query = name.trim().toLowerCase()
    if (!query) {
      if (nameDropdownExpanded) return recentExpenseOptions
      return recentExpenseOptions.slice(0, 1)
    }

    const matches = recentExpenseOptions.filter((option) => {
      const lower = option.name.toLowerCase()
      return lower.includes(query) && lower !== query
    })

    const seen = new Set(matches.map((option) => option.name.toLowerCase()))
    for (const staffName of searchStaffNames(data, query)) {
      const lower = staffName.toLowerCase()
      if (seen.has(lower)) continue
      seen.add(lower)
      const fromHistory = findRecentExpenseNameOption(data, staffName)
      matches.push(
        fromHistory ?? {
          key: `staff-${lower}`,
          name: staffName,
          payLabel: 'Cash',
          timeLabel: '',
          isStaff: true,
        },
      )
    }

    return matches.slice(0, 12)
  }, [name, recentExpenseOptions, data, nameDropdownExpanded])

  const matchedStaff = useMemo(() => findStaffByName(data, name), [data, name])
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
      setNameDropdownExpanded(false)
      setNameDropdownOpen(false)
      setHighlightedNameIndex(-1)
      nameInputPointerRef.current = false
      nameInputRef.current?.focus()
    }, 900)
  }

  function openNameDropdown(preselectRecent = !name.trim()) {
    setNameDropdownOpen(true)
    if (!name.trim()) setNameDropdownExpanded(false)
    setHighlightedNameIndex(preselectRecent && recentExpenseOptions.length > 0 ? 0 : -1)
  }

  function openNameDropdownFromPointer() {
    nameInputPointerRef.current = true
    openNameDropdown()
  }

  function focusField(field: ExpenseField) {
    setActiveField(field)
    if (field === 'name') nameInputRef.current?.focus()
    else nameInputRef.current?.blur()
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

  function handleEnter() {
    focusField(nextExpenseField(activeField, splitMode))
  }

  function handleNumpad(action: NumpadAction) {
    if (action === 'enter') {
      handleEnter()
      return
    }

    if (activeField === 'amount') {
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
  useNumpadKeyboard((action) => numpadHandlerRef.current(action), !saved)

  const saveHandlerRef = useRef(handleSave)
  saveHandlerRef.current = handleSave

  useEffect(() => {
    if (saved) return

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
  }, [saved, isValid])

  function handleClear() {
    setAmountStr('')
    setCashSplitStr('')
    setBankSplitStr('')
    setName('')
    setPayType('cash')
    setActiveField('name')
    resetStaffFields()
    setSaved(false)
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

  return (
    <div className="expenses-page">
      <header className="expenses-page-head">
        <h1 className="expenses-page-title">Expenses</h1>
        <p className="expenses-page-sub">Normal cash or bank expenses only · not purchases</p>
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
              setNameDropdownExpanded(false)
              if (next.trim()) {
                setNameDropdownOpen(true)
                setHighlightedNameIndex(-1)
                return
              }
              if (nameInputPointerRef.current) {
                openNameDropdown()
                return
              }
              setNameDropdownOpen(false)
              setHighlightedNameIndex(-1)
            }}
            onFocus={() => {
              setActiveField('name')
            }}
            onBlur={() => {
              setNameDropdownOpen(false)
              setNameDropdownExpanded(false)
              nameInputPointerRef.current = false
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setNameDropdownOpen(false)
                setNameDropdownExpanded(false)
                setHighlightedNameIndex(-1)
                return
              }
              if (nameDropdownOpen && visibleNameSuggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  if (!name.trim() && !nameDropdownExpanded && recentExpenseOptions.length > 1) {
                    setNameDropdownExpanded(true)
                    setHighlightedNameIndex(1)
                    return
                  }
                  setHighlightedNameIndex((prev) =>
                    prev < 0 ? 0 : (prev + 1) % visibleNameSuggestions.length,
                  )
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  if (!name.trim() && nameDropdownExpanded && highlightedNameIndex <= 1) {
                    setNameDropdownExpanded(false)
                    setHighlightedNameIndex(0)
                    return
                  }
                  setHighlightedNameIndex((prev) =>
                    prev <= 0 ? visibleNameSuggestions.length - 1 : prev - 1,
                  )
                  return
                }
                if (e.key === 'Enter' && highlightedNameIndex >= 0) {
                  e.preventDefault()
                  setName(visibleNameSuggestions[highlightedNameIndex].name)
                  setNameDropdownOpen(false)
                  setNameDropdownExpanded(false)
                  setHighlightedNameIndex(-1)
                  return
                }
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                setNameDropdownOpen(false)
                setNameDropdownExpanded(false)
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
                      setName(item.name)
                      setNameDropdownOpen(false)
                      setNameDropdownExpanded(false)
                      setHighlightedNameIndex(-1)
                    }}
                  >
                    <span className="expense-name-suggestion-text">{item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>

        <AmountDisplay
          label={splitMode ? 'Total Amount' : 'Expense Amount'}
          value={amountStr}
          active={activeField === 'amount'}
          onSelect={() => focusField('amount')}
          compact
        />

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

      {showStaffOptions && matchedStaff ? (
        <div className="expenses-staff expenses-staff--active">
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
      </div>

      <div className="expenses-keyboard">
        <NumberKeyboard onPress={handleNumpad} />
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
    </div>
  )
}
