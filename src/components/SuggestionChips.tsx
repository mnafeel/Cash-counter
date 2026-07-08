import { formatMoney } from '../utils/format'
import './SuggestionChips.css'

interface SuggestionChipsProps {
  label: string
  amounts: number[]
  onSelect: (amount: number) => void
  activeAmount?: number
  compact?: boolean
}

export default function SuggestionChips({
  label,
  amounts,
  onSelect,
  activeAmount,
  compact,
}: SuggestionChipsProps) {
  if (amounts.length === 0) return null

  return (
    <div className={`suggestion-chips ${compact ? 'suggestion-chips--compact' : ''}`}>
      <span className="suggestion-chips-label">{label}</span>
      <div className="suggestion-chips-row">
        {amounts.map((amount) => (
          <button
            key={amount}
            type="button"
            className={`chip ${activeAmount === amount ? 'chip--active' : ''}`}
            onClick={() => onSelect(amount)}
          >
            {formatMoney(amount)}
          </button>
        ))}
      </div>
    </div>
  )
}
