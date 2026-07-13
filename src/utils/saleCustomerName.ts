import type { Sale } from '../types'

function isPendingBalanceBill(sale: Sale): boolean {
  return (
    sale.status === 'pending' &&
    (sale.payType === 'credit' ||
      sale.payType === 'cheque' ||
      sale.pendingPayType === 'credit' ||
      sale.pendingPayType === 'cheque')
  )
}

export function getSaleCustomerName(sale: Sale, sales: Sale[]): string | undefined {
  const own = sale.customerName?.trim()
  if (own) return own

  if (sale.parentSplitId) {
    const parent = sales.find((s) => s.id === sale.parentSplitId)
    const parentName = parent?.customerName?.trim()
    if (parentName) return parentName
  }

  if (isPendingBalanceBill(sale) && (sale.originalBillAmount ?? 0) > 0) {
    const sibling = sales.find(
      (s) =>
        s.id !== sale.id &&
        isPendingBalanceBill(s) &&
        s.originalBillAmount === sale.originalBillAmount &&
        s.customerName?.trim(),
    )
    if (sibling?.customerName?.trim()) return sibling.customerName.trim()
  }

  return undefined
}

export function collectSplitNameTargets(data: { sales: Sale[] }, id: string): Set<string> {
  const targets = new Set<string>()
  const sale = data.sales.find((s) => s.id === id)
  if (!sale) return targets

  targets.add(id)

  if (sale.parentSplitId) {
    targets.add(sale.parentSplitId)
    for (const s of data.sales) {
      if (s.parentSplitId === sale.parentSplitId) targets.add(s.id)
    }
  }

  for (const s of data.sales) {
    if (s.parentSplitId === id) targets.add(s.id)
  }

  return targets
}
