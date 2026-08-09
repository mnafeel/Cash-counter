import { formatMoney, parseAmount } from '../utils/format'
import type { RoundOption } from '../utils/roundSuggestions'
import './RoundTypeChips.css'

interface RoundTypeChipsProps {
  label: string
  options: RoundOption[]
  onSelect: (amount: number) => void
  activeAmount?: number
  compact?: boolean
  onOtherSelect?: () => void
  otherActive?: boolean
  otherValue?: string
}

export default function RoundTypeChips({
  label,
  options,
  onSelect,
  activeAmount,
  compact,
  onOtherSelect,
  otherActive,
  otherValue = '',
}: RoundTypeChipsProps) {
  if (options.length === 0 && !onOtherSelect) return null

  const otherAmount = parseAmount(otherValue)
  const otherLabel =
    otherActive && otherValue
      ? formatMoney(otherAmount)
      : otherActive
        ? 'Type…'
        : 'Other'

  return (
    <div className={`round-type-chips ${compact ? 'round-type-chips--compact' : ''}`}>
      <span className="round-type-chips-label">{label}</span>
      <div className="round-type-chips-row">
        {options.map((option) => (
          <button
            key={`${option.typeLabel}-${option.amount}`}
            type="button"
            className={`round-chip ${activeAmount === option.amount && !otherActive ? 'round-chip--active' : ''}`}
            onClick={() => onSelect(option.amount)}
          >
            <span className="round-chip-amount">{formatMoney(option.amount)}</span>
          </button>
        ))}
        {onOtherSelect ? (
          <button
            type="button"
            className={`round-chip round-chip--other ${otherActive ? 'round-chip--active round-chip--other-active' : ''}`}
            onClick={onOtherSelect}
            aria-label={otherActive ? 'Custom round amount — type on numpad' : 'Other round amount'}
          >
            <span className="round-chip-amount">{otherLabel}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
