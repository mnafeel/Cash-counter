import type { AppData } from '../types'
import { getBankOpeningBalance } from './bankActivity'
import { getCashOpeningBalance, matchesCashDateFilter, type CashDateFilter } from './cashActivity'
import { formatMoney } from './format'
import { formatReportPresetLabel } from './reportsHub'

export type ReportShareSummary = {
  periodLabel: string
  salesCollected: number
  salesCash: number
  salesBank: number
  withCreditSales: number
  oldCreditChequeCollected: number
  sameDaySales: number
  expenseTotal: number
  expenseNormal: number
  expenseNormalCash: number
  expenseNormalBank: number
  expensePurchase: number
  expensePurchaseCash: number
  expensePurchaseBank: number
  notSaleTotal: number
  net: number
  openingCash: number
  openingBank: number
  cashInHand: number
  cashAtBank: number
  cashToBank: number
  bankToCash: number
  creditPending: number
  chequePending: number
  purchaseTotal: number
}

export function buildReportShareSummary(input: {
  data: AppData
  preset: CashDateFilter
  selectedDate: string
  rangeTo?: string
  currentCash: number
  currentBank: number
  salesCollected: number
  salesCash: number
  salesBank: number
  withCreditSales: number
  oldCreditChequeCollected: number
  sameDaySales: number
  expenseTotal: number
  expenseNormal: number
  expenseNormalCash: number
  expenseNormalBank: number
  expensePurchase: number
  expensePurchaseCash: number
  expensePurchaseBank: number
  notSaleTotal: number
  net: number
  creditPending: number
  chequePending: number
  purchaseTotal: number
}): ReportShareSummary {
  const periodLabel = formatReportPresetLabel(input.preset, input.selectedDate, input.rangeTo)
  const openingCash = getCashOpeningBalance(
    input.data,
    input.currentCash,
    input.preset,
    input.selectedDate,
    undefined,
    input.rangeTo,
  )
  const openingBank = getBankOpeningBalance(
    input.data,
    input.currentBank,
    input.preset,
    input.selectedDate,
    undefined,
    input.rangeTo,
  )

  let cashToBank = 0
  let bankToCash = 0
  for (const expense of input.data.expenses ?? []) {
    if (expense.kind !== 'transfer') continue
    if (!matchesCashDateFilter(expense.createdAt, input.preset, input.selectedDate, input.rangeTo)) {
      continue
    }
    if (expense.transferDirection === 'cash-to-bank') cashToBank += expense.amount
    else if (expense.transferDirection === 'bank-to-cash') bankToCash += expense.amount
  }

  return {
    periodLabel,
    salesCollected: input.salesCollected,
    salesCash: input.salesCash,
    salesBank: input.salesBank,
    withCreditSales: input.withCreditSales,
    oldCreditChequeCollected: input.oldCreditChequeCollected,
    sameDaySales: input.sameDaySales,
    expenseTotal: input.expenseTotal,
    expenseNormal: input.expenseNormal,
    expenseNormalCash: input.expenseNormalCash,
    expenseNormalBank: input.expenseNormalBank,
    expensePurchase: input.expensePurchase,
    expensePurchaseCash: input.expensePurchaseCash,
    expensePurchaseBank: input.expensePurchaseBank,
    notSaleTotal: input.notSaleTotal,
    net: input.net,
    openingCash,
    openingBank,
    cashInHand: input.currentCash,
    cashAtBank: input.currentBank,
    cashToBank,
    bankToCash,
    creditPending: input.creditPending,
    chequePending: input.chequePending,
    purchaseTotal: input.purchaseTotal,
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  accent: string,
  sub?: string,
  size: 'md' | 'lg' = 'md',
) {
  const large = size === 'lg'
  ctx.save()
  roundRect(ctx, x, y, w, h, large ? 22 : 16)
  ctx.fillStyle = 'rgba(255,255,255,0.065)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.13)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = accent
  ctx.fillRect(x, y + 12, large ? 6 : 4, h - 24)

  ctx.fillStyle = 'rgba(244,244,245,0.7)'
  ctx.font = large
    ? '800 20px system-ui, -apple-system, Segoe UI, sans-serif'
    : '700 16px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillText(label, x + 20, y + (large ? 36 : 28))

  ctx.fillStyle = '#f4f4f5'
  ctx.font = large
    ? '800 44px system-ui, -apple-system, Segoe UI, sans-serif'
    : '800 28px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillText(value, x + 20, y + (large ? 88 : 64))

  if (sub) {
    ctx.fillStyle = 'rgba(244,244,245,0.56)'
    ctx.font = large
      ? '600 18px system-ui, -apple-system, Segoe UI, sans-serif'
      : '600 14px system-ui, -apple-system, Segoe UI, sans-serif'
    ctx.fillText(sub, x + 24, y + h - (large ? 22 : 16))
  }
  ctx.restore()
}

function drawSectionTitle(ctx: CanvasRenderingContext2D, x: number, y: number, title: string) {
  ctx.fillStyle = '#d4a84b'
  ctx.font = '800 26px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillText(title, x, y)
}

/** Renders a shareable business summary card (mobile screenshot friendly). */
export function renderReportShareCardCanvas(summary: ReportShareSummary): HTMLCanvasElement {
  const width = 1080
  const height = 1920
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const bg = ctx.createLinearGradient(0, 0, width, height)
  bg.addColorStop(0, '#0c0c10')
  bg.addColorStop(0.45, '#17171d')
  bg.addColorStop(1, '#101014')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)

  const orb = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  orb(200, 260, 340, 'rgba(212,168,75,0.16)')
  orb(880, 560, 360, 'rgba(56,189,248,0.1)')
  orb(540, 1680, 420, 'rgba(251,146,60,0.1)')

  // Outer frame margins — breathing room at top / sides / bottom
  const marginX = 56
  const marginTop = 64
  const marginBottom = 72
  const gap = 18
  const sectionGap = 28
  const left = marginX
  const usable = width - marginX * 2
  const half = (usable - gap) / 2

  // Brand header
  const headerH = 156
  roundRect(ctx, left, marginTop, usable, headerH, 26)
  ctx.fillStyle = 'rgba(19,19,22,0.88)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(212,168,75,0.38)'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.fillStyle = '#d4a84b'
  ctx.font = '800 26px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillText('SHALIMAR FASHIONS', left + 28, marginTop + 52)

  ctx.fillStyle = '#f4f4f5'
  ctx.font = '800 42px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillText('Business snapshot', left + 28, marginTop + 100)

  ctx.fillStyle = 'rgba(244,244,245,0.62)'
  ctx.font = '600 24px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillText(summary.periodLabel, left + 28, marginTop + 136)

  // Content starts below header with clear alignment space
  let y = marginTop + headerH + sectionGap

  // Cash position
  drawSectionTitle(ctx, left, y, 'Cash position')
  y += 26
  const cashH = 152
  drawBox(
    ctx,
    left,
    y,
    half,
    cashH,
    'Cash in counter',
    formatMoney(summary.cashInHand),
    '#e8b84a',
    `Opening ${formatMoney(summary.openingCash)}`,
    'lg',
  )
  drawBox(
    ctx,
    left + half + gap,
    y,
    half,
    cashH,
    'Cash at bank',
    formatMoney(summary.cashAtBank),
    '#5b9cf5',
    `Opening ${formatMoney(summary.openingBank)}`,
    'lg',
  )
  y += cashH + gap
  const transferH = 108
  drawBox(ctx, left, y, half, transferH, 'Cash → Bank', formatMoney(summary.cashToBank), '#38bdf8')
  drawBox(
    ctx,
    left + half + gap,
    y,
    half,
    transferH,
    'Bank → Cash',
    formatMoney(summary.bankToCash),
    '#a78bfa',
  )
  y += transferH + sectionGap

  // Sales
  drawSectionTitle(ctx, left, y, 'Sales')
  y += 26
  const salesLeftW = Math.round(usable * 0.58)
  const salesRightW = usable - salesLeftW - gap
  const salesHeroH = 176

  drawBox(
    ctx,
    left,
    y,
    salesLeftW,
    salesHeroH,
    'Sales collected',
    formatMoney(summary.salesCollected),
    '#34d399',
    `💵 ${formatMoney(summary.salesCash)}  ·  🏦 ${formatMoney(summary.salesBank)}`,
    'lg',
  )
  drawBox(
    ctx,
    left + salesLeftW + gap,
    y,
    salesRightW,
    salesHeroH,
    'With credit/cheque',
    formatMoney(summary.withCreditSales),
    '#fbbf24',
    undefined,
    'lg',
  )
  y += salesHeroH + gap
  const salesRowH = 160
  drawBox(
    ctx,
    left,
    y,
    half,
    salesRowH,
    'Old credit/cheque',
    formatMoney(summary.oldCreditChequeCollected),
    '#fb923c',
    undefined,
    'lg',
  )
  drawBox(
    ctx,
    left + half + gap,
    y,
    half,
    salesRowH,
    "Today's only sale",
    formatMoney(summary.sameDaySales),
    '#7ddf8a',
    undefined,
    'lg',
  )
  {
    const bx = left + half + gap
    const by = y
    const bw = half
    const bh = salesRowH
    ctx.fillStyle = 'rgba(244,244,245,0.6)'
    ctx.font = '700 16px system-ui, -apple-system, Segoe UI, sans-serif'
    const metaY = by + bh - 42
    const col1 = bx + 24
    const col2 = bx + bw * 0.52
    ctx.fillText('Created', col1, metaY)
    ctx.fillText('Collected', col2, metaY)
    ctx.font = '600 14px system-ui, -apple-system, Segoe UI, sans-serif'
    ctx.fillStyle = 'rgba(244,244,245,0.44)'
    ctx.fillText('this period', col1, metaY + 18)
    ctx.fillText('this period', col2, metaY + 18)
  }
  y += salesRowH + sectionGap

  // Expenses
  drawSectionTitle(ctx, left, y, 'Expenses')
  y += 26
  const expHeroH = 164
  drawBox(
    ctx,
    left,
    y,
    half,
    expHeroH,
    'Total expense',
    formatMoney(summary.expenseTotal),
    '#fb923c',
    `Purchase ${formatMoney(summary.expensePurchase)}  ·  Normal ${formatMoney(summary.expenseNormal)}`,
    'lg',
  )
  drawBox(
    ctx,
    left + half + gap,
    y,
    half,
    expHeroH,
    'Purchase expense',
    formatMoney(summary.expensePurchase),
    '#c084fc',
    `💵 ${formatMoney(summary.expensePurchaseCash)}  ·  🏦 ${formatMoney(summary.expensePurchaseBank)}`,
    'lg',
  )
  y += expHeroH + gap
  const expWideH = 156
  drawBox(
    ctx,
    left,
    y,
    usable,
    expWideH,
    'Normal expense',
    formatMoney(summary.expenseNormal),
    '#f59e0b',
    `💵 ${formatMoney(summary.expenseNormalCash)}  ·  🏦 ${formatMoney(summary.expenseNormalBank)}`,
    'lg',
  )
  y += expWideH + gap
  drawBox(
    ctx,
    left,
    y,
    usable,
    expWideH,
    'Credit + Cheque open',
    formatMoney(summary.creditPending + summary.chequePending),
    '#f472b6',
    `Credit ${formatMoney(summary.creditPending)}  ·  Cheque ${formatMoney(summary.chequePending)}`,
    'lg',
  )
  y += expWideH + gap

  if (summary.notSaleTotal > 0.01) {
    drawBox(
      ctx,
      left,
      y,
      usable,
      128,
      'Not sale · cash in',
      formatMoney(summary.notSaleTotal),
      '#5b9fd4',
      undefined,
      'lg',
    )
  }

  // Footer sits in bottom margin band
  ctx.fillStyle = 'rgba(244,244,245,0.4)'
  ctx.font = '600 18px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillText('Cash Counter · share snapshot', left, height - marginBottom + 28)

  return canvas
}

export async function shareReportSummaryImage(
  summary: ReportShareSummary,
): Promise<'shared' | 'downloaded' | 'failed'> {
  const canvas = renderReportShareCardCanvas(summary)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((next) => resolve(next), 'image/png'),
  )
  if (!blob) return 'failed'

  const fileName = `cash-counter-${summary.periodLabel.replace(/\s+/g, '-').toLowerCase()}.png`
  const file = new File([blob], fileName, { type: 'image/png' })

  try {
    if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `Shalimar Fashions · ${summary.periodLabel}`,
        text: `${summary.periodLabel} · Sales ${formatMoney(summary.salesCollected)} · Expense ${formatMoney(summary.expenseTotal)}`,
      })
      return 'shared'
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return 'failed'
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return 'downloaded'
}
