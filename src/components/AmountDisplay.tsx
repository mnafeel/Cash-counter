import { formatMoney, parseAmount } from '../utils/format'
import './AmountDisplay.css'

interface AmountDisplayProps {
  label: string
  value: string
  active?: boolean
  onSelect?: () => void
  compact?: boolean
  shortcutHint?: string
  approved?: boolean
  locked?: boolean
  pending?: boolean
  priorApprovedAmount?: number
  priorPendingAmount?: number
  /** Credit already collected — shown small with ✓ (e.g. when approving cheque later). */
  priorCreditPaidAmount?: number
  /** Remaining balance shown small above main value (e.g. credit due while paying cash/bank). */
  remainingAmount?: number
}

export default function AmountDisplay({
  label,
  value,
  active,
  onSelect,
  compact,
  shortcutHint,
  approved,
  locked,
  pending,
  priorApprovedAmount,
  priorPendingAmount,
  priorCreditPaidAmount,
  remainingAmount,
}: AmountDisplayProps) {
  const display = value ? formatMoney(parseAmount(value)) : '0'
  const className = [
    'amount-display',
    compact ? 'amount-display--compact' : '',
    active && !locked && !pending ? 'amount-display--active' : '',
    approved ? 'amount-display--approved-readonly' : '',
    pending ? 'amount-display--pending-readonly' : '',
    locked ? 'amount-display--locked-readonly' : '',
    priorApprovedAmount && priorApprovedAmount > 0 ? 'amount-display--has-prior' : '',
    priorPendingAmount && priorPendingAmount > 0 ? 'amount-display--has-prior-pending' : '',
    priorCreditPaidAmount && priorCreditPaidAmount > 0 ? 'amount-display--has-prior-paid' : '',
    remainingAmount != null && remainingAmount >= 0 ? 'amount-display--has-remaining' : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (approved || locked || pending) {
    return (
      <div
        className={className}
        aria-label={`${label} ${approved ? 'approved' : pending ? 'pending' : 'locked'} ${display}`}
      >
        <span className="amount-display-label">
          {label}
          {approved ? ' ✓' : ''}
          {pending ? ' ⏳' : ''}
        </span>
        {priorCreditPaidAmount && priorCreditPaidAmount > 0 ? (
          <span className="amount-display-prior amount-display-prior--credit-paid">
            {compact
              ? `✓ Credit ${formatMoney(priorCreditPaidAmount)}`
              : `Credit paid ${formatMoney(priorCreditPaidAmount)} ✓`}
          </span>
        ) : null}
        {priorApprovedAmount && priorApprovedAmount > 0 ? (
          <span className="amount-display-prior">
            {compact
              ? `✓ ${formatMoney(priorApprovedAmount)}`
              : `Old ${formatMoney(priorApprovedAmount)} ✓`}
          </span>
        ) : null}
        {remainingAmount != null && remainingAmount >= 0 ? (
          <span className="amount-display-prior amount-display-prior--credit">
            {compact
              ? `Credit ${formatMoney(remainingAmount)}`
              : `Credit due ${formatMoney(remainingAmount)}`}
          </span>
        ) : null}
        <span className="amount-display-value">{display}</span>
      </div>
    )
  }

  return (
    <button type="button" className={className} onClick={onSelect}>
      <span className="amount-display-label">
        {label}
        {shortcutHint ? <span className="amount-display-shortcut">{shortcutHint}</span> : null}
      </span>
      {priorCreditPaidAmount && priorCreditPaidAmount > 0 ? (
        <span className="amount-display-prior amount-display-prior--credit-paid">
          {compact
            ? `✓ Credit ${formatMoney(priorCreditPaidAmount)}`
            : `Credit paid ${formatMoney(priorCreditPaidAmount)} ✓`}
        </span>
      ) : null}
      {remainingAmount != null && remainingAmount >= 0 ? (
        <span className="amount-display-prior amount-display-prior--credit">
          {compact
            ? `Credit ${formatMoney(remainingAmount)}`
            : `Credit due ${formatMoney(remainingAmount)}`}
        </span>
      ) : null}
      {priorPendingAmount && priorPendingAmount > 0 ? (
        <span className="amount-display-prior amount-display-prior--pending">
          {compact ? `⏳ ${formatMoney(priorPendingAmount)}` : `Pending ${formatMoney(priorPendingAmount)}`}
        </span>
      ) : null}
      {priorApprovedAmount && priorApprovedAmount > 0 ? (
        <span className="amount-display-prior">
        {compact ? `✓ ${formatMoney(priorApprovedAmount)}` : `Old ${formatMoney(priorApprovedAmount)} ✓`}
        </span>
      ) : null}
      <span className="amount-display-value">{display}</span>
      {active && !compact && <span className="amount-display-hint">Tap numbers below</span>}
    </button>
  )
}
