import { formatMoney, parseAmount } from '../utils/format'
import './AmountDisplay.css'

interface AmountDisplayProps {
  label: string
  value: string
  active?: boolean
  onSelect?: () => void
  compact?: boolean
  shortcutHint?: string
}

export default function AmountDisplay({
  label,
  value,
  active,
  onSelect,
  compact,
  shortcutHint,
}: AmountDisplayProps) {
  const display = value ? formatMoney(parseAmount(value)) : '0'

  return (
    <button
      type="button"
      className={`amount-display ${compact ? 'amount-display--compact' : ''} ${active ? 'amount-display--active' : ''}`}
      onClick={onSelect}
    >
      <span className="amount-display-label">
        {label}
        {shortcutHint ? <span className="amount-display-shortcut">{shortcutHint}</span> : null}
      </span>
      <span className="amount-display-value">{display}</span>
      {active && !compact && <span className="amount-display-hint">Tap numbers below</span>}
    </button>
  )
}
