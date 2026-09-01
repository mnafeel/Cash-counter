import type { AppData } from '../types'
import { formatMoney } from './format'
import { printHtmlReport } from './printHtmlReport'
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
    grid-template-columns: repeat(4, minmax(0, 1fr));
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

function formatExportedAt(): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date())
}

function overviewFromSummaries(summaries: StaffMonthSummary[]): StaffOverview {
  return {
    staffCount: summaries.length,
    totalSalary: summaries.reduce((sum, row) => sum + row.monthlySalary, 0),
    totalDeductions: summaries.reduce((sum, row) => sum + row.deductionTotal, 0),
    totalPaidDays: summaries.reduce((sum, row) => sum + row.paidDays, 0),
    totalNetSalary: summaries.reduce((sum, row) => sum + row.netSalary, 0),
    totalPaid: summaries.reduce((sum, row) => sum + row.paidTotal, 0),
    totalRemaining: summaries.reduce((sum, row) => sum + Math.max(0, row.remaining), 0),
  }
}

function staffTableRows(summaries: StaffMonthSummary[]): string {
  return summaries
    .map(
      (row, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(row.name)}</td>
        <td class="num">${escapeHtml(formatMoney(row.monthlySalary))}</td>
        <td class="num">${escapeHtml(formatMoney(row.deductionTotal))}</td>
        <td class="num">${escapeHtml(formatMoney(row.netSalary))}</td>
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
  scopeLabel?: string,
): string {
  const monthLabel = formatSalaryMonthLabel(monthKey)
  const title = scopeLabel
    ? `Staff Salary Report · ${monthLabel} · ${scopeLabel}`
    : `Staff Salary Report · ${monthLabel}`

  const body = `
  <h2>${escapeHtml(title)}</h2>
  <p class="meta">Generated ${escapeHtml(exportedAt)} · ${escapeHtml(monthLabel)}${scopeLabel ? ` · ${escapeHtml(scopeLabel)}` : ''}</p>
  <div class="summary">
    <div class="summary-card">
      <span>Base Salary</span>
      <strong>${escapeHtml(formatMoney(overview.totalSalary))}</strong>
    </div>
    <div class="summary-card">
      <span>Deductions</span>
      <strong>${escapeHtml(formatMoney(overview.totalDeductions))}</strong>
    </div>
    <div class="summary-card">
      <span>Net Salary</span>
      <strong>${escapeHtml(formatMoney(overview.totalNetSalary))}</strong>
    </div>
    <div class="summary-card">
      <span>Remaining</span>
      <strong>${escapeHtml(formatMoney(overview.totalRemaining))}</strong>
    </div>
  </div>
  <p class="meta">Net salary = base salary − deduction (Half Day or Unpaid leave only).</p>
  <h2>Salaried Staff</h2>
  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Staff Name</th>
        <th class="num">Base</th>
        <th class="num">Deduction</th>
        <th class="num">Net Salary</th>
        <th class="num">Paid</th>
        <th class="num">Remaining</th>
      </tr>
    </thead>
    <tbody>
      ${
        staffTableRows(summaries) ||
        '<tr><td colspan="7">No staff on record for this month.</td></tr>'
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

function printStaffSalaryReportForSummaries(
  monthKey: SalaryMonthKey,
  summaries: StaffMonthSummary[],
  scopeLabel?: string,
): void {
  if (summaries.length === 0) return
  const overview = overviewFromSummaries(summaries)
  const exportedAt = formatExportedAt()
  const html = buildStaffSalaryReportHtml(monthKey, overview, summaries, exportedAt, scopeLabel)
  printHtmlReport(html)
}

function summariesForStaffIds(
  data: AppData,
  monthKey: SalaryMonthKey,
  staffIds: string[],
): StaffMonthSummary[] {
  const idSet = new Set(staffIds)
  return buildStaffMonthSummaries(data, monthKey).filter((row) => idSet.has(row.staffId))
}

export function printStaffSalaryReport(data: AppData, monthKey: SalaryMonthKey): void {
  const summaries = buildStaffMonthSummaries(data, monthKey)
  const overview = buildStaffOverview(data, monthKey)
  const exportedAt = formatExportedAt()
  const html = buildStaffSalaryReportHtml(monthKey, overview, summaries, exportedAt)
  printHtmlReport(html)
}

export function printStaffMemberSalaryReport(
  data: AppData,
  monthKey: SalaryMonthKey,
  staffId: string,
): void {
  const summaries = summariesForStaffIds(data, monthKey, [staffId])
  const name = summaries[0]?.name
  printStaffSalaryReportForSummaries(monthKey, summaries, name ? `${name} only` : '1 selected')
}

export function printSelectedStaffSalaryReports(
  data: AppData,
  monthKey: SalaryMonthKey,
  staffIds: string[],
): void {
  const summaries = summariesForStaffIds(data, monthKey, staffIds)
  const scopeLabel =
    summaries.length === 1
      ? `${summaries[0]?.name ?? '1 staff'} only`
      : `${summaries.length} selected`
  printStaffSalaryReportForSummaries(monthKey, summaries, scopeLabel)
}
