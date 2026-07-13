import type { AppData, Sale } from '../types'
import { formatDate, formatMoney } from './format'

export type HistoryItemType = 'sale' | 'expense' | 'deposit' | 'transfer'

export type HistoryFilter = 'all' | HistoryItemType

export type HistoryPaymentMode =
  | 'cash'
  | 'bank'
  | 'credit'
  | 'cheque'
  | 'split'
  | 'pending'

export type HistoryPaymentFilter = 'all' | HistoryPaymentMode

export interface HistoryReceiptLine {
  label: string
  amount: number
  status: 'paid' | 'pending'
  detail?: string
  /** @deprecated use paidAt */
  date?: string
  createdAt?: string
  paidAt?: string
}

export interface HistoryReceiptEvent {
  label: string
  date: string
  amount?: number
  type: 'bill-created' | 'pending-created' | 'collected' | 'pending'
}

export interface HistoryItem {
  type: HistoryItemType
  id: string
  amount: number
  sub: string
  name?: string
  date: string
  isSplitGroup?: boolean
  receiptLines?: HistoryReceiptLine[]
  receiptTimeline?: HistoryReceiptEvent[]
  groupSaleIds?: string[]
  originalBillAmount?: number
  billCreatedAt?: string
  completedAt?: string
  paymentMode?: HistoryPaymentMode
  paymentModes?: HistoryPaymentMode[]
}

export function getHistoryTypeLabel(type: HistoryItemType): string {
  if (type === 'sale') return 'Bill Collected'
  if (type === 'deposit') return 'Money Added'
  if (type === 'transfer') return 'Transfer'
  return 'Expense'
}

const PAYMENT_MODE_LABELS: Record<HistoryPaymentMode, string> = {
  cash: 'Cash',
  bank: 'Bank',
  credit: 'Credit',
  cheque: 'Cheque',
  split: 'Split',
  pending: 'Pending',
}

const PAYMENT_MODE_SORT_ORDER: Record<HistoryPaymentMode, number> = {
  cash: 1,
  bank: 2,
  credit: 3,
  cheque: 4,
  split: 5,
  pending: 6,
}

export function getHistoryPaymentLabel(mode: HistoryPaymentMode): string {
  return PAYMENT_MODE_LABELS[mode]
}

export function getHistoryPaymentSortKey(item: HistoryItem): number {
  const modes = item.paymentModes ?? (item.paymentMode ? [item.paymentMode] : [])
  if (modes.length === 0) return 99
  return Math.min(...modes.map((mode) => PAYMENT_MODE_SORT_ORDER[mode]))
}

function salePaymentMode(sale: Sale): HistoryPaymentMode {
  if (sale.status === 'pending') {
    if (isCreditBill(sale)) return 'credit'
    if (isChequeBill(sale)) return 'cheque'
    return 'pending'
  }
  if (isCreditBill(sale)) return 'credit'
  if (isChequeBill(sale)) return 'cheque'
  if (sale.payType === 'bank') return 'bank'
  if (sale.payType === 'split') return 'split'
  return 'cash'
}

function paymentModesFromReceiptLines(
  lines: HistoryReceiptLine[],
): HistoryPaymentMode[] {
  const modes = new Set<HistoryPaymentMode>(['split'])
  for (const line of lines) {
    if (line.label === 'Cash') modes.add('cash')
    if (line.label === 'Bank') modes.add('bank')
    if (line.label === 'Credit') modes.add('credit')
    if (line.label === 'Cheque') modes.add('cheque')
    if (line.status === 'pending') modes.add('pending')
  }
  return [...modes]
}

function isCreditBill(sale: Sale): boolean {
  return (
    sale.pendingPayType === 'credit' ||
    (sale.status === 'pending' && sale.payType === 'credit') ||
    sale.source === 'tally'
  )
}

function isChequeBill(sale: Sale): boolean {
  return (
    sale.pendingPayType === 'cheque' ||
    (sale.status === 'pending' && sale.payType === 'cheque')
  )
}

function childBillKind(sale: Sale): 'credit' | 'cheque' | null {
  if (isCreditBill(sale)) return 'credit'
  if (isChequeBill(sale)) return 'cheque'
  return null
}

