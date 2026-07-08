function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

/** Common payment amounts a customer might hand over (>= bill). */
export function getPaymentSuggestions(billAmount: number): number[] {
  if (billAmount <= 0) return []

  const suggestions: number[] = [billAmount]

  for (const step of [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
    const rounded = roundUpTo(billAmount, step)
    if (rounded >= billAmount) suggestions.push(rounded)
  }

  const bills = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
  for (const bill of bills) {
    if (bill >= billAmount) suggestions.push(bill)
    const multiples = Math.ceil(billAmount / bill)
    suggestions.push(bill * multiples)
    if (multiples > 1) suggestions.push(bill * (multiples - 1) + bill)
  }

  return uniqueSorted(suggestions.filter((v) => v >= billAmount)).slice(0, 8)
}

/** Rounded bill amounts (for quick "round off" collection). */
export function getBillRoundSuggestions(billAmount: number): number[] {
  if (billAmount <= 0) return []

  const suggestions: number[] = []

  for (const step of [1, 5, 10, 50, 100]) {
    suggestions.push(roundUpTo(billAmount, step))
  }

  return uniqueSorted(suggestions.filter((v) => v !== billAmount)).slice(0, 5)
}
