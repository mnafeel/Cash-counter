import { useEffect, useRef, useState } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import PayTypeChips from '../components/PayTypeChips'
import type { ExpensePayType } from '../types'
import { parseAmount } from '../utils/format'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import './Expenses.css'

type ExpenseField = 'name' | 'amount' | 'pay'

const EXPENSE_FIELDS: ExpenseField[] = ['name', 'amount', 'pay']

function nextExpenseField(current: ExpenseField): ExpenseField {
  const idx = EXPENSE_FIELDS.indexOf(current)
  return EXPENSE_FIELDS[(idx + 1) % EXPENSE_FIELDS.length]
}

export default function Expenses() {
  const { recordExpense } = useCash()
  const [amountStr, setAmountStr] = useState('')
  const [name, setName] = useState('')
  const [payType, setPayType] = useState<ExpensePayType>('cash')
  const [activeField, setActiveField] = useState<ExpenseField>('name')
  const [saved, setSaved] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const paySectionRef = useRef<HTMLDivElement>(null)

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
            onChange={(e) => setName(e.target.value)}
            onFocus={() => setActiveField('name')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                handleEnter()
              }
            }}
            placeholder="Required — e.g. Supplies, Rent"
            autoComplete="off"
          />
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
          className={`btn btn-danger ${saved ? 'btn-saved' : ''}`}
          onClick={handleSave}
          disabled={!isValid || saved}
        >
          {saved ? '✓ Saved' : 'Record Expense'}
        </button>
      </div>
    </div>
  )
}
