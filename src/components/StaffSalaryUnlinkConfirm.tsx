import './StaffSalaryUnlinkConfirm.css'

type StaffSalaryUnlinkConfirmProps = {
  open: boolean
  staffName: string
  detail?: string
  variant?: 'dismiss-staff' | 'remove-salary'
  onClose: () => void
  onConfirm: () => void
}

export default function StaffSalaryUnlinkConfirm({
  open,
  staffName,
  detail,
  variant = 'remove-salary',
  onClose,
  onConfirm,
}: StaffSalaryUnlinkConfirmProps) {
  if (!open) return null

  const isDismissStaff = variant === 'dismiss-staff'

  return (
    <div
      className="staff-unlink-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isDismissStaff ? 'Confirm not a staff expense' : 'Confirm remove salary credit'}
    >
      <button type="button" className="staff-unlink-backdrop" aria-label="Close" onClick={onClose} />
      <div className="staff-unlink-panel">
        <div className="staff-unlink-head">
          <h3>{isDismissStaff ? 'Unlink from salary?' : 'Remove salary month credit?'}</h3>
          <button type="button" className="staff-unlink-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="staff-unlink-copy">
          {isDismissStaff ? (
            <>
              Unlink <strong>{staffName}</strong> from salary? This expense will not count toward
              their salary balance.
            </>
          ) : (
            <>
              Remove salary credit for <strong>{staffName}</strong>? The expense stays linked to
              this staff member but will not count toward any salary month.
            </>
          )}
        </p>
        {detail ? <p className="staff-unlink-detail">{detail}</p> : null}
        <div className="staff-unlink-actions">
          <button type="button" className="staff-unlink-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="staff-unlink-btn-confirm"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {isDismissStaff ? 'Unlink' : 'Remove credit'}
          </button>
        </div>
      </div>
    </div>
  )
}
