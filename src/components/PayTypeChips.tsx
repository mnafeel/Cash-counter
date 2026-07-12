import type { PayType } from '../types'
import './PayTypeChips.css'

const PAY_OPTIONS: { id: PayType; label: string; icon: string }[] = [
  { id: 'cash', label: 'Cash', icon: '💵' },
  { id: 'bank', label: 'Bank', icon: '🏦' },
  { id: 'credit', label: 'Credit', icon: '💳' },
  { id: 'split', label: 'Split', icon: '➗' },
  { id: 'cheque', label: 'Cheque', icon: '🧾' },
]

interface PayTypeChipsProps {
  value: PayType
  onChange: (type: PayType) => void
  options?: PayType[]
  label?: string
  shortcutHint?: string
  disabled?: boolean
}

export default function PayTypeChips({
  value,
  onChange,
  options,
  label = 'Payment',
  shortcutHint,
  disabled = false,
}: PayTypeChipsProps) {
  const visible = options
    ? PAY_OPTIONS.filter((opt) => options.includes(opt.id))
    : PAY_OPTIONS

  return (
    <div className={`pay-type-chips ${disabled ? 'pay-type-chips--disabled' : ''}`}>
      <div className="pay-type-chips-head">
        <span className="pay-type-chips-label">{label}</span>
        {shortcutHint ? (
          <span className="pay-type-chips-shortcut">{shortcutHint}</span>
        ) : null}
      </div>
      <div className="pay-type-chips-row">
        {visible.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`pay-type-chip ${value === opt.id ? 'pay-type-chip--active' : ''}`}
            onClick={() => !disabled && onChange(opt.id)}
            disabled={disabled}
          >
            <span className="pay-type-chip-icon">{opt.icon}</span>
            <span className="pay-type-chip-label">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export type { PayType }
