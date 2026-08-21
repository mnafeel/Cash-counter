import type { AppData } from '../types'
import { NO1_BILL_LABEL, NO2_BILL_LABEL } from './expenseBillLabels'
import { formatDate, formatMoney, formatReportDate, formatReportTime } from './format'
import { printHtmlReport } from './printHtmlReport'
import {
  summarizeSupplierPurchaseFile,
  type PurchaseHistoryItem,
} from './purchaseHistory'

export type PurchaseReportMode = 'credit' | 'full'

export interface PurchaseReportOptions {
  /** Screen title, e.g. supplier name or "All suppliers" */
  scopeLabel: string
  periodLabel: string
  mode: PurchaseReportMode
  items: PurchaseHistoryItem[]
  data: AppData
  /** When set, report is for one supplier (no supplier column). */
  supplierName?: string
}

const REPORT_STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 11px;
    line-height: 1.35;
    color: #1a1a1a;
    margin: 16px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 { margin: 0 0 4px; font-size: 18px; }
  h2 { margin: 16px 0 8px; font-size: 13px; page-break-after: avoid; }
  .meta { margin: 0 0 12px; color: #555; font-size: 10px; }
  .summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin: 0 0 14px;
  }
  .summary-card {
    padding: 8px 10px;
    border: 1px solid #ccc;
    border-radius: 6px;
    background: #f7f7f7;
  }
  .summary-card span {
    display: block;
    font-size: 9px;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 3px;
  }
  .summary-card strong { font-size: 14px; color: #111; }
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
  th { background: #eee; font-weight: 700; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .muted { color: #666; font-size: 9px; }
  .section-break { margin-top: 18px; page-break-before: auto; }
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

export function isPurchaseCreditDueItem(item: PurchaseHistoryItem): boolean {
  const pending = Math.max(0, item.amount - item.paidAmount)
  return Boolean(item.hasOpenCredit) || pending > 0
}

export function filterPurchaseReportItems(
  items: PurchaseHistoryItem[],
  mode: PurchaseReportMode,
): PurchaseHistoryItem[] {
  if (mode === 'full') return items
  return items.filter(isPurchaseCreditDueItem)
}

function creditDueAmount(item: PurchaseHistoryItem): number {
  if (item.hasOpenCredit && (item.openCreditAmount ?? 0) > 0) {
    return item.openCreditAmount ?? 0
  }
  return Math.max(0, item.amount - item.paidAmount)
}

function sortOldestFirst(items: PurchaseHistoryItem[]): PurchaseHistoryItem[] {
  return [...items].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id.localeCompare(b.id),
  )
}

function groupBySupplier(items: PurchaseHistoryItem[]): { name: string; items: PurchaseHistoryItem[] }[] {
  const map = new Map<string, { name: string; items: PurchaseHistoryItem[] }>()
  for (const item of items) {
    const key = item.shopName.trim().toLowerCase() || 'unknown'
    let entry = map.get(key)
    if (!entry) {
      entry = { name: item.shopName.trim() || 'Unknown supplier', items: [] }
      map.set(key, entry)
    }
    entry.items.push(item)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function buildRowsHtml(
  items: PurchaseHistoryItem[],
  mode: PurchaseReportMode,
  includeSupplier: boolean,
): string {
  const sorted = sortOldestFirst(items)
  return sorted
    .map((item, index) => {
      const pending = creditDueAmount(item)
      const title = item.description?.trim() || item.shopName || 'Purchase'
      const status =
        mode === 'credit'
          ? `Credit due ${formatMoney(pending)}`
          : pending > 0
            ? `Paid ${formatMoney(item.paidAmount)} · Due ${formatMoney(pending)}`
            : `Paid ${formatMoney(item.paidAmount)}`
      return `<tr>
        <td class="num">${index + 1}</td>
        <td>${escapeHtml(formatDate(item.date))}</td>
        ${includeSupplier ? `<td>${escapeHtml(item.shopName)}</td>` : ''}
        <td>${escapeHtml(title)}${
          item.billNo ? `<div class="muted">Bill ${escapeHtml(item.billNo)}</div>` : ''
        }<div class="muted">${escapeHtml(item.billLabel)} · ${escapeHtml(item.payLabel)}</div></td>
        <td class="num">${escapeHtml(formatMoney(item.amount))}</td>
        <td class="num">${escapeHtml(formatMoney(item.paidAmount))}</td>
        <td class="num">${escapeHtml(formatMoney(pending))}</td>
        <td>${escapeHtml(status)}</td>
      </tr>`
    })
    .join('')
}

export function buildPurchaseHistoryReportHtml(options: PurchaseReportOptions): string {
  const { scopeLabel, periodLabel, mode, data, supplierName } = options
  const items = filterPurchaseReportItems(options.items, mode)
  const summary = summarizeSupplierPurchaseFile(data, items)
  const creditTotal = items.reduce((sum, item) => sum + creditDueAmount(item), 0)
  const paidTotal = summary.paidTotal
  const billTotal = summary.billTotal
  const exportedAt = new Date().toISOString()
  const modeLabel = mode === 'credit' ? 'Credit / dues only' : 'Full transaction history'
  const includeSupplier = !supplierName
  const heading = supplierName
    ? `Purchase ledger · ${supplierName}`
    : 'Purchase ledger · All suppliers'

  const tableHead = `<thead><tr>
    <th class="num">#</th>
    <th>Date</th>
    ${includeSupplier ? '<th>Supplier</th>' : ''}
    <th>Details</th>
    <th class="num">Bill</th>
    <th class="num">Paid</th>
    <th class="num">Credit due</th>
    <th>Status</th>
  </tr></thead>`

  let tablesHtml = ''
  if (includeSupplier) {
    const groups = groupBySupplier(items)
    if (groups.length === 0) {
      tablesHtml = '<p class="muted">No purchases in this period for the selected filter.</p>'
    } else {
      let runningIndex = 0
      tablesHtml = groups
        .map((group) => {
          const groupSummary = summarizeSupplierPurchaseFile(data, group.items)
          const groupCredit = group.items.reduce((sum, item) => sum + creditDueAmount(item), 0)
          const rows = sortOldestFirst(group.items)
            .map((item) => {
              runningIndex += 1
              const pending = creditDueAmount(item)
              const title = item.description?.trim() || item.shopName || 'Purchase'
              const status =
                mode === 'credit'
                  ? `Credit due ${formatMoney(pending)}`
                  : pending > 0
                    ? `Paid ${formatMoney(item.paidAmount)} · Due ${formatMoney(pending)}`
                    : `Paid ${formatMoney(item.paidAmount)}`
              return `<tr>
                <td class="num">${runningIndex}</td>
                <td>${escapeHtml(formatDate(item.date))}</td>
                <td>${escapeHtml(title)}${
                  item.billNo ? `<div class="muted">Bill ${escapeHtml(item.billNo)}</div>` : ''
                }<div class="muted">${escapeHtml(item.billLabel)} · ${escapeHtml(item.payLabel)}</div></td>
                <td class="num">${escapeHtml(formatMoney(item.amount))}</td>
                <td class="num">${escapeHtml(formatMoney(item.paidAmount))}</td>
                <td class="num">${escapeHtml(formatMoney(pending))}</td>
                <td>${escapeHtml(status)}</td>
              </tr>`
            })
            .join('')
          return `<section class="section-break">
            <h2>${escapeHtml(group.name)}</h2>
            <p class="meta">${group.items.length} bills · Paid ${escapeHtml(formatMoney(groupSummary.paidTotal))} · Credit ${escapeHtml(formatMoney(groupCredit))} · ${NO1_BILL_LABEL} ${escapeHtml(formatMoney(groupSummary.no1BillTotal))} · ${NO2_BILL_LABEL} ${escapeHtml(formatMoney(groupSummary.no2BillTotal))}</p>
            <table>
              <thead><tr>
                <th class="num">#</th>
                <th>Date</th>
                <th>Details</th>
                <th class="num">Bill</th>
                <th class="num">Paid</th>
                <th class="num">Credit due</th>
                <th>Status</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </section>`
        })
        .join('')
    }
  } else {
    tablesHtml =
      items.length === 0
        ? '<p class="muted">No purchases in this period for the selected filter.</p>'
        : `<table>${tableHead}<tbody>${buildRowsHtml(items, mode, false)}</tbody></table>`
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(heading)}</title>
  <style>${REPORT_STYLES}</style>
</head>
<body>
  <h1>Shalimar Fashions · Cash Counter</h1>
  <p class="meta">${escapeHtml(heading)} · ${escapeHtml(modeLabel)} · Period ${escapeHtml(periodLabel)} · Exported ${escapeHtml(formatReportDate(exportedAt))} ${escapeHtml(formatReportTime(exportedAt))}</p>
  <p class="meta">Scope: ${escapeHtml(scopeLabel)}</p>

  <div class="summary">
    <div class="summary-card">
      <span>Bills (#)</span>
      <strong>${items.length}</strong>
    </div>
    <div class="summary-card">
      <span>Total paid</span>
      <strong>${escapeHtml(formatMoney(paidTotal))}</strong>
    </div>
    <div class="summary-card">
      <span>Total credit</span>
      <strong>${escapeHtml(formatMoney(creditTotal))}</strong>
    </div>
    <div class="summary-card">
      <span>Bill total</span>
      <strong>${escapeHtml(formatMoney(billTotal))}</strong>
    </div>
  </div>

  ${tablesHtml}
</body>
</html>`
}

export function printPurchaseHistoryReport(options: PurchaseReportOptions): void {
  printHtmlReport(buildPurchaseHistoryReportHtml(options))
}
