import type { AppData } from '../types'
import {
  buildCashActivityItems,
  cashClosingLabel,
  cashOpeningLabel,
  getCashClosingBalance,
  getCashOpeningBalance,
  matchesCashDateFilter,
  summarizeCashActivity,
  type CashActivityItem,
} from './cashActivity'
import {
  bankClosingLabel,
  bankOpeningLabel,
  buildBankActivityItems,
  getBankClosingBalance,
  getBankOpeningBalance,
  summarizeBankActivity,
} from './bankActivity'
import {
  buildNormalExpenseHistoryItems,
  filterNormalExpenseHistoryItems,
  summarizeNormalExpenses,
  type NormalExpenseHistoryItem,
} from './normalExpenseHistory'
import { buildDailyTotals } from './dailyTotals'
import { buildSalesBillList, summarizeSalesBillRows } from './salesReport'
import { formatMoney } from './format'

export type DailyReportKind = 'cash' | 'bank' | 'expense'

export interface DailyReportInput {
  data: AppData
  selectedDate: string
  currentCash: number
  currentBank: number
  exportedAt?: string
}

export interface DailyReportCounts {
  cash: number
  bank: number
  expense: number
}

export interface DailySummaryAmountRow {
  label: string
  amount: number
  isTotal?: boolean
  isSales?: boolean
}

export interface DailySummaryTable {
  dateLabel: string
  rows: DailySummaryAmountRow[]
}

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
    margin: 20px 0 8px;
    font-size: 14px;
    page-break-after: avoid;
  }
  h2:first-of-type { margin-top: 0; }
  .meta { margin: 0 0 12px; color: #555; font-size: 10px; }
  .balances {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 16px;
    margin: 0 0 16px;
    padding: 10px 12px;
    border: 1px solid #ccc;
    border-radius: 6px;
    background: #f8f8f8;
  }
  .balances dt { margin: 0; font-weight: 600; color: #444; }
  .balances dd { margin: 0 0 6px; font-size: 13px; font-weight: 700; }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    margin: 0 0 16px;
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: #fafafa;
    font-size: 11px;
  }
  .summary span { white-space: nowrap; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 16px;
  }
  th, td {
    border: 1px solid #ccc;
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
  }
  th { background: #eee; font-size: 10px; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tr.total-row td, tr.total-row th {
    font-weight: 700;
    background: #f0f0f0;
  }
  tr.sales-row td:first-child {
    padding-top: 10px;
  }
  .summary-amount-table {
    max-width: 360px;
  }
  .summary-amount-table td:last-child,
  .summary-amount-table th:last-child {
    width: 45%;
  }
  @media print {
    body { margin: 0; }
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

function escapeCsv(value: string | number | undefined | null): string {
  const str = String(value ?? '')
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

function formatReportTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(iso))
}

function formatSelectedDateLabel(selectedDate: string): string {
  const [y, m, d] = selectedDate.split('-').map(Number)
  if (!y || !m || !d) return selectedDate
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(y, m - 1, d))
}

