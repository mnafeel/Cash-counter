import { formatMoney } from '../utils/format'
import type { RoundOption } from '../utils/roundSuggestions'
import './RoundTypeChips.css'

interface RoundTypeChipsProps {
  label: string
  options: RoundOption[]
  onSelect: (amount: number) => void
  activeAmount?: number
  compact?: boolean
}

export default function RoundTypeChips({
  label,
  options,
  onSelect,
  activeAmount,
  compact,
}: RoundTypeChipsProps) {
  if (options.length === 0) return null

  return (
    <div className={`round-type-chips ${compact ? 'round-type-chips--compact' : ''}`}>
      <span className="round-type-chips-label">{label}</span>
      <div className="round-type-chips-row">
        {options.map((option) => (
          <button
            key={`${option.typeLabel}-${option.amount}`}
            type="button"
            className={`round-chip ${activeAmount === option.amount ? 'round-chip--active' : ''}`}
            onClick={() => onSelect(option.amount)}
          >
            <span className="round-chip-amount">{formatMoney(option.amount)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
