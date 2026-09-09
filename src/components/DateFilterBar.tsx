import type { ReactNode } from 'react'
import './DateFilterBar.css'

export interface DateFilterOption<T extends string> {
  id: T
  label: string
}

interface DateFilterBarProps<T extends string> {
  value: T
  options: readonly DateFilterOption<T>[]
  onChange: (id: T) => void
  className?: string
  showMore?: boolean
  moreActive?: boolean
  onMoreClick?: () => void
  moreLabel?: string
  children?: ReactNode
}

export default function DateFilterBar<T extends string>({
  value,
  options,
  onChange,
  className = '',
  showMore = false,
  moreActive = false,
  onMoreClick,
  moreLabel = 'More',
  children,
}: DateFilterBarProps<T>) {
  return (
    <div className={`app-chip-bar date-filter-bar${className ? ` ${className}` : ''}`}>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`app-date-chip ${value === opt.id ? 'app-date-chip--active' : ''}`}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
      {showMore && onMoreClick ? (
        <button
          type="button"
          className={`app-date-chip app-date-chip--ghost ${moreActive ? 'app-date-chip--active' : ''}`}
          onClick={onMoreClick}
        >
          {moreLabel}
        </button>
      ) : null}
      {children}
    </div>
  )
}
