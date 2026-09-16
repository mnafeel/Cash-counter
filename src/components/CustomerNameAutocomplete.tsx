import { useMemo, useRef, useState } from 'react'
import { searchNamesByPrefix } from '../utils/normalExpenseHistory'
import './CustomerNameAutocomplete.css'

export interface CustomerNameAutocompleteProps {
  id?: string
  value: string
  suggestions: string[]
  onChange: (value: string) => void
  placeholder?: string
  label?: string
}

export default function CustomerNameAutocomplete({
  id = 'customer-name-autocomplete',
  value,
  suggestions,
  onChange,
  placeholder = 'Customer name',
  label = 'Customer',
}: CustomerNameAutocompleteProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = value.trim()
    if (!q) return suggestions.slice(0, 12)
    return searchNamesByPrefix(suggestions, q, 12)
  }, [value, suggestions])

  return (
    <div ref={rootRef} className="customer-name-ac">
      <label className="customer-name-ac__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="customer-name-ac__input"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && filtered.length > 0 ? (
        <ul className="customer-name-ac__list" role="listbox">
          {filtered.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="customer-name-ac__option"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(name)
                  setOpen(false)
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
