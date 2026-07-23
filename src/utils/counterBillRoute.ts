/** Hash-route path to open a sale on the Counter bill page. */
export function counterBillPath(saleId: string): string {
  return `/counter?bill=${encodeURIComponent(saleId)}`
}

export function resolveHistoryItemBillId(item: {
  id: string
  type: string
}): string | null {
  if (item.type !== 'sale') return null
  return item.id
}
