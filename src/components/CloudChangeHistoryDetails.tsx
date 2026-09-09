import type { CloudAccountHistoryEntry, CloudAccountHistoryKind } from '../firebase/cloudUsernameRegistry'

type CloudChangeHistoryDetailsProps = {
  entries: CloudAccountHistoryEntry[]
  label: string
  hint?: string
  emptyMessage?: string
  kinds?: CloudAccountHistoryKind[]
}

function formatHistoryDate(changedAt: string): string {
  return new Date(changedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function HistoryEntryRow({ entry }: { entry: CloudAccountHistoryEntry }) {
  return (
    <li className="cloud-username-history-item">
      {entry.kind === 'password' ? (
        <div className="cloud-username-history-change">
          <span className="cloud-account-history-kind cloud-account-history-kind--password">
            Password changed
          </span>
        </div>
      ) : entry.kind === 'pin' ? (
        <div className="cloud-username-history-change">
          <span className="cloud-account-history-kind cloud-account-history-kind--pin">PIN changed</span>
        </div>
      ) : (
        <div className="cloud-username-history-change">
          <span className="cloud-account-history-kind">Username</span>
          <span className="cloud-username-history-from">{entry.fromUsername ?? '—'}</span>
          <span className="cloud-username-history-arrow" aria-hidden="true">→</span>
          <span className="cloud-username-history-to">{entry.toUsername ?? '—'}</span>
        </div>
      )}
      <time className="cloud-username-history-date" dateTime={entry.changedAt}>
        {entry.changedAt ? formatHistoryDate(entry.changedAt) : '—'}
      </time>
    </li>
  )
}

export default function CloudChangeHistoryDetails({
  entries,
  label,
  hint,
  emptyMessage = 'No changes yet.',
  kinds,
}: CloudChangeHistoryDetailsProps) {
  const visible = kinds ? entries.filter((entry) => kinds.includes(entry.kind)) : entries

  return (
    <details className="cloud-history-details">
      <summary className="cloud-history-details-summary">
        <span className="cloud-history-details-label">{label}</span>
        <span className="cloud-history-details-meta">
          {visible.length > 0 ? (
            <span className="cloud-history-details-count">{visible.length}</span>
          ) : null}
          <span className="cloud-history-details-chevron" aria-hidden="true" />
        </span>
      </summary>
      {hint ? <p className="cloud-history-details-hint">{hint}</p> : null}
      <div className="cloud-history-details-body">
        {visible.length === 0 ? (
          <p className="cloud-username-history-empty">{emptyMessage}</p>
        ) : (
          <ul className="cloud-username-history-list">
            {visible.map((entry) => (
              <HistoryEntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
