function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

function roundDownTo(value: number, step: number): number {
  return Math.floor(value / step) * step
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

/** Round-off bill amounts — lower clean amounts (e.g. 169 → 165, 160, 150). */
export function getBillRoundSuggestions(billAmount: number): number[] {
  if (billAmount <= 0) return []

  const suggestions: number[] = []

  for (const step of [5, 10, 20, 50, 100, 200, 500, 1000]) {
    const rounded = roundDownTo(billAmount, step)
    if (rounded > 0 && rounded < billAmount) suggestions.push(rounded)
  }

  return uniqueSorted(suggestions)
    .reverse()
    .slice(0, 6)
}

/** Round customer pay amounts — clean notes >= bill (e.g. bill 165 → 170, 200, 500). */
export function getPaymentSuggestions(billAmount: number): number[] {
  if (billAmount <= 0) return []

  const suggestions: number[] = []

  for (const step of [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
    const rounded = roundUpTo(billAmount, step)
    if (rounded >= billAmount) suggestions.push(rounded)
  }

  return uniqueSorted(suggestions).slice(0, 8)
}
