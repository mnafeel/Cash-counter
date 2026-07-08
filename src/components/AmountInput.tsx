import './AmountInput.css'

interface AmountInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
}

export default function AmountInput({
  label,
  value,
  onChange,
  placeholder = '0',
  autoFocus,
}: AmountInputProps) {
  return (
    <label className="amount-input">
      <span className="amount-input-label">{label}</span>
      <input
        className="amount-input-field"
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
    </label>
  )
}
