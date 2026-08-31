import './StaffSalaryUnlinkConfirm.css'

type StaffSalaryUnlinkConfirmProps = {
  open: boolean
  staffName: string
  detail?: string
  onClose: () => void
  onConfirm: () => void
}

export default function StaffSalaryUnlinkConfirm({
  open,
  staffName,
  detail,
  onClose,
  onConfirm,
}: StaffSalaryUnlinkConfirmProps) {
  if (!open) return null

  return (
    <div
      className="staff-unlink-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm unlink from salary"
    >
      <button type="button" className="staff-unlink-backdrop" aria-label="Close" onClick={onClose} />
      <div className="staff-unlink-panel">
        <div className="staff-unlink-head">
          <h3>Unlink from salary?</h3>
          <button type="button" className="staff-unlink-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="staff-unlink-copy">
          Remove the salary link for <strong>{staffName}</strong>? The expense will stay under this
          name as a general expense and will not change salary balance.
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
            Unlink
          </button>
        </div>
      </div>
    </div>
  )
}
