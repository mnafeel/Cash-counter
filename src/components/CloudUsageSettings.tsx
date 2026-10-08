import { useEffect, useState } from 'react'
import { getFirebaseApp } from '../firebase/config'
import { cloudConsoleLinks, cloudUsageError, fetchBackupFootprint, fetchCloudUsage, type CloudUsageReport } from '../firebase/cloudUsage'
import './CloudUsageSettings.css'

function size(bytes: number | null | undefined): string {
  if (bytes == null) return 'Unavailable'
  if (bytes < 1024) return `${bytes} B`
  const exponent = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** exponent).toFixed(2)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][exponent]}`
}
function money(amount: number, currency: string): string {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount) }
  catch { return `${currency} ${amount.toFixed(2)}` }
}
const time = (at: string) => new Date(at).toLocaleString()

export default function CloudUsageSettings({ uid }: { uid: string }) {
  const [report, setReport] = useState<CloudUsageReport | null>(null)
  const [footprint, setFootprint] = useState<{ bytes: number | null; backupAt: string | null } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const project = getFirebaseApp().options.projectId ?? ''
  const links = cloudConsoleLinks(project)
  useEffect(() => {
    let active = true
    setReport(null)
    setFootprint(null)
    setError('')
    setBusy(true)
    void fetchBackupFootprint(uid).then((value) => { if (active) setFootprint(value) }).catch(() => {})
    void fetchCloudUsage(uid).then((value) => { if (active) setReport(value) })
      .catch((err: unknown) => { if (active) setError(cloudUsageError(err)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [uid, refresh])

  const totals = new Map<string, number>()
  for (const row of report?.costs.rows ?? []) totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amount)
  const metrics = report?.metrics
  return (
    <section className="cloud-card app-surface cloud-usage" aria-label="Cloud usage and billing">
      <div className="cloud-card-head cloud-usage-heading">
        <div><h3>Cloud usage &amp; billing</h3><p>{project} · Project-wide usage</p></div>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>{busy ? 'Checking…' : 'Refresh'}</button>
      </div>
      <div className="cloud-usage-plan">
        <strong>{report?.billingEnabled === true ? 'Blaze · Active' : report?.billingEnabled === false ? 'Billing disabled' : 'Blaze · Awaiting verification'}</strong>
        <span>Pay as you go. Storage grows with your data; there is no fixed “full” percentage.</span>
      </div>
      {error ? <p className="cloud-card-status" role="status">{error}</p> : null}
      {report?.billingStatusError ? <p className="cloud-card-status">Billing status: {report.billingStatusError}</p> : null}
      {report?.alerts.map((alert) => <p key={alert.id} className="cloud-card-status cloud-card-status--error" role="alert">{alert.message}</p>)}
      <dl className="cloud-usage-grid">
        <div><dt>Firestore data &amp; indexes</dt><dd>{size(metrics?.firestoreBytes?.value)}</dd><small>Includes all users and stored history</small></div>
        <div><dt>Managed database backups</dt><dd>{size(metrics?.backupBytes?.value)}</dd><small>Scheduled Firestore backups</small></div>
        <div><dt>Cloud Storage buckets</dt><dd>{size(metrics?.bucketBytes?.value)}</dd><small>Files across this project</small></div>
        <div><dt>Your latest backup payload</dt><dd>{size(footprint?.bytes)}</dd><small>JSON only; excludes indexes and history</small></div>
        {([['reads', 'Document reads'], ['writes', 'Document writes'], ['deletes', 'Document deletes'], ['functionRequests', 'Cloud Run / Functions requests']] as const).map(([key, label]) => (
          <div key={key}><dt>{label}</dt><dd>{metrics?.[key]?.value == null ? 'Unavailable' : metrics[key].value.toLocaleString('en-IN')}</dd><small>Last 24 hours · reported operations</small></div>
        ))}
      </dl>
      {metrics && Object.values(metrics).some((metric) => metric.error) ? <p className="cloud-usage-note">Some measurements are unavailable or not yet reported. Missing values are not zero usage.</p> : null}
      <div className="cloud-usage-cost">
        <h4>This month’s reported cost</h4>
        <strong>{totals.size ? [...totals].map(([currency, amount]) => money(amount, currency)).join(' · ') : 'Unavailable'}</strong>
        <p>Usage this calendar month (UTC), including exported credits. Reporting is delayed; this is not an invoice or an outstanding balance.</p>
        {report?.costs.error ? <p>{report.costs.error}</p> : null}
        {report?.costs.rows.length ? <ul>{report.costs.rows.map((row) => <li key={`${row.service}-${row.currency}`}><span>{row.service}</span><b>{money(row.amount, row.currency)}</b></li>)}</ul> : null}
        {report?.costs.exportedAt ? <small>Billing export updated {time(report.costs.exportedAt)}</small> : null}
      </div>
      <div className="cloud-usage-payment">
        <h4>Payments &amp; outstanding amount</h4>
        <p>{report?.outstandingAmount != null && report.outstandingCurrency ? money(report.outstandingAmount, report.outstandingCurrency) : 'Check Cloud Billing for the current outstanding amount.'}</p>
        <small>{report?.paymentCheckedAt ? `Payment notice verified ${time(report.paymentCheckedAt)}` : 'Payment status is not verified. No alert does not mean there is no balance due.'}</small>
      </div>
      <div className="cloud-card-actions"><a className="btn btn-secondary" href={links.billing} target="_blank" rel="noreferrer">Open Cloud Billing</a><a className="btn btn-ghost" href={links.usage} target="_blank" rel="noreferrer">Open Firebase usage</a></div>
      <p className="cloud-usage-note">{report ? `Last checked ${time(report.checkedAt)}. ` : ''}Project reports are cached for up to 15 minutes. Backups continue independently of this panel.</p>
    </section>
  )
}
