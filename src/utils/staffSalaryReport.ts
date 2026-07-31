import type { AppData } from '../types'
import { formatMoney } from './format'
import {
  buildStaffMonthSummaries,
  buildStaffOverview,
  formatSalaryMonthLabel,
  type SalaryMonthKey,
  type StaffMonthSummary,
  type StaffOverview,
} from './staffLedger'

const REPORT_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    font-size: 11px;
    line-height: 1.35;
    color: #1a1a1a;
    margin: 16px;
  }
  h1 { margin: 0 0 4px; font-size: 18px; }
  h2 {
    margin: 18px 0 8px;
    font-size: 14px;
    page-break-after: avoid;
  }
  .meta { margin: 0 0 14px; color: #555; font-size: 10px; }
  .summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin: 0 0 16px;
  }
  .summary-card {
    padding: 10px 12px;
    border: 1px solid #ccc;
    border-radius: 6px;
    background: #fafafa;
  }
  .summary-card span {
    display: block;
    font-size: 10px;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }
  .summary-card strong {
    font-size: 16px;
    color: #111;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  th, td {
    border: 1px solid #ccc;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #eee;
    font-weight: 700;
  }
  td.num, th.num { text-align: right; white-space: nowrap; }
  @media print {
    body { margin: 10mm; }
    .summary { break-inside: avoid; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
  }
`

function escapeHtml(value: string | number | undefined | null): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function printHtmlReport(html: string): void {
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.setAttribute('aria-hidden', 'true')
  document.body.appendChild(frame)

  const doc = frame.contentDocument
  const win = frame.contentWindow
  if (!doc || !win) {
    frame.remove()
    return
  }

  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => {
    frame.remove()
    win.removeEventListener('afterprint', cleanup)
  }
  win.addEventListener('afterprint', cleanup)

  win.requestAnimationFrame(() => {
    win.focus()
    win.print()
    window.setTimeout(cleanup, 60_000)
  })
}

function staffTableRows(summaries: StaffMonthSummary[]): string {
  return summaries
    .map(
      (row, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(row.name)}</td>
        <td class="num">${escapeHtml(formatMoney(row.paidTotal))}</td>
        <td class="num">${escapeHtml(formatMoney(row.remaining))}</td>
      </tr>`,
    )
    .join('')
}

function buildStaffSalaryReportHtml(
  monthKey: SalaryMonthKey,
  overview: StaffOverview,
  summaries: StaffMonthSummary[],
  exportedAt: string,
): string {
  const monthLabel = formatSalaryMonthLabel(monthKey)
  const title = `Staff Salary Report · ${monthLabel}`

  const body = `
  <h2>${escapeHtml(title)}</h2>
  <p class="meta">Generated ${escapeHtml(exportedAt)} · ${escapeHtml(monthLabel)}</p>
  <div class="summary">
    <div class="summary-card">
      <span>Total Salary</span>
      <strong>${escapeHtml(formatMoney(overview.totalSalary))}</strong>
    </div>
    <div class="summary-card">
      <span>Amount Paid (Already Paid)</span>
      <strong>${escapeHtml(formatMoney(overview.totalPaid))}</strong>
    </div>
    <div class="summary-card">
      <span>Pending / Remaining Amount</span>
      <strong>${escapeHtml(formatMoney(overview.totalRemaining))}</strong>
    </div>
  </div>
  <h2>Salaried Staff</h2>
  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Staff Name</th>
        <th class="num">Amount Paid</th>
        <th class="num">Remaining</th>
      </tr>
    </thead>
    <tbody>
      ${
        staffTableRows(summaries) ||
        '<tr><td colspan="4">No staff on record for this month.</td></tr>'
      }
    </tbody>
  </table>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>${REPORT_STYLES}</style>
</head>
<body>
  <h1>Shalimar Fashions · Cash Counter</h1>
  ${body}
</body>
</html>`
}

export function printStaffSalaryReport(data: AppData, monthKey: SalaryMonthKey): void {
  const summaries = buildStaffMonthSummaries(data, monthKey)
  const overview = buildStaffOverview(data, monthKey)
  const exportedAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date())
  const html = buildStaffSalaryReportHtml(monthKey, overview, summaries, exportedAt)
  printHtmlReport(html)
}