function collectionMethodLabel(sale: Sale): string {
  if (sale.status === 'pending') return ''

  const cash = sale.cashAmount ?? 0
  const cheque = sale.chequeAmount ?? 0
  let bank = sale.bankAmount ?? 0
  if (sale.chequeApproved && cheque > 0) bank = Math.max(0, bank - cheque)

  if (sale.payType === 'cash') return 'Cash'
  if (sale.payType === 'bank') return 'Bank'
  if (sale.payType === 'cheque') return sale.chequeApproved ? 'Cheque → Bank' : 'Cheque'

  const parts: string[] = []
  if (cash > 0) parts.push('Cash')
  if (bank > 0) parts.push('Bank')
  if (cheque > 0) parts.push(sale.chequeApproved ? 'Cheque → Bank' : 'Cheque')

  if (sale.payType === 'split') {
    return parts.length > 0 ? parts.join(' + ') : 'Split'
  }

  return parts.join(' + ')
}

function balanceBillCollectionDetail(sale: Sale): string | undefined {
  const kind = isCreditBill(sale) ? 'Credit' : isChequeBill(sale) ? 'Cheque' : null
  if (!kind) return paidCollectionDetail(sale)

  if (sale.status === 'pending') return `${kind} bill pending`

  const method = collectionMethodLabel(sale)
  const breakdown = paidCollectionDetail(sale)
  if (sale.payType === 'split' && breakdown) return `${kind} paid · ${breakdown}`
  return `${kind} paid · ${method}`
}

function salePayLabel(sale: Sale): string {
  if (sale.status === 'pending') {
    if (sale.source === 'tally') return '📒 Tally Pending'
    if (sale.payType === 'cheque') return '🧾 Cheque Pending'
    if (sale.payType === 'credit') return '💳 Credit Pending'
    return '📋 Pending'
  }
  if (sale.payType === 'bank') return '🏦 Bank'
  if (sale.payType === 'cheque') return '🧾 Cheque'
  if (sale.payType === 'credit') return '💳 Credit'
  if (sale.payType === 'split') {
    const base = `💵 ${formatMoney(sale.cashAmount ?? 0)} · 🏦 ${formatMoney(sale.bankAmount ?? 0)}`
    const withCheque =
      (sale.chequeAmount ?? 0) > 0 ? `${base} · 🧾 ${formatMoney(sale.chequeAmount ?? 0)}` : base
    return (sale.creditAmount ?? 0) > 0
      ? `${withCheque} · 💳 ${formatMoney(sale.creditAmount ?? 0)}`
      : withCheque
  }
  return '💵 Cash'
}

function paidCollectionDetail(sale: Sale): string | undefined {
  if (sale.status === 'pending') return 'Pending'
  const cash = sale.cashAmount ?? 0
  const cheque = sale.chequeAmount ?? 0
  let bank = sale.bankAmount ?? 0
  if (sale.chequeApproved && cheque > 0) bank = Math.max(0, bank - cheque)

  const parts: string[] = []
  if (cash > 0) parts.push(`💵 ${formatMoney(cash)}`)
  if (bank > 0) parts.push(`🏦 ${formatMoney(bank)}`)
  if (cheque > 0) {
    parts.push(
      sale.chequeApproved ? `🧾 ${formatMoney(cheque)} → bank` : `🧾 ${formatMoney(cheque)}`,
    )
  }
  if (parts.length === 0 && sale.payType === 'cash') return `💵 ${formatMoney(sale.billAmount)}`
  if (parts.length === 0 && sale.payType === 'bank') return `🏦 ${formatMoney(sale.billAmount)}`
  return parts.join(' · ')
}

function buildChildrenMap(sales: Sale[]): Map<string, Sale[]> {
  const map = new Map<string, Sale[]>()
  for (const sale of sales) {
    if (!sale.parentSplitId) continue
    const list = map.get(sale.parentSplitId) ?? []
    list.push(sale)
    map.set(sale.parentSplitId, list)
  }
  return map
}

function latestIso(dates: (string | undefined)[]): string {
  let best = ''
  let bestTime = 0
  for (const iso of dates) {
    if (!iso) continue
    const t = new Date(iso).getTime()
    if (t >= bestTime) {
      bestTime = t
      best = iso
    }
  }
  return best
}

