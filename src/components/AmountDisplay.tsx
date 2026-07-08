import { formatMoney, parseAmount } from '../utils/format'
import './AmountDisplay.css'

interface AmountDisplayProps {
  label: string
  value: string
  active?: boolean
  onSelect?: () => void
  compact?: boolean
}

export default function AmountDisplay({
  label,
  value,
  active,
  onSelect,
  compact,
}: AmountDisplayProps) {
  const display = value ? formatMoney(parseAmount(value)) : '0'

  return (
    <button
      type="button"
      className={`amount-display ${compact ? 'amount-display--compact' : ''} ${active ? 'amount-display--active' : ''}`}
      onClick={onSelect}
    >
      <span className="amount-display-label">{label}</span>
      <span className="amount-display-value">{display}</span>
      {active && !compact && <span className="amount-display-hint">Tap numbers below</span>}
    </button>
  )
}