function dailyCashItems(data: AppData, selectedDate: string): CashActivityItem[] {
  return buildCashActivityItems(data)
    .filter((item) => matchesCashDateFilter(item.date, 'date', selectedDate))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

function dailyBankItems(data: AppData, selectedDate: string): CashActivityItem[] {
  return buildBankActivityItems(data)
    .filter((item) => matchesCashDateFilter(item.date, 'date', selectedDate))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

function dailyExpenseItems(data: AppData, selectedDate: string): NormalExpenseHistoryItem[] {
  return filterNormalExpenseHistoryItems(
    buildNormalExpenseHistoryItems(data),
    'date',
    selectedDate,
  ).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

function downloadCsvFile(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
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

function activityTableRows(items: CashActivityItem[]): string {
  return items
    .map(
      (item, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(formatReportTime(item.date))}</td>
        <td>${escapeHtml(item.label)}</td>
        <td>${escapeHtml(item.name ?? '—')}</td>
        <td>${escapeHtml(item.direction === 'in' ? 'In' : 'Out')}</td>
        <td class="num">${escapeHtml(formatMoney(item.amount))}</td>
      </tr>`,
    )
    .join('')
}

function expenseTableRows(items: NormalExpenseHistoryItem[]): string {
  return items
    .map(
      (item, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(formatReportTime(item.date))}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.payLabel)}</td>
        <td class="num">${escapeHtml(formatMoney(item.amount))}</td>
        <td>${escapeHtml(item.payDetail)}</td>
      </tr>`,
    )
    .join('')
}

function reportShell(title: string, body: string): string {
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

function buildCashSectionHtml(input: DailyReportInput): string {
  const { data, selectedDate, currentCash } = input
  const items = dailyCashItems(data, selectedDate)
  const summary = summarizeCashActivity(items)
  const opening = getCashOpeningBalance(data, currentCash, 'date', selectedDate)
  const closing = getCashClosingBalance(data, currentCash, 'date', selectedDate)

  return `
  <h2>Cash Statement</h2>
  <dl class="balances">
    <dt>${escapeHtml(cashOpeningLabel('date'))}</dt><dd>${escapeHtml(formatMoney(opening))}</dd>
    <dt>${escapeHtml(cashClosingLabel('date'))}</dt><dd>${escapeHtml(formatMoney(closing))}</dd>
  </dl>
  <div class="summary">
    <span>In <strong>${escapeHtml(formatMoney(summary.cashIn))}</strong></span>
    <span>Out <strong>${escapeHtml(formatMoney(summary.cashOut))}</strong></span>
    <span>Net <strong>${escapeHtml(formatMoney(summary.net))}</strong></span>
    <span>${items.length} items · time order</span>
  </div>
  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Time</th>
        <th>Activity</th>
        <th>Name</th>
        <th>Direction</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${activityTableRows(items) || '<tr><td colspan="6">No cash activity on this date.</td></tr>'}
    </tbody>
  </table>`
}

function buildBankSectionHtml(input: DailyReportInput): string {
  const { data, selectedDate, currentBank } = input
  const items = dailyBankItems(data, selectedDate)
  const summary = summarizeBankActivity(items)
  const opening = getBankOpeningBalance(data, currentBank, 'date', selectedDate)
  const closing = getBankClosingBalance(data, currentBank, 'date', selectedDate)

  return `
  <h2>Bank Statement</h2>
  <dl class="balances">
    <dt>${escapeHtml(bankOpeningLabel('date'))}</dt><dd>${escapeHtml(formatMoney(opening))}</dd>
    <dt>${escapeHtml(bankClosingLabel('date'))}</dt><dd>${escapeHtml(formatMoney(closing))}</dd>
  </dl>
  <div class="summary">
    <span>In <strong>${escapeHtml(formatMoney(summary.bankIn))}</strong></span>
    <span>Out <strong>${escapeHtml(formatMoney(summary.bankOut))}</strong></span>
    <span>Net <strong>${escapeHtml(formatMoney(summary.net))}</strong></span>
    <span>${items.length} items · time order</span>
  </div>
  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Time</th>
        <th>Activity</th>
        <th>Name</th>
        <th>Direction</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${activityTableRows(items) || '<tr><td colspan="6">No bank activity on this date.</td></tr>'}
    </tbody>
  </table>`
}

function buildExpenseSectionHtml(input: DailyReportInput): string {
  const { data, selectedDate } = input
  const items = dailyExpenseItems(data, selectedDate)
  const summary = summarizeNormalExpenses(items)

  return `
  <h2>Expense Statement</h2>
  <div class="summary">
    <span>Total <strong>${escapeHtml(formatMoney(summary.total))}</strong></span>
    <span>Count <strong>${summary.count}</strong></span>
    <span>time order</span>
  </div>
  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Time</th>
        <th>Name</th>
        <th>Payment</th>
        <th class="num">Amount</th>
        <th>Details</th>
      </tr>
    </thead>
    <tbody>
      ${expenseTableRows(items) || '<tr><td colspan="6">No expenses on this date.</td></tr>'}
    </tbody>
  </table>`
}

function buildCashReportHtml(input: DailyReportInput): string {
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const dateLabel = formatSelectedDateLabel(input.selectedDate)
  const items = dailyCashItems(input.data, input.selectedDate)

  const body = `
  <p class="meta">Cash Report · ${escapeHtml(dateLabel)} · Exported ${escapeHtml(formatSelectedDateLabel(exportedAt.slice(0, 10)))} ${escapeHtml(formatReportTime(exportedAt))} · ${items.length} items</p>
  ${buildCashSectionHtml(input)}`

  return reportShell(`Cash Counter · Cash Report · ${dateLabel}`, body)
}

function buildBankReportHtml(input: DailyReportInput): string {
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const dateLabel = formatSelectedDateLabel(input.selectedDate)
  const items = dailyBankItems(input.data, input.selectedDate)

  const body = `
  <p class="meta">Bank Report · ${escapeHtml(dateLabel)} · Exported ${escapeHtml(formatSelectedDateLabel(exportedAt.slice(0, 10)))} ${escapeHtml(formatReportTime(exportedAt))} · ${items.length} items</p>
  ${buildBankSectionHtml(input)}`

  return reportShell(`Cash Counter · Bank Report · ${dateLabel}`, body)
}

function buildExpenseReportHtml(input: DailyReportInput): string {
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const dateLabel = formatSelectedDateLabel(input.selectedDate)
  const items = dailyExpenseItems(input.data, input.selectedDate)

  const body = `
  <p class="meta">Expense Report · ${escapeHtml(dateLabel)} · Exported ${escapeHtml(formatSelectedDateLabel(exportedAt.slice(0, 10)))} ${escapeHtml(formatReportTime(exportedAt))} · ${items.length} items</p>
  ${buildExpenseSectionHtml(input)}`

  return reportShell(`Cash Counter · Expense Report · ${dateLabel}`, body)
}

function buildCombinedDailyReportHtml(input: DailyReportInput): string {
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const dateLabel = formatSelectedDateLabel(input.selectedDate)
  const counts = getDailyReportCounts(input)
  const totalItems = counts.cash + counts.bank + counts.expense

  const body = `
  <p class="meta">Daily Statement · ${escapeHtml(dateLabel)} · Cash, then bank, then expense · time order · Exported ${escapeHtml(formatSelectedDateLabel(exportedAt.slice(0, 10)))} ${escapeHtml(formatReportTime(exportedAt))} · ${totalItems} items</p>
  ${buildCashSectionHtml(input)}
  ${buildBankSectionHtml(input)}
  ${buildExpenseSectionHtml(input)}`

  return reportShell(`Cash Counter · Daily Statement · ${dateLabel}`, body)
}

function buildCashReportCsv(input: DailyReportInput): string {
  const { data, selectedDate, currentCash } = input
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const items = dailyCashItems(data, selectedDate)
  const summary = summarizeCashActivity(items)
  const opening = getCashOpeningBalance(data, currentCash, 'date', selectedDate)
  const closing = getCashClosingBalance(data, currentCash, 'date', selectedDate)
  const dateLabel = formatSelectedDateLabel(selectedDate)

  const lines: string[] = []
  lines.push('Shalimar Fashions · Cash Counter · Cash Report')
  lines.push(`Date,${escapeCsv(dateLabel)}`)
  lines.push(
    `Exported,${escapeCsv(formatSelectedDateLabel(exportedAt.slice(0, 10)))},${escapeCsv(formatReportTime(exportedAt))}`,
  )
  lines.push(`${escapeCsv(cashOpeningLabel('date'))},${opening}`)
  lines.push(`${escapeCsv(cashClosingLabel('date'))},${closing}`)
  lines.push(`Cash In,${summary.cashIn}`)
  lines.push(`Cash Out,${summary.cashOut}`)
  lines.push(`Net,${summary.net}`)
  lines.push(`Items,${items.length}`)
  lines.push('')
  lines.push(['No', 'Time', 'Activity', 'Name', 'Direction', 'Amount'].map(escapeCsv).join(','))
  for (const [index, item] of items.entries()) {
    lines.push(
      [
        index + 1,
        formatReportTime(item.date),
        item.label,
        item.name ?? '',
        item.direction === 'in' ? 'In' : 'Out',
        item.amount,
      ]
        .map(escapeCsv)
        .join(','),
    )
  }
  return `\uFEFF${lines.join('\n')}`
}

function buildBankReportCsv(input: DailyReportInput): string {
  const { data, selectedDate, currentBank } = input
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const items = dailyBankItems(data, selectedDate)
  const summary = summarizeBankActivity(items)
  const opening = getBankOpeningBalance(data, currentBank, 'date', selectedDate)
  const closing = getBankClosingBalance(data, currentBank, 'date', selectedDate)
  const dateLabel = formatSelectedDateLabel(selectedDate)

  const lines: string[] = []
  lines.push('Shalimar Fashions · Cash Counter · Bank Report')
  lines.push(`Date,${escapeCsv(dateLabel)}`)
  lines.push(
    `Exported,${escapeCsv(formatSelectedDateLabel(exportedAt.slice(0, 10)))},${escapeCsv(formatReportTime(exportedAt))}`,
  )
  lines.push(`${escapeCsv(bankOpeningLabel('date'))},${opening}`)
  lines.push(`${escapeCsv(bankClosingLabel('date'))},${closing}`)
  lines.push(`Bank In,${summary.bankIn}`)
  lines.push(`Bank Out,${summary.bankOut}`)
  lines.push(`Net,${summary.net}`)
  lines.push(`Items,${items.length}`)
  lines.push('')
  lines.push(['No', 'Time', 'Activity', 'Name', 'Direction', 'Amount'].map(escapeCsv).join(','))
  for (const [index, item] of items.entries()) {
    lines.push(
      [
        index + 1,
        formatReportTime(item.date),
        item.label,
        item.name ?? '',
        item.direction === 'in' ? 'In' : 'Out',
        item.amount,
      ]
        .map(escapeCsv)
        .join(','),
    )
  }
  return `\uFEFF${lines.join('\n')}`
}

function buildExpenseReportCsv(input: DailyReportInput): string {
  const { data, selectedDate } = input
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const items = dailyExpenseItems(data, selectedDate)
  const summary = summarizeNormalExpenses(items)
  const dateLabel = formatSelectedDateLabel(selectedDate)

  const lines: string[] = []
  lines.push('Shalimar Fashions · Cash Counter · Expense Report')
  lines.push(`Date,${escapeCsv(dateLabel)}`)
  lines.push(
    `Exported,${escapeCsv(formatSelectedDateLabel(exportedAt.slice(0, 10)))},${escapeCsv(formatReportTime(exportedAt))}`,
  )
  lines.push(`Total,${summary.total}`)
  lines.push(`Count,${summary.count}`)
  lines.push('')
  lines.push(['No', 'Time', 'Name', 'Payment', 'Amount', 'Details'].map(escapeCsv).join(','))
  for (const [index, item] of items.entries()) {
    lines.push(
      [
        index + 1,
        formatReportTime(item.date),
        item.name,
        item.payLabel,
        item.amount,
        item.payDetail.replace(/\s+/g, ' ').trim(),
      ]
        .map(escapeCsv)
        .join(','),
    )
  }
  return `\uFEFF${lines.join('\n')}`
}

function buildCombinedDailyReportCsv(input: DailyReportInput): string {
  const cashCsv = buildCashReportCsv(input).replace(/^\uFEFF/, '')
  const bankCsv = buildBankReportCsv(input).replace(/^\uFEFF/, '')
  const expenseCsv = buildExpenseReportCsv(input).replace(/^\uFEFF/, '')
  return `\uFEFF${[cashCsv, bankCsv, expenseCsv].join('\n\n')}`
}

export function buildDailySummaryTable(input: DailyReportInput): DailySummaryTable {
  const { data, selectedDate } = input
  const cashSummary = summarizeCashActivity(dailyCashItems(data, selectedDate))
  const bankSummary = summarizeBankActivity(dailyBankItems(data, selectedDate))
  const expenseSummary = summarizeNormalExpenses(dailyExpenseItems(data, selectedDate))
  const dailyTotals = buildDailyTotals(data, selectedDate, selectedDate)
  const salesSummary = summarizeSalesBillRows(
    buildSalesBillList(data, 'date-desc', {
      fromDate: selectedDate,
      toDate: selectedDate,
      dateMode: 'collected',
    }),
  )

  const cashAmount = cashSummary.net
  const bankAmount = bankSummary.net
  const expenseAmount = expenseSummary.total
  const allTotal = cashAmount + bankAmount - expenseAmount
  const withCreditSale = salesSummary.withCreditSales + dailyTotals.creditAddedInPeriod
  const withoutCreditSale = salesSummary.totalBills

  const rows: DailySummaryAmountRow[] = [
    { label: 'Cash', amount: cashAmount },
    { label: 'Bank', amount: bankAmount },
    { label: 'Expense', amount: expenseAmount },
    { label: 'All Total', amount: allTotal, isTotal: true },
    { label: 'With credit sale', amount: withCreditSale, isSales: true },
    { label: 'Without credit sale', amount: withoutCreditSale, isSales: true },
  ]

  return {
    dateLabel: formatSelectedDateLabel(selectedDate),
    rows,
  }
}

function summaryAmountTableHtmlRows(rows: DailySummaryAmountRow[]): string {
  return rows
    .map(
      (row) => `<tr class="${row.isTotal ? 'total-row' : ''}${row.isSales ? ' sales-row' : ''}">
        <td>${escapeHtml(row.label)}</td>
        <td class="num">${escapeHtml(formatMoney(row.amount))}</td>
      </tr>`,
    )
    .join('')
}

function buildDailySummaryReportHtml(input: DailyReportInput): string {
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const summary = buildDailySummaryTable(input)

  const body = `
  <p class="meta">Daily Summary · ${escapeHtml(summary.dateLabel)} · Exported ${escapeHtml(formatSelectedDateLabel(exportedAt.slice(0, 10)))} ${escapeHtml(formatReportTime(exportedAt))}</p>
  <table class="summary-amount-table">
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${summaryAmountTableHtmlRows(summary.rows)}
    </tbody>
  </table>`

  return reportShell(`Cash Counter · Daily Summary · ${summary.dateLabel}`, body)
}

function buildDailySummaryReportCsv(input: DailyReportInput): string {
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const summary = buildDailySummaryTable(input)

  const lines: string[] = []
  lines.push('Shalimar Fashions · Cash Counter · Daily Summary')
  lines.push(`Date,${escapeCsv(summary.dateLabel)}`)
  lines.push(
    `Exported,${escapeCsv(formatSelectedDateLabel(exportedAt.slice(0, 10)))},${escapeCsv(formatReportTime(exportedAt))}`,
  )
  lines.push('')
  lines.push(['Description', 'Amount'].map(escapeCsv).join(','))
  for (const row of summary.rows) {
    lines.push([row.label, row.amount].map(escapeCsv).join(','))
  }
  return `\uFEFF${lines.join('\n')}`
}

export function getDailyReportCounts(
  input: Pick<DailyReportInput, 'data' | 'selectedDate'>,
): DailyReportCounts {
  const { data, selectedDate } = input
  if (!selectedDate) return { cash: 0, bank: 0, expense: 0 }

  const cash = dailyCashItems(data, selectedDate).length
  const bank = dailyBankItems(data, selectedDate).length
  const expense = dailyExpenseItems(data, selectedDate).length

  return { cash, bank, expense }
}

export function printCombinedDailyReportPdf(input: DailyReportInput): void {
  printHtmlReport(buildCombinedDailyReportHtml(input))
}

export function downloadCombinedDailyReportSpreadsheet(input: DailyReportInput): void {
  downloadCsvFile(
    buildCombinedDailyReportCsv(input),
    `cash-counter-daily-statement-${input.selectedDate}.csv`,
  )
}

export function printDailySummaryReportPdf(input: DailyReportInput): void {
  printHtmlReport(buildDailySummaryReportHtml(input))
}

export function downloadDailySummaryReportSpreadsheet(input: DailyReportInput): void {
  downloadCsvFile(
    buildDailySummaryReportCsv(input),
    `cash-counter-daily-summary-${input.selectedDate}.csv`,
  )
}

export function printDailyReportPdf(input: DailyReportInput, kind: DailyReportKind): void {
  const html =
    kind === 'cash'
      ? buildCashReportHtml(input)
      : kind === 'bank'
        ? buildBankReportHtml(input)
        : buildExpenseReportHtml(input)
  printHtmlReport(html)
}

export function downloadDailyReportSpreadsheet(
  input: DailyReportInput,
  kind: DailyReportKind,
): void {
  const csv =
    kind === 'cash'
      ? buildCashReportCsv(input)
      : kind === 'bank'
        ? buildBankReportCsv(input)
        : buildExpenseReportCsv(input)
  downloadCsvFile(csv, `cash-counter-${kind}-${input.selectedDate}.csv`)
}