function buildSplitReceiptLines(parent: Sale, children: Sale[]): HistoryReceiptLine[] {
  const lines: HistoryReceiptLine[] = []
  const childTypes = new Set(children.map((c) => c.payType))
  const parentPaidAt = parent.updatedAt ?? parent.createdAt

  if (parent.status !== 'pending') {
    if ((parent.cashAmount ?? 0) > 0) {
      lines.push({
        label: 'Cash',
        amount: parent.cashAmount ?? 0,
        status: 'paid',
        detail: '💵 Collected at counter',
        createdAt: parent.createdAt,
        paidAt: parentPaidAt,
        date: parentPaidAt,
      })
    }

    const chequeOnParent = parent.chequeAmount ?? 0
    let bankOnParent = parent.bankAmount ?? 0
    if (parent.chequeApproved && chequeOnParent > 0) {
      bankOnParent = Math.max(0, bankOnParent - chequeOnParent)
    }
    if (bankOnParent > 0) {
      lines.push({
        label: 'Bank',
        amount: bankOnParent,
        status: 'paid',
        detail: '🏦 Collected to bank',
        createdAt: parent.createdAt,
        paidAt: parentPaidAt,
        date: parentPaidAt,
      })
    }
    if (chequeOnParent > 0 && parent.chequeApproved && !childTypes.has('cheque')) {
      lines.push({
        label: 'Cheque',
        amount: chequeOnParent,
        status: 'paid',
        detail: '🧾 Cheque approved to bank',
        createdAt: parent.createdAt,
        paidAt: parentPaidAt,
        date: parentPaidAt,
      })
    }
    if ((parent.creditAmount ?? 0) > 0 && !childTypes.has('credit')) {
      lines.push({
        label: 'Credit',
        amount: parent.creditAmount ?? 0,
        status: 'paid',
        detail: '💳 Credit on split',
        createdAt: parent.createdAt,
        paidAt: parentPaidAt,
        date: parentPaidAt,
      })
    }
  }

  for (const child of children) {
    const kind = childBillKind(child)
    const label = kind === 'credit' ? 'Credit' : kind === 'cheque' ? 'Cheque' : 'Bill'
    const paidAt = child.status !== 'pending' ? child.updatedAt ?? child.createdAt : undefined
    lines.push({
      label,
      amount: child.billAmount,
      status: child.status === 'pending' ? 'pending' : 'paid',
      detail:
        child.status === 'pending'
          ? `${label} bill pending`
          : balanceBillCollectionDetail(child) ?? paidCollectionDetail(child),
      createdAt: child.createdAt,
      paidAt,
      date: paidAt,
    })
  }

  return lines
}

