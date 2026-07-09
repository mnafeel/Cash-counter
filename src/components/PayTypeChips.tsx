import './PayTypeChips.css'

export type PayType = 'cash' | 'bank' | 'split'

const PAY_OPTIONS: { id: PayType; label: string; icon: string }[] = [
  { id: 'cash', label: 'Cash', icon: '💵' },
  { id: 'bank', label: 'Bank', icon: '🏦' },
  { id: 'split', label: 'Split', icon: '➗' },
]

interface PayTypeChipsProps {
  value: PayType
  onChange: (type: PayType) => void
}

export default function PayTypeChips({ value, onChange }: PayTypeChipsProps) {
  return (
    <div className="pay-type-chips">
      <span className="pay-type-chips-label">Payment</span>
      <div className="pay-type-chips-row">
        {PAY_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`pay-type-chip ${value === opt.id ? 'pay-type-chip--active' : ''}`}
            onClick={() => onChange(opt.id)}
          >
            <span className="pay-type-chip-icon">{opt.icon}</span>
            <span className="pay-type-chip-label">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
