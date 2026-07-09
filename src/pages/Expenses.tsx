import { useState } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import BigAmount from '../components/BigAmount'
import NumberKeyboard from '../components/NumberKeyboard'
import { parseAmount } from '../utils/format'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import './Expenses.css'

export default function Expenses() {
  const { recordExpense, balance } = useCash()
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)

  const amount = parseAmount(amountStr)
  const isValid = amount > 0 && amount <= balance

  function handleNumpad(action: NumpadAction) {
    if (action === 'enter') return
    setAmountStr((prev) => applyNumpadAction(prev, action))
  }

  function handleSave() {
    if (!isValid) return
    recordExpense(amount, note.trim() || 'Cash expense')
    setSaved(true)
    setTimeout(() => {
      setAmountStr('')
      setNote('')
      setSaved(false)
    }, 1200)
  }

  function handleClear() {
    setAmountStr('')
    setNote('')
    setSaved(false)
  }

  return (
    <div className="expenses-page">
      <div className="expenses-top">
        <BigAmount label="Available Cash" value={balance} variant="primary" size="md" />
        <AmountDisplay label="Expense Amount" value={amountStr} active compact />
      </div>

      <NumberKeyboard onPress={handleNumpad} showEnter={false} />

      <div className="expenses-form">
        <label className="expense-note">
          <span className="expense-note-label">Note (optional)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Supplies, petty cash"
          />
        </label>

        {amount > balance && amount > 0 && (
          <div className="expenses-error">Not enough cash in drawer</div>
        )}
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
          {saved ? '✓ Saved!' : 'Record Expense'}
        </button>
      </div>
    </div>
  )
}