function buildSplitTimeline(parent: Sale, children: Sale[]): HistoryReceiptEvent[] {
  const events: HistoryReceiptEvent[] = [
    {
      label: 'Bill created',
      date: parent.createdAt,
      amount: parent.originalBillAmount ?? parent.billAmount,
      type: 'bill-created',
    },
  ]

  const childTypes = new Set(children.map((c) => c.payType))
  const parentPaidAt = parent.updatedAt ?? parent.createdAt

  if (parent.status !== 'pending') {
    if ((parent.cashAmount ?? 0) > 0) {
      events.push({
        label: 'Cash collected',
        date: parentPaidAt,
        amount: parent.cashAmount,
        type: 'collected',
      })
    }
    const chequeOnParent = parent.chequeAmount ?? 0
    let bankOnParent = parent.bankAmount ?? 0
    if (parent.chequeApproved && chequeOnParent > 0) {
      bankOnParent = Math.max(0, bankOnParent - chequeOnParent)
    }
    if (bankOnParent > 0) {
      events.push({
        label: 'Bank collected',
        date: parentPaidAt,
        amount: bankOnParent,
        type: 'collected',
      })
    }
    if (chequeOnParent > 0 && parent.chequeApproved && !childTypes.has('cheque')) {
      events.push({
        label: 'Cheque approved',
        date: parentPaidAt,
        amount: chequeOnParent,
        type: 'collected',
      })
    }
  }

  for (const child of children) {
    const kind = childBillKind(child)
    const part = kind === 'credit' ? 'Credit' : kind === 'cheque' ? 'Cheque' : 'Bill'
    events.push({
      label: `${part} bill created`,
      date: child.createdAt,
      amount: child.billAmount,
      type: child.status === 'pending' ? 'pending' : 'pending-created',
    })
    if (child.status !== 'pending') {
      const method = collectionMethodLabel(child)
      events.push({
        label: kind ? `${part} paid · ${method}` : `${part} paid`,
        date: child.updatedAt ?? child.createdAt,
        amount: child.billAmount,
        type: 'collected',
      })
    }
  }

  return events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

function formatSplitSub(lines: HistoryReceiptLine[], fullBill: number): string {
  if (lines.length === 0) return `Split bill · ${formatMoney(fullBill)}`
  const pending = lines.filter((l) => l.status === 'pending').length
  const labels = [...new Set(lines.map((line) => line.label))]
  const suffix = pending > 0 ? ` · ${pending} pending` : ' · collected'
  return `Split bill · ${formatMoney(fullBill)} · ${labels.join(' + ')}${suffix}`
}

function buildSyntheticSplitParent(children: Sale[]): Sale {
  const earliest = children.reduce((a, b) =>
    new Date(a.createdAt).getTime() < new Date(b.createdAt).getTime() ? a : b,
  )
  const fullBill =
    earliest.originalBillAmount ?? children.reduce((sum, child) => sum + child.billAmount, 0)
  const creditChild = children.find((c) => c.payType === 'credit')
  const chequeChild = children.find((c) => c.payType === 'cheque')

  return {
    id: `split-group-${children
      .map((c) => c.id)
      .sort()
      .join('-')}`,
    billAmount: children
      .filter((c) => c.status === 'paid')
      .reduce((sum, c) => sum + c.billAmount, 0),
    originalBillAmount: fullBill,
    paidAmount: 0,
    changeAmount: 0,
    payType: 'split',
    chequeAmount: chequeChild?.billAmount,
    creditAmount: creditChild?.billAmount,
    customerName: earliest.customerName,
    createdAt: earliest.createdAt,
    status: children.every((c) => c.status === 'paid') ? 'paid' : 'pending',
  }
}

function findOrphanSplitGroups(sales: Sale[], consumedIds: Set<string>): Sale[][] {
  const orphans = sales.filter(
    (sale) =>
      !sale.parentSplitId &&
      !consumedIds.has(sale.id) &&
      (sale.payType === 'credit' || sale.payType === 'cheque') &&
      (sale.originalBillAmount ?? 0) > 0,
  )
  const groups: Sale[][] = []
  const used = new Set<string>()

  for (const sale of orphans) {
    if (used.has(sale.id)) continue
    const created = new Date(sale.createdAt).getTime()
    const matches = orphans.filter(
      (other) =>
        !used.has(other.id) &&
        other.id !== sale.id &&
        other.originalBillAmount === sale.originalBillAmount &&
        (other.customerName ?? '') === (sale.customerName ?? '') &&
        Math.abs(new Date(other.createdAt).getTime() - created) <= 120_000,
    )

    if (matches.length === 0) continue

    const group = [sale, ...matches]
    const partsTotal = group.reduce((sum, child) => sum + child.billAmount, 0)
    if (partsTotal > (sale.originalBillAmount ?? partsTotal)) continue

    for (const child of group) used.add(child.id)
    groups.push(group)
  }

  return groups
}

function buildSplitGroupItem(parent: Sale, children: Sale[]): HistoryItem {
  const receiptLines = buildSplitReceiptLines(parent, children)
  const receiptTimeline = buildSplitTimeline(parent, children)
  const fullBill =
    parent.originalBillAmount ??
    children[0]?.originalBillAmount ??
    (receiptLines.reduce((sum, line) => sum + line.amount, 0) || parent.billAmount)

  const groupSaleIds = [parent.id, ...children.map((c) => c.id)]
  const allPaid =
    parent.status !== 'pending' && children.every((c) => c.status !== 'pending')
  const completedAt = allPaid
    ? latestIso([
        parent.updatedAt ?? parent.createdAt,
        ...children.map((c) => c.updatedAt ?? c.createdAt),
      ])
    : undefined
  const date = latestIso([
    parent.updatedAt ?? parent.createdAt,
    ...children.map((c) => (c.status !== 'pending' ? c.updatedAt ?? c.createdAt : c.createdAt)),
  ])

  return {
    type: 'sale',
    id: parent.id,
    amount: fullBill,
    sub: formatSplitSub(receiptLines, fullBill),
    name: parent.customerName ?? children.find((c) => c.customerName)?.customerName,
    date: date || parent.createdAt,
    isSplitGroup: true,
    receiptLines,
    receiptTimeline,
    groupSaleIds,
    originalBillAmount: fullBill,
    billCreatedAt: parent.createdAt,
    completedAt,
    paymentMode: 'split',
    paymentModes: paymentModesFromReceiptLines(receiptLines),
  }
}

function saleReceiptLabel(sale: Sale): string {
  if (isCreditBill(sale)) return 'Credit'
  if (isChequeBill(sale)) return 'Cheque'
  if (sale.payType === 'bank') return 'Bank'
  if (sale.payType === 'split') return 'Split'
  return 'Cash'
}

function buildSaleReceiptLines(sale: Sale): HistoryReceiptLine[] {
  const paidAt = sale.status !== 'pending' ? sale.updatedAt ?? sale.createdAt : undefined
  return [
    {
      label: saleReceiptLabel(sale),
      amount: sale.billAmount,
      status: sale.status === 'pending' ? 'pending' : 'paid',
      detail: balanceBillCollectionDetail(sale) ?? salePayLabel(sale),
      createdAt: sale.createdAt,
      paidAt,
      date: paidAt,
    },
  ]
}

function buildSaleTimeline(sale: Sale): HistoryReceiptEvent[] {
  const events: HistoryReceiptEvent[] = [
    {
      label: 'Bill created',
      date: sale.createdAt,
      amount: sale.originalBillAmount ?? sale.billAmount,
      type: 'bill-created',
    },
  ]
  if (sale.status === 'pending') {
    events.push({
      label: isCreditBill(sale)
        ? 'Credit pending'
        : isChequeBill(sale)
          ? 'Cheque pending'
          : `${saleReceiptLabel(sale)} pending`,
      date: sale.createdAt,
      amount: sale.billAmount,
      type: 'pending',
    })
  } else {
    const method = collectionMethodLabel(sale)
    let label = `${saleReceiptLabel(sale)} collected`
    if (isCreditBill(sale)) label = `Credit paid · ${method}`
    else if (isChequeBill(sale)) label = `Cheque paid · ${method}`

    events.push({
      label,
      date: sale.updatedAt ?? sale.createdAt,
      amount: sale.billAmount,
      type: 'collected',
    })
  }
  return events
}

function buildSaleHistoryItem(sale: Sale): HistoryItem {
  const paidAt = sale.status !== 'pending' ? sale.updatedAt ?? sale.createdAt : undefined
  const amount = formatMoney(sale.billAmount)
  let sub: string

  if (isCreditBill(sale)) {
    sub =
      sale.status === 'pending'
        ? `Credit · ${amount} pending`
        : `Credit · ${amount} paid · ${collectionMethodLabel(sale)}${paidAt ? ` · ${formatDate(paidAt)}` : ''}`
  } else if (isChequeBill(sale)) {
    sub =
      sale.status === 'pending'
        ? `Cheque · ${amount} pending`
        : `Cheque · ${amount} paid · ${collectionMethodLabel(sale)}${paidAt ? ` · ${formatDate(paidAt)}` : ''}`
  } else {
    const payLabel = salePayLabel(sale)
    const orig =
      sale.originalBillAmount && sale.originalBillAmount !== sale.billAmount
        ? `Bill ${formatMoney(sale.originalBillAmount)} → `
        : ''
    sub = `${orig}${sale.status === 'pending' ? 'Pending · ' : sale.payType === 'bank' || sale.payType === 'credit' || sale.payType === 'cheque' ? 'Paid ' : `Give ${formatMoney(sale.paidAmount)} · `}${payLabel}${sale.changeAmount > 0 ? ` · Change ${formatMoney(sale.changeAmount)}` : ''}${paidAt ? ` · Collected ${formatDate(paidAt)}` : ''}`
  }

  return {
    type: 'sale',
    id: sale.id,
    amount: sale.billAmount,
    sub,
    name: sale.customerName,
    date: sale.createdAt,
    receiptLines: buildSaleReceiptLines(sale),
    receiptTimeline: buildSaleTimeline(sale),
    billCreatedAt: sale.createdAt,
    completedAt: paidAt,
    paymentMode: salePaymentMode(sale),
    paymentModes: [salePaymentMode(sale)],
    groupSaleIds:
      isCreditBill(sale) || isChequeBill(sale)
        ? sale.parentSplitId
          ? [sale.parentSplitId, sale.id]
          : [sale.id]
        : undefined,
  }
}

export function buildHistoryItems(data: AppData): HistoryItem[] {
  const childrenByParent = buildChildrenMap(data.sales)
  const consumedChildIds = new Set<string>()
  const saleItems: HistoryItem[] = []

  for (const sale of data.sales) {
    if (sale.parentSplitId) continue

    const children = childrenByParent.get(sale.id) ?? []
    const isSplitGroup = sale.payType === 'split' || children.length > 0

    if (isSplitGroup) {
      for (const child of children) consumedChildIds.add(child.id)
      saleItems.push(buildSplitGroupItem(sale, children))
      continue
    }

    saleItems.push(buildSaleHistoryItem(sale))
  }

  for (const group of findOrphanSplitGroups(data.sales, consumedChildIds)) {
    for (const child of group) consumedChildIds.add(child.id)
    saleItems.push(buildSplitGroupItem(buildSyntheticSplitParent(group), group))
  }

  for (const sale of data.sales) {
    if (!sale.parentSplitId || consumedChildIds.has(sale.id)) continue
    saleItems.push(buildSaleHistoryItem(sale))
  }

  const expenseItems = data.expenses.map((e) => {
    if (e.kind === 'transfer') {
      const toBank = e.transferDirection === 'cash-to-bank'
      return {
        type: 'transfer' as const,
        id: e.id,
        amount: e.amount,
        sub: toBank ? '💵 → 🏦 Cash to bank' : '🏦 → 💵 Bank to cash',
        name: e.name,
        date: e.createdAt,
        paymentMode: 'cash' as const,
        paymentModes: ['cash', 'bank'] as HistoryPaymentMode[],
      }
    }
    const isAdd = e.kind === 'add'
    const payMode: HistoryPaymentMode = e.payType === 'bank' ? 'bank' : 'cash'
    return {
      type: isAdd ? ('deposit' as const) : ('expense' as const),
      id: e.id,
      amount: e.amount,
      sub: isAdd
        ? e.payType === 'bank'
          ? '🏦 Added to bank'
          : '💵 Added to counter'
        : e.payType === 'bank'
          ? '🏦 Bank expense'
          : '💵 Cash expense',
      name: e.name,
      date: e.createdAt,
      paymentMode: payMode,
      paymentModes: [payMode],
    }
  })

  return [...saleItems, ...expenseItems]
}

export function matchesHistorySearch(item: HistoryItem, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase().trim()
  const receiptHaystack =
    item.receiptLines
      ?.map(
        (line) =>
          `${line.label} ${line.detail ?? ''} ${formatMoney(line.amount)} ${line.createdAt ?? ''} ${line.paidAt ?? ''}`,
      )
      .join(' ') ?? ''
  const timelineHaystack =
    item.receiptTimeline?.map((e) => `${e.label} ${formatDate(e.date)}`).join(' ') ?? ''
  const haystack = [
    item.name,
    item.sub,
    receiptHaystack,
    timelineHaystack,
    item.billCreatedAt ? formatDate(item.billCreatedAt) : '',
    item.completedAt ? formatDate(item.completedAt) : '',
    formatMoney(item.amount),
    item.originalBillAmount ? formatMoney(item.originalBillAmount) : '',
    formatDate(item.date),
    getHistoryTypeLabel(item.type),
    item.isSplitGroup ? 'split' : '',
    item.paymentMode ? getHistoryPaymentLabel(item.paymentMode) : '',
    ...(item.paymentModes ?? []).map(getHistoryPaymentLabel),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

export function matchesHistoryPaymentFilter(
  item: HistoryItem,
  paymentFilter: HistoryPaymentFilter,
): boolean {
  if (paymentFilter === 'all') return true
  const modes = item.paymentModes ?? (item.paymentMode ? [item.paymentMode] : [])
  return modes.includes(paymentFilter)
}
