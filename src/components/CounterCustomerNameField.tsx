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

type CustomerBalanceTag = {
  key: string
  label: string
  amount: string
  kind: 'credit' | 'cheque' | 'old-credit' | 'old-cheque'
}

interface CounterCustomerNameFieldProps {
  customerNameSuggestions: string[]
  customerPendingByName: Map<string, number>
  customerChequePendingByName: Map<string, number>
  sessionCreditAmount?: number | null
  sessionChequeAmount?: number | null
  onNameChange?: (name: string) => void
  onFocusSection?: () => void
  onFocusChange?: (focused: boolean) => void
}

function scrollActiveOptionIntoView(option: HTMLElement | null, list: HTMLElement | null) {
  if (!option || !list) return
  const listRect = list.getBoundingClientRect()
  const itemRect = option.getBoundingClientRect()
  if (itemRect.top < listRect.top) {
    list.scrollTop -= listRect.top - itemRect.top
  } else if (itemRect.bottom > listRect.bottom) {
    list.scrollTop += itemRect.bottom - listRect.bottom
  }
}

function nextHighlightedIndex(prev: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1
  if (prev < 0) return direction > 0 ? 0 : count - 1
  return (prev + direction + count) % count
}

function getSuggestionPageSize(list: HTMLElement | null): number {
  if (!list) return 5
  const item = list.querySelector('button')
  if (!(item instanceof HTMLElement)) return 5
  const itemHeight = item.offsetHeight + 2
  if (itemHeight <= 0) return 5
  return Math.max(1, Math.floor(list.clientHeight / itemHeight))
}

function pageHighlightedIndex(
  prev: number,
  count: number,
  direction: 1 | -1,
  pageSize: number,
): number {
  if (count <= 0) return -1
  const start = prev < 0 ? (direction > 0 ? 0 : count - 1) : prev
  const next = start + direction * pageSize
  if (next < 0) return 0
  if (next >= count) return count - 1
  return next
}

function isSuggestionNavKey(key: string): boolean {
  return key === 'ArrowDown' || key === 'ArrowUp' || key === 'PageDown' || key === 'PageUp'
}

function notifyNameChange(onNameChange: ((name: string) => void) | undefined, name: string) {
  onNameChange?.(name)
}

