function roundDownTo(value: number, step: number): number {
  return Math.floor(value / step) * step
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

export interface RoundOption {
  amount: number
  typeLabel: string
  saved: number
}

const BILL_ROUND_STEPS = [5, 10, 20, 50, 100, 200, 500] as const

/** Round-off bill down only (169 → 165, 160, 150…) with rounding type. */
export function getBillRoundOptions(billAmount: number): RoundOption[] {
  if (billAmount <= 0) return []

  const options: RoundOption[] = []
  const seen = new Set<number>()

  for (const step of BILL_ROUND_STEPS) {
    let amount = roundDownTo(billAmount, step)
    if (amount >= billAmount) amount -= step
    if (amount > 0 && amount < billAmount && !seen.has(amount)) {
      seen.add(amount)
      options.push({
        amount,
        typeLabel: `−${step}`,
        saved: billAmount - amount,
      })
    }
  }

  return options
    .filter((o) => o.amount < billAmount)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6)
}

/** Customer pay — round note amounts (>= current bill). */
export function getCustomerPayOptions(billAmount: number): number[] {
  if (billAmount <= 0) return []

  const suggestions: number[] = [billAmount]

  for (const step of [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
    const rounded = roundUpTo(billAmount, step)
    if (rounded >= billAmount) suggestions.push(rounded)
  }

  return [...new Set(suggestions)].sort((a, b) => a - b).slice(0, 8)
}

/** @deprecated use getBillRoundOptions */
export function getBillRoundSuggestions(billAmount: number): number[] {
  return getBillRoundOptions(billAmount).map((o) => o.amount)
}

/** @deprecated use getCustomerPayOptions */
export function getPaymentSuggestions(billAmount: number): number[] {
  return getCustomerPayOptions(billAmount)
}
