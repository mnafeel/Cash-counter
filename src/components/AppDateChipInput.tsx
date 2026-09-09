import { formatDateInputDisplay } from '../utils/format'
import './AppDateChipInput.css'

const DATE_CHIP_PLACEHOLDER = 'DD/MM/YYYY'

interface AppDateChipInputProps {
  value: string
  onChange: (value: string) => void
  active?: boolean
  className?: string
  'aria-label': string
}

export default function AppDateChipInput({
  value,
  onChange,
  active = false,
  className = '',
  'aria-label': ariaLabel,
}: AppDateChipInputProps) {
  return (
    <label
      className={`app-date-chip-input${active ? ' app-date-chip-input--active' : ''}${className ? ` ${className}` : ''}`}
    >
      <span className="app-date-chip-input__text" aria-hidden="true">
        {value ? formatDateInputDisplay(value) : DATE_CHIP_PLACEHOLDER}
      </span>
      <input
        type="date"
        className="app-date-chip-input__native"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
      />
    </label>
  )
}
