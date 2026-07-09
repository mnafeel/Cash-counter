import { useState } from 'react'
import { useCash } from '../context/CashContext'
import AmountDisplay from '../components/AmountDisplay'
import NumberKeyboard from '../components/NumberKeyboard'
import { formatMoney, parseAmount } from '../utils/format'
import { applyNumpadAction, applyPinAction, type NumpadAction } from '../utils/numpad'
import './Settings.css'

type SettingsField = 'openingCash' | 'openingBank' | 'pin' | 'pinConfirm'

export default function Settings() {
  const {
    data,
    balance,
    bankBalance,
    updateOpeningBalance,
    updateOpeningBankBalance,
    updateHomePin,
  } = useCash()
  const [openingStr, setOpeningStr] = useState(String(data.openingBalance))
  const [openingBankStr, setOpeningBankStr] = useState(String(data.openingBankBalance ?? 0))
  const [pinStr, setPinStr] = useState('')
  const [pinConfirmStr, setPinConfirmStr] = useState('')
  const [activeField, setActiveField] = useState<SettingsField>('openingCash')
  const [saved, setSaved] = useState(false)
  const [pinError, setPinError] = useState('')

  const opening = parseAmount(openingStr)
  const openingBank = parseAmount(openingBankStr)

  function activeValue(): string {
    if (activeField === 'openingCash') return openingStr
    if (activeField === 'openingBank') return openingBankStr
    if (activeField === 'pin') return pinStr
    return pinConfirmStr
  }

  function setActiveValue(next: string) {
    if (activeField === 'openingCash') setOpeningStr(next)
    else if (activeField === 'openingBank') setOpeningBankStr(next)
    else if (activeField === 'pin') setPinStr(next)
    else setPinConfirmStr(next)
  }

  function handleNumpad(action: NumpadAction) {
    if (action === 'enter') return

    const isPinField = activeField === 'pin' || activeField === 'pinConfirm'
    const prev = activeValue()
    const next = isPinField ? applyPinAction(prev, action) : applyNumpadAction(prev, action)

    if (isPinField && next.length > 4) return
    setActiveValue(next)
    setPinError('')
  }

  function handleSave() {
    setPinError('')

    if (pinStr || pinConfirmStr) {
      if (pinStr.length !== 4 || pinConfirmStr.length !== 4) {
        setPinError('PIN must be exactly 4 digits.')
        return
      }
      if (pinStr !== pinConfirmStr) {
        setPinError('PINs do not match.')
        return
      }
      updateHomePin(pinStr)
    }

    updateOpeningBalance(opening)
    updateOpeningBankBalance(openingBank)
    setSaved(true)
    setPinStr('')
    setPinConfirmStr('')
    setTimeout(() => setSaved(false), 1200)
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>Settings</h2>
        <p>Opening balances & home PIN</p>
      </div>

      <div className="settings-fields">
        <AmountDisplay
          label="Opening Cash"
          value={openingStr}
          active={activeField === 'openingCash'}
          onSelect={() => setActiveField('openingCash')}
          compact
        />
        <AmountDisplay
          label="Opening Bank"
          value={openingBankStr}
          active={activeField === 'openingBank'}
          onSelect={() => setActiveField('openingBank')}
          compact
        />
        <AmountDisplay
          label="New Home PIN"
          value={pinStr ? '•'.repeat(pinStr.length) : ''}
          active={activeField === 'pin'}
          onSelect={() => setActiveField('pin')}
          compact
        />
        <AmountDisplay
          label="Confirm PIN"
          value={pinConfirmStr ? '•'.repeat(pinConfirmStr.length) : ''}
          active={activeField === 'pinConfirm'}
          onSelect={() => setActiveField('pinConfirm')}
          compact
        />
      </div>

      <NumberKeyboard onPress={handleNumpad} showEnter={false} />

      {pinError && <p className="settings-pin-error">{pinError}</p>}

      <div className="settings-info">
        <div className="settings-row">
          <span>Current cash</span>
          <span className="settings-highlight">{formatMoney(balance)}</span>
        </div>
        <div className="settings-row">
          <span>Current bank</span>
          <span className="settings-highlight">{formatMoney(bankBalance)}</span>
        </div>
      </div>

      <button
        type="button"
        className={`btn btn-primary ${saved ? 'btn-saved' : ''}`}
        onClick={handleSave}
      >
        {saved ? '✓ Saved!' : 'Save Settings'}
      </button>

      <p className="settings-note">
        Home PIN default is 0000. Leave PIN fields empty to keep current PIN.
      </p>
    </div>
  )
}
