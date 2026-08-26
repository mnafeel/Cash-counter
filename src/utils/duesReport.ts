import type { AppData } from '../types'
import {
  buildCustomerSummaries,
  filterCustomersWithCredit,
  type CustomerPurchaseRow,
  type CustomerSummary,
} from './customerLedger'
import {
  buildChequeCustomerSummaries,
  filterCustomersWithCheque,
  type ChequeCustomerSummary,
  type ChequePurchaseRow,
} from './chequeLedger'
import { formatMoney, formatReportDate, formatReportTime } from './format'
import { printHtmlReport } from './printHtmlReport'

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
    margin: 16px 0 6px;
    font-size: 13px;
    page-break-after: avoid;
  }
  .meta { margin: 0 0 12px; color: #555; font-size: 10px; }
  .summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 0 0 14px;
  }
  .summary-card {
    padding: 8px 10px;
    border: 1px solid #ccc;
    border-radius: 6px;
    background: #fafafa;
  }
  .summary-card span {
    display: block;
    font-size: 9px;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 3px;
  }
  .summary-card strong {
    font-size: 15px;
    color: #111;
  }
  .party {
    margin: 0 0 14px;
    padding-bottom: 8px;
    border-bottom: 1px solid #ddd;
    page-break-inside: avoid;
  }
  .party-head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: baseline;
    margin: 0 0 4px;
  }
  .party-head h2 { margin: 0; }
  .party-due {
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
  }
  .party-meta {
    margin: 0 0 6px;
    color: #555;
    font-size: 10px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  th, td {
    border: 1px solid #ccc;
    padding: 5px 6px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #eee;
    font-weight: 700;
  }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .muted { color: #666; font-size: 9px; }
  .total-row td {
    font-weight: 700;
    background: #f3f3f3;
  }
  @media print {
    body { margin: 10mm; }
    .summary, .party { break-inside: avoid; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
  }
`

export type DuesReportKind = 'credit' | 'cheque'

function escapeHtml(value: string | number | undefined | null): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function exportedAtLabel(iso = new Date().toISOString()): string {
  return `${formatReportDate(iso)} ${formatReportTime(iso)}`
}

function billCountLabel(count: number): string {
  return `${count} bill${count === 1 ? '' : 's'}`
}

function creditBillRows(bills: CustomerPurchaseRow[]): string {
  return bills
    .map(
      (bill, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(bill.billDateLabel)}<div class="muted">${escapeHtml(bill.dateLabel)}</div></td>
        <td class="num">${escapeHtml(formatMoney(bill.billAmount))}</td>
        <td class="num">${escapeHtml(formatMoney(bill.paidAmount))}</td>
        <td class="num">${escapeHtml(formatMoney(bill.creditPending))}</td>
        <td>${escapeHtml(bill.payDetail)}${
          bill.paidBreakdown ? `<div class="muted">${escapeHtml(bill.paidBreakdown)}</div>` : ''
        }</td>
      </tr>`,
    )
    .join('')
}

function chequeBillRows(bills: ChequePurchaseRow[]): string {
  return bills
    .map(
      (bill, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(bill.billDateLabel)}<div class="muted">${escapeHtml(bill.dateLabel)}</div></td>
        <td class="num">${escapeHtml(formatMoney(bill.billAmount))}</td>
        <td class="num">${escapeHtml(formatMoney(bill.paidAmount))}</td>
        <td class="num">${escapeHtml(formatMoney(bill.chequePending))}</td>
        <td>${escapeHtml(bill.payDetail)}${
          bill.paidBreakdown ? `<div class="muted">${escapeHtml(bill.paidBreakdown)}</div>` : ''
        }</td>
      </tr>`,
    )
    .join('')
}

function creditPartySection(summary: CustomerSummary): string {
  const bills = summary.creditBills
  if (bills.length === 0) return ''
  return `<section class="party">
    <div class="party-head">
      <h2>${escapeHtml(summary.name)}</h2>
      <span class="party-due">${escapeHtml(formatMoney(summary.totalCreditPending))}</span>
    </div>
    <p class="party-meta">${billCountLabel(bills.length)} open · Bill total ${escapeHtml(formatMoney(summary.totalBillAmount))} · Paid ${escapeHtml(formatMoney(summary.totalPaid))}</p>
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Bill date</th>
          <th class="num">Bill amount</th>
          <th class="num">Paid</th>
          <th class="num">Credit due</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        ${creditBillRows(bills)}
        <tr class="total-row">
          <td colspan="4">Party total due</td>
          <td class="num">${escapeHtml(formatMoney(summary.totalCreditPending))}</td>
          <td>${billCountLabel(bills.length)}</td>
        </tr>
      </tbody>
    </table>
  </section>`
}

function chequePartySection(summary: ChequeCustomerSummary): string {
  const bills = summary.chequeBills
  if (bills.length === 0) return ''
  return `<section class="party">
    <div class="party-head">
      <h2>${escapeHtml(summary.name)}</h2>
      <span class="party-due">${escapeHtml(formatMoney(summary.totalChequePending))}</span>
    </div>
    <p class="party-meta">${billCountLabel(bills.length)} open · Bill total ${escapeHtml(formatMoney(summary.totalBillAmount))} · Paid ${escapeHtml(formatMoney(summary.totalPaid))}</p>
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Bill date</th>
          <th class="num">Bill amount</th>
          <th class="num">Paid</th>
          <th class="num">Cheque due</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        ${chequeBillRows(bills)}
        <tr class="total-row">
          <td colspan="4">Party total due</td>
          <td class="num">${escapeHtml(formatMoney(summary.totalChequePending))}</td>
          <td>${billCountLabel(bills.length)}</td>
        </tr>
      </tbody>
    </table>
  </section>`
}

function wrapReportHtml(title: string, meta: string, summaryHtml: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${REPORT_STYLES}</style>
</head>
<body>
  <h1>Shalimar Fashions · Cash Counter</h1>
  <p class="meta">${escapeHtml(meta)}</p>
  ${summaryHtml}
  ${bodyHtml}
</body>
</html>`
}

function creditSummariesForReport(data: AppData, customerName?: string): CustomerSummary[] {
  const all = filterCustomersWithCredit(buildCustomerSummaries(data))
  if (!customerName?.trim()) return all
  const key = customerName.trim().toLowerCase()
  return all.filter((summary) => summary.name.trim().toLowerCase() === key)
}

function chequeSummariesForReport(data: AppData, customerName?: string): ChequeCustomerSummary[] {
  const all = filterCustomersWithCheque(buildChequeCustomerSummaries(data))
  if (!customerName?.trim()) return all
  const key = customerName.trim().toLowerCase()
  return all.filter((summary) => summary.name.trim().toLowerCase() === key)
}

export function buildCreditDuesReportHtml(data: AppData, customerName?: string): string {
  const parties = creditSummariesForReport(data, customerName)
  const totalPending = parties.reduce((sum, party) => sum + party.totalCreditPending, 0)
  const openBillCount = parties.reduce((sum, party) => sum + party.openCreditCount, 0)
  const scope = customerName?.trim()
    ? `Party ${customerName.trim()}`
    : 'All parties with open credit'
  const title = scope.startsWith('Party')
    ? `Credit Due · ${customerName!.trim()}`
    : 'Credit Due Report'
  const summaryHtml = `<div class="summary">
    <div class="summary-card"><span>Total credit due</span><strong>${escapeHtml(formatMoney(totalPending))}</strong></div>
    <div class="summary-card"><span>Parties</span><strong>${parties.length}</strong></div>
    <div class="summary-card"><span>Open bills</span><strong>${openBillCount}</strong></div>
  </div>`
  const bodyHtml =
    parties.length === 0
      ? '<p class="muted">No open credit dues.</p>'
      : parties.map(creditPartySection).join('')

  return wrapReportHtml(
    title,
    `${title} · ${scope} · Exported ${exportedAtLabel()}`,
    summaryHtml,
    bodyHtml,
  )
}

export function buildChequeDuesReportHtml(data: AppData, customerName?: string): string {
  const parties = chequeSummariesForReport(data, customerName)
  const totalPending = parties.reduce((sum, party) => sum + party.totalChequePending, 0)
  const openBillCount = parties.reduce((sum, party) => sum + party.openChequeCount, 0)
  const scope = customerName?.trim()
    ? `Party ${customerName.trim()}`
    : 'All parties with open cheque'
  const title = scope.startsWith('Party')
    ? `Cheque Due · ${customerName!.trim()}`
    : 'Cheque Due Report'
  const summaryHtml = `<div class="summary">
    <div class="summary-card"><span>Total cheque due</span><strong>${escapeHtml(formatMoney(totalPending))}</strong></div>
    <div class="summary-card"><span>Parties</span><strong>${parties.length}</strong></div>
    <div class="summary-card"><span>Open bills</span><strong>${openBillCount}</strong></div>
  </div>`
  const bodyHtml =
    parties.length === 0
      ? '<p class="muted">No open cheque dues.</p>'
      : parties.map(chequePartySection).join('')

  return wrapReportHtml(
    title,
    `${title} · ${scope} · Exported ${exportedAtLabel()}`,
    summaryHtml,
    bodyHtml,
  )
}

/** Print / Save as PDF — all open credit dues, or one party when customerName is set. */
export function printCreditDuesReport(data: AppData, customerName?: string): void {
  printHtmlReport(buildCreditDuesReportHtml(data, customerName))
}

/** Print / Save as PDF — all open cheque dues, or one party when customerName is set. */
export function printChequeDuesReport(data: AppData, customerName?: string): void {
  printHtmlReport(buildChequeDuesReportHtml(data, customerName))
}
