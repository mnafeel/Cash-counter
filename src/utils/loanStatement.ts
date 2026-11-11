import type { AppData, Loan } from '../types'
import { formatDateInputDisplay, formatMoney, formatReportDate, formatReportTime, isoToDateInputValue } from './format'
import { loanSettlementEvents } from './loanLedger'
import { printHtmlReport } from './printHtmlReport'

export type LoanStatementLineKind =
  | 'loan-given'
  | 'payment-received'
  | 'loan-taken'
  | 'loan-returned'

export interface LoanStatementLine {
  id: string
  at: string
  dateLabel: string
  details: string
  kind: LoanStatementLineKind
  given: number
  received: number
  balanceAfter: number
}

export interface LoanStatement {
  personName: string
  fromDate: string
  fromDateLabel: string
  openingBalance: number
  lines: LoanStatementLine[]
  totalGiven: number
  totalReceived: number
  closingBalance: number
}

export function loanStatementOutstandingLabel(balance: number): string {
  if (balance > 0) return 'They owe you'
  if (balance < 0) return 'You owe them'
  return 'Settled'
}

export interface LoanPersonOption {
  personName: string
  loanCount: number
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function paySourceLabel(source: 'cash' | 'bank'): string {
  return source === 'bank' ? 'Bank' : 'Cash'
}

function startOfLocalDay(dateValue: string): number {
  const [year, month, day] = dateValue.split('-').map((part) => Number(part))
  if (!year || !month || !day) return Number.NaN
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
}

function eventTime(iso: string): number {
  const time = new Date(iso).getTime()
  return Number.isFinite(time) ? time : 0
}

function samePerson(name: string, query: string): boolean {
  return name.trim().toLowerCase() === query.trim().toLowerCase()
}

function fileSafeName(name: string): string {
  const cleaned = name.trim().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')
  return cleaned || 'loan-statement'
}

export function listLoanPeople(data: AppData): LoanPersonOption[] {
  const byPerson = new Map<string, LoanPersonOption>()
  for (const loan of data.loans ?? []) {
    const name = loan.personName.trim()
    if (!name) continue
    const key = name.toLowerCase()
    const existing = byPerson.get(key)
    if (existing) {
      existing.loanCount += 1
      continue
    }
    byPerson.set(key, { personName: name, loanCount: 1 })
  }
  return [...byPerson.values()].sort((a, b) => a.personName.localeCompare(b.personName))
}

export function searchLoanPeople(people: LoanPersonOption[], query: string): LoanPersonOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return people
  return people.filter((person) => person.personName.toLowerCase().includes(q))
}

function earliestLoanDate(loans: Loan[]): string {
  let earliest = Date.now()
  for (const loan of loans) {
    earliest = Math.min(earliest, eventTime(loan.createdAt))
    for (const event of loanSettlementEvents(loan)) {
      earliest = Math.min(earliest, eventTime(event.at))
    }
  }
  return isoToDateInputValue(new Date(earliest).toISOString())
}

export function defaultLoanStatementFromDate(data: AppData, personName: string): string {
  const loans = (data.loans ?? []).filter((loan) => samePerson(loan.personName, personName))
  if (loans.length === 0) return isoToDateInputValue(new Date().toISOString())
  return earliestLoanDate(loans)
}

function appendLoanEvents(
  loan: Loan,
  events: Array<{
    id: string
    at: string
    details: string
    kind: LoanStatementLineKind
    given: number
    received: number
    sort: number
  }>,
) {
  const source = paySourceLabel(loan.paySource)
  const note = loan.note?.trim()
  if (loan.kind === 'lend') {
    events.push({
      id: `${loan.id}-given`,
      at: loan.createdAt,
      details: note ? `Loan given · ${source} · ${note}` : `Loan given · ${source}`,
      kind: 'loan-given',
      given: loan.amount,
      received: 0,
      sort: eventTime(loan.createdAt),
    })
    for (const [index, event] of loanSettlementEvents(loan).entries()) {
      events.push({
        id: `${loan.id}-collected-${event.id ?? index}`,
        at: event.at,
        details: `Payment received · ${paySourceLabel(event.paySource)}`,
        kind: 'payment-received',
        given: 0,
        received: event.amount,
        sort: eventTime(event.at),
      })
    }
    return
  }

  events.push({
    id: `${loan.id}-taken`,
    at: loan.createdAt,
    details: note ? `Loan taken · ${source} · ${note}` : `Loan taken · ${source}`,
    kind: 'loan-taken',
    given: 0,
    received: loan.amount,
    sort: eventTime(loan.createdAt),
  })
  for (const [index, event] of loanSettlementEvents(loan).entries()) {
    events.push({
      id: `${loan.id}-returned-${event.id ?? index}`,
      at: event.at,
      details: `Loan returned · ${paySourceLabel(event.paySource)}`,
      kind: 'loan-returned',
      given: event.amount,
      received: 0,
      sort: eventTime(event.at),
    })
  }
}

