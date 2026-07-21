import { formatMoney } from '../utils/format'
import {
  GST_BILL_LABEL,
  NO_GST_BILL_LABEL,
  NO1_BILL_LABEL,
  NO2_BILL_LABEL,
  type ExpenseBillMode,
} from '../utils/expenseBillLabels'
import './PayTypeChips.css'

export type BillMode = ExpenseBillMode

const BILL_OPTIONS: { id: BillMode; label: string; sublabel: string; icon: string }[] = [
  { id: 'no1', label: NO1_BILL_LABEL, sublabel: GST_BILL_LABEL, icon: '🧾' },
  { id: 'no2', label: NO2_BILL_LABEL, sublabel: NO_GST_BILL_LABEL, icon: '📄' },
]

interface BillNoChipsProps {
  value: BillMode
  onChange: (mode: BillMode) => void
  bill1Amount?: number
  bill2Amount?: number
  label?: string
  active?: boolean
  onFocus?: () => void
}

export default function BillNoChips({
  value,
  onChange,
  bill1Amount = 0,
  bill2Amount = 0,
  label = 'Bill Option',
  active = false,
  onFocus,
}: BillNoChipsProps) {
  function handleClick(mode: BillMode) {
    onFocus?.()
    onChange(mode)
  }

  function chipHint(mode: BillMode): string | null {
    if (mode === 'no1' && bill1Amount > 0) return formatMoney(bill1Amount)
    if (mode === 'no2' && bill2Amount > 0) return formatMoney(bill2Amount)
    return null
  }

  return (
    <div
      className={`pay-type-chips ${active ? 'pay-type-chips--focused' : ''}`}
      onClick={onFocus}
      role="group"
    >
      <div className="pay-type-chips-head">
        <span className="pay-type-chips-label">{label}</span>
      </div>
      <div className="pay-type-chips-row">
        {BILL_OPTIONS.map((opt) => {
          const hint = chipHint(opt.id)
          const isActive = value === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              className={`pay-type-chip ${isActive ? 'pay-type-chip--active' : ''}`}
              onClick={() => handleClick(opt.id)}
            >
              <span className="pay-type-chip-icon">{opt.icon}</span>
              <span className="pay-type-chip-label">{opt.label}</span>
              <span className="pay-type-chip-sublabel">{opt.sublabel}</span>
              {hint ? <span className="pay-type-chip-hint">{hint}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
