import { STAFF_MIN_YEAR, type SalaryMonthKey } from '../utils/staffLedger'

type MonthOption = {
  key: SalaryMonthKey
  label: string
}

type StaffOverlayMonthBarProps = {
  monthKey: SalaryMonthKey
  year: number
  monthOptions: MonthOption[]
  onMonthPick: (monthKey: SalaryMonthKey) => void
  onYearShift: (delta: number) => void
  minYear?: number
}

export default function StaffOverlayMonthBar({
  monthKey,
  year,
  monthOptions,
  onMonthPick,
  onYearShift,
  minYear = STAFF_MIN_YEAR,
}: StaffOverlayMonthBarProps) {
  return (
    <div className="staff-overlay-month-bar" aria-label="Salary month">
      <div className="staff-overlay-month-year">
        <button
          type="button"
          disabled={year <= minYear}
          onClick={() => onYearShift(-1)}
          aria-label="Previous year"
        >
          ‹
        </button>
        <strong>{year}</strong>
        <button type="button" onClick={() => onYearShift(1)} aria-label="Next year">
          ›
        </button>
      </div>
      <div className="staff-overlay-month-chips">
        {monthOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`staff-overlay-month-chip ${monthKey === option.key ? 'staff-overlay-month-chip--active' : ''}`}
            onClick={() => onMonthPick(option.key)}
          >
            {option.label.split(' ')[0].slice(0, 3)}
          </button>
        ))}
      </div>
    </div>
  )
}
