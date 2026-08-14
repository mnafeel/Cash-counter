import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { formatMoney } from '../utils/format'
import { searchNamesByPrefix } from '../utils/normalExpenseHistory'

export interface CounterCustomerNameFieldHandle {
  focus: () => void
  blur: () => void
  select: () => void
  getValue: () => string
  setValue: (value: string) => void
  isFocused: () => boolean
}

type CustomerBarTag = {
  key: string
  label: string
  kind: 'old-credit' | 'old-cheque' | 'credit' | 'cheque'
}

interface CounterCustomerNameFieldProps {
  customerNameSuggestions: string[]
  customerPendingByName: Map<string, number>
  customerChequePendingByName: Map<string, number>
  showCreditSession: boolean
  showChequeSession: boolean
  onFocusSection?: () => void
  onFocusChange?: (focused: boolean) => void
}

function customerBarTagLabel(tag: CustomerBarTag): string {
  if (tag.kind === 'credit') return 'Credit'
  if (tag.kind === 'cheque') return 'Cheque'
  return tag.label
}

const CounterCustomerNameField = forwardRef<CounterCustomerNameFieldHandle, CounterCustomerNameFieldProps>(
  function CounterCustomerNameField(
    {
      customerNameSuggestions,
      customerPendingByName,
      customerChequePendingByName,
      showCreditSession,
      showChequeSession,
      onFocusSection,
      onFocusChange,
    },
    ref,
  ) {
    const [draft, setDraft] = useState('')
    const [focused, setFocused] = useState(false)
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(-1)
    const inputRef = useRef<HTMLInputElement>(null)
    const activeSuggestionRef = useRef<HTMLButtonElement>(null)
    const suggestionsListRef = useRef<HTMLUListElement>(null)

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      select: () => inputRef.current?.select(),
      getValue: () => draft,
      setValue: (value: string) => {
        setDraft(value)
        setDropdownOpen(false)
        setHighlightedIndex(-1)
      },
      isFocused: () => document.activeElement === inputRef.current,
    }))

    const filteredSuggestions = useMemo(() => {
      const query = draft.trim()
      if (!query) return customerNameSuggestions.slice(0, 8)
      return searchNamesByPrefix(customerNameSuggestions, query, 8)
    }, [draft, customerNameSuggestions])

    const customerBarTags = useMemo(() => {
      const tags: CustomerBarTag[] = []
      const key = draft.trim().toLowerCase()

      if (key) {
        const oldCredit = customerPendingByName.get(key) ?? 0
        const oldCheque = customerChequePendingByName.get(key) ?? 0
        if (oldCredit > 0) {
          tags.push({
            key: 'old-credit',
            label: `Old Credit · ${formatMoney(oldCredit)}`,
            kind: 'old-credit',
          })
        }
        if (oldCheque > 0) {
          tags.push({
            key: 'old-cheque',
            label: `Old Cheque · ${formatMoney(oldCheque)}`,
            kind: 'old-cheque',
          })
        }
      }

      if (showCreditSession) tags.push({ key: 'credit', label: 'Credit', kind: 'credit' })
      if (showChequeSession) tags.push({ key: 'cheque', label: 'Cheque', kind: 'cheque' })

      return tags
    }, [
      draft,
      customerPendingByName,
      customerChequePendingByName,
      showCreditSession,
      showChequeSession,
    ])

    useEffect(() => {
      if (highlightedIndex < 0) return
      const item = activeSuggestionRef.current
      const list = suggestionsListRef.current
      if (!item || !list) return
      const itemTop = item.offsetTop
      const itemBottom = itemTop + item.offsetHeight
      if (itemTop < list.scrollTop) {
        list.scrollTop = itemTop
      } else if (itemBottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = itemBottom - list.clientHeight
      }
    }, [highlightedIndex])

    return (
      <div className={`counter-customer ${focused ? 'counter-customer--focused' : ''}`}>
        <div className="counter-customer-row">
          <label className="counter-customer-label" htmlFor="customer-name">
            Customer Name <span className="counter-shortcut-hint">Alt+N</span>
          </label>
          <input
            ref={inputRef}
            id="customer-name"
            type="text"
            className="counter-customer-input"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setDropdownOpen(true)
              setHighlightedIndex(-1)
            }}
            onFocus={() => {
              setFocused(true)
              onFocusChange?.(true)
              setDropdownOpen(true)
              setHighlightedIndex(-1)
              onFocusSection?.()
            }}
            onBlur={() => {
              setFocused(false)
              onFocusChange?.(false)
              setDropdownOpen(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDropdownOpen(false)
                setHighlightedIndex(-1)
                return
              }
              if (!dropdownOpen || filteredSuggestions.length === 0) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHighlightedIndex((prev) => (prev + 1) % filteredSuggestions.length)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlightedIndex((prev) =>
                  prev <= 0 ? filteredSuggestions.length - 1 : prev - 1,
                )
              } else if (e.key === 'Enter' && highlightedIndex >= 0) {
                e.preventDefault()
                setDraft(filteredSuggestions[highlightedIndex])
                setDropdownOpen(false)
                setHighlightedIndex(-1)
              }
            }}
            placeholder="Optional"
            autoComplete="off"
          />
          {customerBarTags.length > 0 ? (
            <div className="counter-customer-tags counter-customer-tags--inline" role="status" aria-live="polite">
              {customerBarTags.map((tag) => (
                <span
                  key={tag.key}
                  className={`counter-customer-tag counter-customer-tag--${tag.kind}`}
                  title={tag.label}
                >
                  {customerBarTagLabel(tag)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {dropdownOpen && filteredSuggestions.length > 0 ? (
          <ul ref={suggestionsListRef} className="counter-customer-suggestions" role="listbox">
            {filteredSuggestions.map((name, index) => {
              const creditDue = customerPendingByName.get(name.toLowerCase()) ?? 0
              const chequeDue = customerChequePendingByName.get(name.toLowerCase()) ?? 0
              return (
                <li key={name}>
                  <button
                    type="button"
                    ref={index === highlightedIndex ? activeSuggestionRef : null}
                    className={`counter-customer-suggestion ${index === highlightedIndex ? 'counter-customer-suggestion--active' : ''}`}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setDraft(name)
                      setDropdownOpen(false)
                      setHighlightedIndex(-1)
                    }}
                  >
                    <span>{name}</span>
                    <span className="counter-customer-suggestion-tags">
                      {creditDue > 0 ? (
                        <span className="counter-customer-suggestion-pending">
                          Old Credit {formatMoney(creditDue)}
                        </span>
                      ) : null}
                      {chequeDue > 0 ? (
                        <span className="counter-customer-suggestion-pending counter-customer-suggestion-pending--cheque">
                          Old Cheque {formatMoney(chequeDue)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    )
  },
)

export default CounterCustomerNameField
