import { toInputDate } from '../utils/salesReport'
import type { CashDateFilter } from '../utils/cashActivity'

export type DetailDateFilterMode = Extract<CashDateFilter, 'all' | 'today' | 'yesterday' | 'date' | 'range'>

const OPTIONS: { id: DetailDateFilterMode; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'date', label: 'Pick date' },
  { id: 'range', label: 'Range' },
]

interface DetailDateFilterProps {
  mode: DetailDateFilterMode
  selectedDate: string
  rangeTo: string
  onModeChange: (mode: DetailDateFilterMode) => void
  onSelectedDateChange: (value: string) => void
  onRangeToChange: (value: string) => void
}

export default function DetailDateFilter({
  mode,
  selectedDate,
  rangeTo,
  onModeChange,
  onSelectedDateChange,
  onRangeToChange,
}: DetailDateFilterProps) {
  return (
    <div className="detail-date-filter">
      <div className="customer-filter-bar detail-date-filter-bar">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`customer-filter-chip ${mode === opt.id ? 'customer-filter-chip--active' : ''}`}
            onClick={() => onModeChange(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {mode === 'date' ? (
        <label className="detail-date-pick">
          <span>Date</span>
          <input
            type="date"
            value={selectedDate || toInputDate()}
            onChange={(e) => onSelectedDateChange(e.target.value)}
          />
        </label>
      ) : null}
      {mode === 'range' ? (
        <div className="detail-date-range">
          <label className="detail-date-pick">
            <span>From</span>
            <input
              type="date"
              value={selectedDate || toInputDate()}
              onChange={(e) => onSelectedDateChange(e.target.value)}
            />
          </label>
          <label className="detail-date-pick">
            <span>To</span>
            <input
              type="date"
              value={rangeTo || toInputDate()}
              onChange={(e) => onRangeToChange(e.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  )
}