const CounterCustomerNameField = forwardRef<CounterCustomerNameFieldHandle, CounterCustomerNameFieldProps>(
  function CounterCustomerNameField(
    {
      customerNameSuggestions,
      customerPendingByName,
      customerChequePendingByName,
      sessionCreditAmount,
      sessionChequeAmount,
      onNameChange,
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
    const customerRootRef = useRef<HTMLDivElement>(null)
    const activeSuggestionRef = useRef<HTMLButtonElement>(null)
    const suggestionsListRef = useRef<HTMLUListElement>(null)
    const keyboardNavRef = useRef(false)

    useImperativeHandle(
      ref,
      () => ({
        focus: () => inputRef.current?.focus(),
        blur: () => inputRef.current?.blur(),
        select: () => inputRef.current?.select(),
        getValue: () => draft,
        setValue: (value: string) => {
          setDraft(value)
          notifyNameChange(onNameChange, value)
          setDropdownOpen(false)
          setHighlightedIndex(-1)
        },
        isFocused: () => document.activeElement === inputRef.current,
      }),
      [draft, onNameChange],
    )

    const filteredSuggestions = useMemo(() => {
      const query = draft.trim()
      if (!query) return customerNameSuggestions
      return searchNamesByPrefix(customerNameSuggestions, query, 20)
    }, [draft, customerNameSuggestions])

    const balanceTags = useMemo(() => {
      const tags: CustomerBalanceTag[] = []
      const key = draft.trim().toLowerCase()
      if (!key) return tags

      const ledgerCredit = customerPendingByName.get(key) ?? 0
      const ledgerCheque = customerChequePendingByName.get(key) ?? 0
      const sessionCredit = (sessionCreditAmount ?? 0) > 0 ? sessionCreditAmount! : 0
      const sessionCheque = (sessionChequeAmount ?? 0) > 0 ? sessionChequeAmount! : 0
      const collectingBill = sessionCredit > 0 || sessionCheque > 0

      if (collectingBill) {
        const otherCredit = Math.max(0, ledgerCredit - sessionCredit)
        const otherCheque = Math.max(0, ledgerCheque - sessionCheque)
        if (otherCredit > 0) {
          tags.push({
            key: 'old-credit',
            label: 'Old Credit',
            amount: formatMoney(otherCredit),
            kind: 'old-credit',
          })
        }
        if (otherCheque > 0) {
          tags.push({
            key: 'old-cheque',
            label: 'Old Cheque',
            amount: formatMoney(otherCheque),
            kind: 'old-cheque',
          })
        }
      } else {
        if (ledgerCredit > 0) {
          tags.push({
            key: 'credit',
            label: 'Credit',
            amount: formatMoney(ledgerCredit),
            kind: 'credit',
          })
        }
        if (ledgerCheque > 0) {
          tags.push({
            key: 'cheque',
            label: 'Cheque',
            amount: formatMoney(ledgerCheque),
            kind: 'cheque',
          })
        }
      }

      return tags
    }, [
      draft,
      customerPendingByName,
      customerChequePendingByName,
      sessionCreditAmount,
      sessionChequeAmount,
    ])

    useEffect(() => {
      if (highlightedIndex < 0) return
      const frame = window.requestAnimationFrame(() => {
        scrollActiveOptionIntoView(activeSuggestionRef.current, suggestionsListRef.current)
        activeSuggestionRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        customerRootRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      })
      return () => window.cancelAnimationFrame(frame)
    }, [highlightedIndex, filteredSuggestions.length])

    return (
      <div
        ref={customerRootRef}
        className={`counter-customer ${focused ? 'counter-customer--focused' : ''} ${draft.trim() ? 'counter-customer--has-name' : ''}`}
      >
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
              const next = e.target.value
              setDraft(next)
              notifyNameChange(onNameChange, next)
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
              keyboardNavRef.current = false
            }}
            onKeyDown={(e) => {
              const count = filteredSuggestions.length

              if (e.key === 'Escape') {
                setDropdownOpen(false)
                setHighlightedIndex(-1)
                keyboardNavRef.current = false
                return
              }

              if (count > 0 && isSuggestionNavKey(e.key)) {
                e.preventDefault()
                keyboardNavRef.current = true
                if (!dropdownOpen) setDropdownOpen(true)
                const direction =
                  e.key === 'ArrowDown' || e.key === 'PageDown' ? 1 : -1
                if (e.key === 'PageDown' || e.key === 'PageUp') {
                  const pageSize = getSuggestionPageSize(suggestionsListRef.current)
                  setHighlightedIndex((prev) =>
                    pageHighlightedIndex(prev, count, direction, pageSize),
                  )
                } else {
                  setHighlightedIndex((prev) => nextHighlightedIndex(prev, count, direction))
                }
                return
              }

              if (dropdownOpen && count > 0 && e.key === 'Enter' && highlightedIndex >= 0) {
                e.preventDefault()
                const picked = filteredSuggestions[highlightedIndex]
                setDraft(picked)
                notifyNameChange(onNameChange, picked)
                setDropdownOpen(false)
                setHighlightedIndex(-1)
                keyboardNavRef.current = false
              }
            }}
            placeholder="Optional"
            autoComplete="off"
          />
          {balanceTags.length > 0 ? (
            <div
              className="counter-customer-balances"
              role="status"
              aria-live="polite"
              aria-label="Customer credit and cheque pending"
            >
              {balanceTags.map((tag) => (
                <span
                  key={tag.key}
                  className={`counter-customer-balance counter-customer-balance--${tag.kind}`}
                  title={`${tag.label} ${tag.amount}`}
                >
                  <span className="counter-customer-balance-label">{tag.label}</span>
                  <span className="counter-customer-balance-amount">{tag.amount}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {dropdownOpen && filteredSuggestions.length > 0 ? (
          <ul
            ref={suggestionsListRef}
            className="counter-customer-suggestions"
            role="listbox"
            onMouseMove={() => {
              keyboardNavRef.current = false
            }}
            onWheel={(event) => event.stopPropagation()}
          >
            {filteredSuggestions.map((name, index) => {
              const creditDue = customerPendingByName.get(name.toLowerCase()) ?? 0
              const chequeDue = customerChequePendingByName.get(name.toLowerCase()) ?? 0
              return (
                <li key={name}>
                  <button
                    type="button"
                    ref={index === highlightedIndex ? activeSuggestionRef : null}
                    className={`counter-customer-suggestion ${index === highlightedIndex ? 'counter-customer-suggestion--active' : ''}`}
                    aria-selected={index === highlightedIndex}
                    onMouseEnter={() => {
                      if (!keyboardNavRef.current) setHighlightedIndex(index)
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setDraft(name)
                      notifyNameChange(onNameChange, name)
                      setDropdownOpen(false)
                      setHighlightedIndex(-1)
                    }}
                  >
                    <span className="counter-customer-suggestion-name">{name}</span>
                    {(creditDue > 0 || chequeDue > 0) ? (
                      <span className="counter-customer-suggestion-balances">
                        {creditDue > 0 ? (
                          <span className="counter-customer-balance counter-customer-balance--credit counter-customer-balance--compact">
                            <span className="counter-customer-balance-label">Credit</span>
                            <span className="counter-customer-balance-amount">{formatMoney(creditDue)}</span>
                          </span>
                        ) : null}
                        {chequeDue > 0 ? (
                          <span className="counter-customer-balance counter-customer-balance--cheque counter-customer-balance--compact">
                            <span className="counter-customer-balance-label">Cheque</span>
                            <span className="counter-customer-balance-amount">{formatMoney(chequeDue)}</span>
                          </span>
                        ) : null}
                      </span>
                    ) : null}
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
