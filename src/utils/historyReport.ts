import type { AppData } from '../types'
import { formatMoney } from './format'
import {
  buildHistoryItems,
  getHistoryPaymentLabel,
  getHistoryTypeLabel,
  type HistoryItem,
  type HistoryItemType,
} from './historyItems'

export interface HistoryReportMeta {
  exportedAt: string
  openingCash: number
  openingBank: number
  currentCash: number
  currentBank: number
}

function escapeCsv(value: string | number | undefined | null): string {
  const str = String(value ?? '')
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

function formatReportDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(iso))
}

function formatReportTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(iso))
}

function escapeHtml(value: string | number | undefined | null): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sortedHistoryItems(data: AppData): HistoryItem[] {
  return buildHistoryItems(data).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )
}

function historyRow(item: HistoryItem): string[] {
  return [
    formatReportDate(item.date),
    formatReportTime(item.date),
    getHistoryTypeLabel(item.type),
    item.name ?? '',
    String(item.amount),
    item.paymentMode ? getHistoryPaymentLabel(item.paymentMode) : '',
    item.sub.replace(/\s+/g, ' ').trim(),
  ]
}

function summarizeByType(items: HistoryItem[]) {
  const totals: Record<HistoryItemType, { count: number; sum: number }> = {
    sale: { count: 0, sum: 0 },
    expense: { count: 0, sum: 0 },
    deposit: { count: 0, sum: 0 },
    transfer: { count: 0, sum: 0 },
  }
  for (const item of items) {
    totals[item.type].count += 1
    totals[item.type].sum += item.amount
  }
  return totals
}

export function buildFullHistoryReportHtml(
  data: AppData,
  meta: HistoryReportMeta,
): string {
  const items = sortedHistoryItems(data)
  const summary = summarizeByType(items)
  const exportedDate = formatReportDate(meta.exportedAt)
  const exportedTime = formatReportTime(meta.exportedAt)

  const rows = items
    .map(
      (item) => `<tr>
        <td>${escapeHtml(formatReportDate(item.date))}</td>
        <td>${escapeHtml(formatReportTime(item.date))}</td>
        <td>${escapeHtml(getHistoryTypeLabel(item.type))}</td>
        <td>${escapeHtml(item.name ?? '—')}</td>
        <td class="num">${escapeHtml(formatMoney(item.amount))}</td>
        <td>${escapeHtml(item.paymentMode ? getHistoryPaymentLabel(item.paymentMode) : '—')}</td>
        <td>${escapeHtml(item.sub.replace(/\s+/g, ' ').trim())}</td>
      </tr>`,
    )
    .join('')

  const summaryRows = (['sale', 'expense', 'deposit', 'transfer'] as HistoryItemType[])
    .map((type) => {
      const row = summary[type]
      if (row.count === 0) return ''
      return `<tr>
        <td>${escapeHtml(getHistoryTypeLabel(type))}</td>
        <td class="num">${row.count}</td>
        <td class="num">${escapeHtml(formatMoney(row.sum))}</td>
      </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Cash Counter · Full History Report</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      font-size: 11px;
      line-height: 1.35;
      color: #1a1a1a;
      margin: 16px;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 18px;
    }
    .meta {
      margin: 0 0 12px;
      color: #555;
      font-size: 10px;
    }
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
    .balances dt {
      margin: 0;
      font-weight: 600;
      color: #444;
    }
    .balances dd {
      margin: 0 0 6px;
      font-size: 13px;
      font-weight: 700;
    }
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
    th {
      background: #eee;
      font-size: 10px;
    }
    td.num, th.num { text-align: right; white-space: nowrap; }
    h2 {
      margin: 0 0 8px;
      font-size: 13px;
    }
    @media print {
      body { margin: 0; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>Shalimar Fashions · Cash Counter</h1>
  <p class="meta">Full History Report · Exported ${escapeHtml(exportedDate)} ${escapeHtml(exportedTime)} · ${items.length} records</p>
  <dl class="balances">
    <dt>Opening Cash</dt><dd>${escapeHtml(formatMoney(meta.openingCash))}</dd>
    <dt>Opening Bank</dt><dd>${escapeHtml(formatMoney(meta.openingBank))}</dd>
    <dt>Current Cash</dt><dd>${escapeHtml(formatMoney(meta.currentCash))}</dd>
    <dt>Current Bank</dt><dd>${escapeHtml(formatMoney(meta.currentBank))}</dd>
  </dl>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Time</th>
        <th>Type</th>
        <th>Name</th>
        <th class="num">Amount</th>
        <th>Payment</th>
        <th>Details</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="7">No history records.</td></tr>'}
    </tbody>
  </table>
  <h2>Summary by Type</h2>
  <table>
    <thead>
      <tr>
        <th>Type</th>
        <th class="num">Count</th>
        <th class="num">Total Amount</th>
      </tr>
    </thead>
    <tbody>
      ${summaryRows || '<tr><td colspan="3">No records.</td></tr>'}
    </tbody>
  </table>
</body>
</html>`
}

export function buildFullHistoryReportCsv(
  data: AppData,
  meta: HistoryReportMeta,
): string {
  const items = sortedHistoryItems(data)
  const summary = summarizeByType(items)

  const lines: string[] = []
  lines.push('Shalimar Fashions · Cash Counter · Full History Report')
  lines.push(
    `Exported,${escapeCsv(formatReportDate(meta.exportedAt))},${escapeCsv(formatReportTime(meta.exportedAt))}`,
  )
  lines.push(`Opening Cash,${meta.openingCash}`)
  lines.push(`Opening Bank,${meta.openingBank}`)
  lines.push(`Current Cash,${meta.currentCash}`)
  lines.push(`Current Bank,${meta.currentBank}`)
  lines.push(`Total Records,${items.length}`)
  lines.push('')
  lines.push(
    ['Date', 'Time', 'Type', 'Name', 'Amount', 'Payment', 'Details']
      .map(escapeCsv)
      .join(','),
  )

  for (const item of items) {
    lines.push(historyRow(item).map(escapeCsv).join(','))
  }

  lines.push('')
  lines.push('Summary by Type')
  lines.push('Type,Count,Total Amount')
  for (const type of ['sale', 'expense', 'deposit', 'transfer'] as HistoryItemType[]) {
    const row = summary[type]
    if (row.count === 0) continue
    lines.push(
      [getHistoryTypeLabel(type), row.count, row.sum].map(escapeCsv).join(','),
    )
  }

  return `\uFEFF${lines.join('\n')}`
}

export function downloadFullHistoryReport(data: AppData, meta: HistoryReportMeta): void {
  const csv = buildFullHistoryReportCsv(data, meta)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const stamp = meta.exportedAt.slice(0, 10)
  const link = document.createElement('a')
  link.href = url
  link.download = `cash-counter-history-${stamp}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export function printFullHistoryReportPdf(data: AppData, meta: HistoryReportMeta): void {
  const html = buildFullHistoryReportHtml(data, meta)
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
