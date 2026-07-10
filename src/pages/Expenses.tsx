import { useEffect, useMemo, useRef, useState } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import PayTypeChips from '../components/PayTypeChips'
import type { ExpensePayType } from '../types'
import { parseAmount } from '../utils/format'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import { useNumpadKeyboard } from '../hooks/useNumpadKeyboard'
import './Expenses.css'

type ExpenseField = 'name' | 'amount' | 'pay'

const EXPENSE_FIELDS: ExpenseField[] = ['name', 'amount', 'pay']

function nextExpenseField(current: ExpenseField): ExpenseField {
  const idx = EXPENSE_FIELDS.indexOf(current)
  return EXPENSE_FIELDS[(idx + 1) % EXPENSE_FIELDS.length]
}

export default function Expenses() {
  const { recordExpense, data } = useCash()
  const [amountStr, setAmountStr] = useState('')
  const [name, setName] = useState('')
  const [payType, setPayType] = useState<ExpensePayType>('cash')
  const [activeField, setActiveField] = useState<ExpenseField>('name')
  const [saved, setSaved] = useState(false)
  const [nameDropdownOpen, setNameDropdownOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const paySectionRef = useRef<HTMLDivElement>(null)

  const expenseNameSuggestions = useMemo(() => {
    const seen = new Map<string, string>()
    for (let i = data.expenses.length - 1; i >= 0; i--) {
      const item = data.expenses[i]
      if (item?.kind && item.kind !== 'expense') continue
      const raw = item?.name?.trim()
      if (!raw) continue
      const key = raw.toLowerCase()
      if (!seen.has(key)) seen.set(key, raw)
    }
    return Array.from(seen.values())
  }, [data.expenses])

  const filteredNameSuggestions = useMemo(() => {
    const query = name.trim().toLowerCase()
    if (!query) return expenseNameSuggestions.slice(0, 8)
    return expenseNameSuggestions
      .filter((item) => {
        const lower = item.toLowerCase()
        return lower.includes(query) && lower !== query
      })
      .slice(0, 8)
  }, [name, expenseNameSuggestions])

  const amount = parseAmount(amountStr)
  const isValid = amount > 0 && name.trim().length > 0

  function handleSave() {
    if (!isValid || saved) return
    recordExpense({ amount, name: name.trim(), payType, kind: 'expense' })
    setSaved(true)
    setTimeout(() => {
      setAmountStr('')
      setName('')
      setPayType('cash')
      setActiveField('name')
      setSaved(false)
    }, 900)
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

  function handleEnter() {
    focusField(nextExpenseField(activeField))
  }

  function handleNumpad(action: NumpadAction) {
    if (action === 'enter') {
      handleEnter()
      return
    }

    if (activeField === 'amount') {
      setAmountStr((prev) => applyNumpadAction(prev, action))
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
    setName('')
    setPayType('cash')
    setActiveField('name')
    setSaved(false)
  }

  return (
    <div className="expenses-page">
      <div className="expenses-top">
        <label className="expense-name">
          <span className="expense-name-label">Expense Name</span>
          <input
            ref={nameInputRef}
            type="text"
            className={`expense-name-input ${activeField === 'name' ? 'expense-name-input--active' : ''}`}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameDropdownOpen(true)
            }}
            onFocus={() => {
              setActiveField('name')
              setNameDropdownOpen(true)
            }}
            onBlur={() => setNameDropdownOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setNameDropdownOpen(false)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                setNameDropdownOpen(false)
                handleEnter()
              }
            }}
            placeholder="Required — e.g. Supplies, Rent"
            autoComplete="off"
          />
          {nameDropdownOpen && filteredNameSuggestions.length > 0 && (
            <ul className="expense-name-suggestions" role="listbox">
              {filteredNameSuggestions.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    className="expense-name-suggestion"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setName(item)
                      setNameDropdownOpen(false)
                    }}
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>

        <AmountDisplay
          label="Expense Amount"
          value={amountStr}
          active={activeField === 'amount'}
          onSelect={() => focusField('amount')}
          compact
        />
      </div>

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
          onChange={(type) => {
            setPayType(type as ExpensePayType)
            focusField('pay')
          }}
          options={['cash', 'bank']}
          label="Paid From"
        />
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
