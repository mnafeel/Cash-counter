export interface FlowActivityPoint {
  date: string
  amount: number
  direction: 'in' | 'out'
}

/** Cumulative balance curve for decorative flow charts (opening → events through period). */
export function buildBalanceFlowSeries(
  opening: number,
  items: FlowActivityPoint[],
  pointCount = 36,
): number[] {
  const count = Math.max(8, pointCount)
  if (items.length === 0) {
    return Array.from({ length: count }, () => opening)
  }

  const sorted = [...items].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  )
  let balance = opening
  const events: { t: number; balance: number }[] = [{ t: new Date(sorted[0].date).getTime(), balance: opening }]
  for (const item of sorted) {
    balance += item.direction === 'in' ? item.amount : -item.amount
    events.push({ t: new Date(item.date).getTime(), balance })
  }

  const t0 = events[0].t
  const t1 = events[events.length - 1].t
  const span = Math.max(t1 - t0, 1)
  const result: number[] = []

  for (let i = 0; i < count; i++) {
    const target = t0 + (span * i) / Math.max(count - 1, 1)
    let idx = 0
    while (idx < events.length - 1 && events[idx + 1].t <= target) idx++
    result.push(events[idx].balance)
  }

  return result
}
