import { useState } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import { formatMoney, parseAmount } from '../utils/format'
import { applyNumpadAction, type NumpadAction } from '../utils/numpad'
import './Settings.css'

export default function Settings() {
  const { data, balance, updateOpeningBalance } = useCash()
  const [openingStr, setOpeningStr] = useState(String(data.openingBalance))
  const [saved, setSaved] = useState(false)

  const opening = parseAmount(openingStr)

  function handleNumpad(action: NumpadAction) {
    if (action === 'enter') return
    setOpeningStr((prev) => applyNumpadAction(prev, action))
  }

  function handleSave() {
    updateOpeningBalance(opening)
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>Settings</h2>
        <p>Set your starting cash in the drawer</p>
      </div>

      <AmountDisplay label="Opening Cash Amount" value={openingStr} active compact />

      <NumberKeyboard onPress={handleNumpad} showEnter={false} />

      <div className="settings-info">
        <div className="settings-row">
          <span>Opening balance</span>
          <span>{formatMoney(data.openingBalance)}</span>
        </div>
        <div className="settings-row">
          <span>Current balance</span>
          <span className="settings-highlight">{formatMoney(balance)}</span>
        </div>
      </div>

      <button
        type="button"
        className={`btn btn-primary ${saved ? 'btn-saved' : ''}`}
        onClick={handleSave}
      >
        {saved ? '✓ Saved!' : 'Save Opening Balance'}
      </button>

      <p className="settings-note">
        Data is saved on your device. Bills and expenses are stored locally in your browser.
      </p>
    </div>
  )
}