export function buildLoanStatement(
  data: AppData,
  personName: string,
  fromDate: string,
): LoanStatement | null {
  const name = personName.trim()
  if (!name) return null
  const fromMs = startOfLocalDay(fromDate)
  if (!Number.isFinite(fromMs)) return null

  const loans = (data.loans ?? []).filter((loan) => samePerson(loan.personName, name))
  if (loans.length === 0) return null

  const events: Array<{
    id: string
    at: string
    details: string
    kind: LoanStatementLineKind
    given: number
    received: number
    sort: number
  }> = []
  for (const loan of loans) appendLoanEvents(loan, events)
  events.sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))

  let balance = 0
  let openingBalance = 0
  const lines: LoanStatementLine[] = []
  let totalGiven = 0
  let totalReceived = 0
  let openingCaptured = false

  for (const event of events) {
    const delta = event.given - event.received
    if (event.sort < fromMs) {
      balance = roundMoney(balance + delta)
      continue
    }
    if (!openingCaptured) {
      openingBalance = balance
      openingCaptured = true
    }
    balance = roundMoney(balance + delta)
    totalGiven = roundMoney(totalGiven + event.given)
    totalReceived = roundMoney(totalReceived + event.received)
    lines.push({
      id: event.id,
      at: event.at,
      dateLabel: formatReportDate(event.at),
      details: event.details,
      kind: event.kind,
      given: event.given,
      received: event.received,
      balanceAfter: balance,
    })
  }

  if (!openingCaptured) openingBalance = balance

  return {
    personName: loans[0]?.personName ?? name,
    fromDate,
    fromDateLabel: formatDateInputDisplay(fromDate),
    openingBalance,
    lines,
    totalGiven,
    totalReceived,
    closingBalance: balance,
  }
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
  .total-row td, .opening-row td {
    font-weight: 700;
    background: #f3f3f3;
  }
  @media print {
    body { margin: 10mm; }
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

function moneyOrDash(amount: number): string {
  return amount > 0 ? formatMoney(amount) : '—'
}

export function buildLoanStatementHtml(statement: LoanStatement): string {
  const title = `Loan statement · ${statement.personName}`
  const rows = statement.lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.dateLabel)}<div class="muted">${escapeHtml(formatReportTime(line.at))}</div></td>
        <td>${escapeHtml(line.details)}</td>
        <td class="num">${escapeHtml(moneyOrDash(line.given))}</td>
        <td class="num">${escapeHtml(moneyOrDash(line.received))}</td>
        <td class="num">${escapeHtml(formatMoney(line.balanceAfter))}</td>
      </tr>`,
    )
    .join('')

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
  <p class="meta">${escapeHtml(title)} · From ${escapeHtml(statement.fromDateLabel)} · Exported ${escapeHtml(formatReportDate(new Date().toISOString()))} ${escapeHtml(formatReportTime(new Date().toISOString()))}</p>
  <div class="summary">
    <div class="summary-card"><span>Total loan given</span><strong>${escapeHtml(formatMoney(statement.totalGiven))}</strong></div>
    <div class="summary-card"><span>Total payments</span><strong>${escapeHtml(formatMoney(statement.totalReceived))}</strong></div>
    <div class="summary-card"><span>Outstanding</span><strong>${escapeHtml(formatMoney(statement.closingBalance))}</strong><div class="muted">${escapeHtml(loanStatementOutstandingLabel(statement.closingBalance))}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Details</th>
        <th class="num">Loan given</th>
        <th class="num">Payment received</th>
        <th class="num">Balance</th>
      </tr>
    </thead>
    <tbody>
      <tr class="opening-row">
        <td colspan="4">Opening balance on ${escapeHtml(statement.fromDateLabel)}</td>
        <td class="num">${escapeHtml(formatMoney(statement.openingBalance))}</td>
      </tr>
      ${rows || '<tr><td colspan="5" class="muted">No transactions from this date.</td></tr>'}
      <tr class="total-row">
        <td colspan="2">Totals from ${escapeHtml(statement.fromDateLabel)}</td>
        <td class="num">${escapeHtml(formatMoney(statement.totalGiven))}</td>
        <td class="num">${escapeHtml(formatMoney(statement.totalReceived))}</td>
        <td class="num">${escapeHtml(formatMoney(statement.closingBalance))}</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`
}

export function printLoanStatement(statement: LoanStatement): void {
  printHtmlReport(buildLoanStatementHtml(statement), {
    pdfFileName: `loan-statement-${fileSafeName(statement.personName)}-${statement.fromDate}.pdf`,
  })
}
