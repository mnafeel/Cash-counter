import type { ExpenseBillMode } from './expenseBillLabels'
import { PURCHASE_SCAN_PAGE_BREAK } from './purchaseDocumentOcr'

export type PurchaseScanConfidence = 'high' | 'low' | 'unknown'

export interface PurchaseScanLineItem {
  name: string
  detail: string
  quantity?: number
  lineAmount?: number
}

export interface PurchaseScanResult {
  partyName?: string
  itemName?: string
  totalAmount?: number
  billNumber?: string
  billDate?: string
  billMode?: ExpenseBillMode
  billModeConfidence: PurchaseScanConfidence
  lineItems: PurchaseScanLineItem[]
  rawText: string
}

interface MoneyCandidate {
  amount: number
  score: number
}

interface BillNumberCandidate {
  value: string
  score: number
}

interface DateCandidate {
  iso: string
  score: number
}

const GST_SIGNALS = [
  /\bgstin\b/i,
  /\bcgst\b/i,
  /\bsgst\b/i,
  /\bigst\b/i,
  /\bgst\s*@/i,
  /tax\s*invoice/i,
  /\bgst\b/i,
  /hsn\s*\/?\s*sac/i,
]

const NO_GST_SIGNALS = [
  /bill\s*of\s*supply/i,
  /without\s*gst/i,
  /\bno\s*gst\b/i,
  /retail\s*invoice/i,
  /cash\s*memo/i,
]

const BUYER_SECTION_RE =
  /\b(party\s*details?|bill\s*to|billed\s*to|ship\s*to|shipping\s*address|consignee|buyer|customer\s*details?|deliver\s*to|dispatch\s*to)\b/i

const SUPPLIER_HINT_RE = /\b(from|seller|vendor|supplier|sold\s*by|issued\s*by|manufacturer)\b/i

const ITEM_TABLE_HEADER_RE =
  /^(s\.?\s*no|sr\.?\s*no|description|particulars|item|product|goods|material|name|qty|quantity|rate|amount|hsn|pieces)\b/i

const SKIP_LINE_RE =
  /^(total|sub\s*total|grand|cgst|sgst|igst|gst|round|amount|tax|invoice|bill|date|gstin|phone|mobile|email|www|http|hsn|sac|qty|quantity|rate|particular|description|item|s\.?\s*no|sr\.?\s*no|cash|bank|credit|thank|terms|authorised|authorized|signature|ship|billing|address|state|pin|pan|fssai)/i

const TRAILING_NUMBERS_RE = /\s+(\d+(?:\.\d+)?(?:\s+\d+(?:\.\d+)?){0,4})\s*$/

const MONEY_TOKEN_RE = /(?:rs\.?|₹|inr)\s*([\d,]+(?:\.\d{1,2})?)|([\d]{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?)/gi

const COMPANY_SUFFIX_RE =
  /\b(pvt\.?\s*ltd\.?|ltd\.?|llp|inc\.?|corp\.?|enterprises?|traders?|textiles?|fashions?|garments?|mills?|industries|company|co\.?)\b/i

const REJECT_SUPPLIER_WORDS =
  /^(tax|invoice|retail|cash|memo|original|duplicate|copy|bill|date|party|details|amount|total|grand|sub|net|gst|mobile|phone|email|address|state|pin|code|india|private|limited)$/i

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

const BILL_NUMBER_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  {
    pattern: /(?:invoice|inv\.?)\s*(?:no|number|#)?[.:\s-]+([A-Z0-9][A-Z0-9\-\/]{0,22})/gi,
    weight: 30,
  },
  {
    pattern: /(?:bill|voucher|challan)\s*(?:no|number|#)?[.:\s-]+([A-Z0-9][A-Z0-9\-\/]{0,22})/gi,
    weight: 24,
  },
  { pattern: /\bPO\s*(?:no|number|#)?[.:\s-]+([A-Z0-9][A-Z0-9\-\/]{0,22})/gi, weight: 18 },
]

const DATE_LINE_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /(?:invoice\s*date|bill\s*date|dated?|date)\s*[:\-]?\s*([^\n|]{4,24})/gi, weight: 30 },
]

const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b/i

const ADDRESS_LINE_RE =
  /\b(road|street|lane|nagar|colony|sector|plot|floor|building|near|opp|opposite|dist|district|pin\s*code|pincode|pin\s*-\s*\d{6}|\b\d{6}\b|maharashtra|gujarat|karnataka|tamil\s*nadu|delhi|mumbai|surat|ahmedabad|bangalore|chennai|hyderabad|kolkata|pune|jaipur|indore|lucknow)\b/i

const NON_ITEM_LINE_RE =
  /\b(m\/s|messrs|gstin|pan\s*no|fssai|cin\s*no|bank\s*name|account\s*no|ifsc|branch|authorised\s*signatory|terms\s*&?\s*conditions|subject\s*to|e\.?\s*-?\s*mail|website|www\.)\b/i

function normalizeWhitespace(text: string): string {
  return text.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function splitDocumentPages(text: string): string[] {
  const parts = text.split(PURCHASE_SCAN_PAGE_BREAK).map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [text]
}

function linesFromText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseMoneyToken(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim()
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100) / 100
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (day < 1 || day > 31 || month < 1 || month > 12) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  const now = new Date()
  const maxYear = now.getFullYear() + 1
  if (year < 2000 || year > maxYear) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseDateFragment(raw: string): string | null {
  const token = raw.trim().replace(/\s+/g, ' ')
  if (!token || /[A-Za-z]{4,}/.test(token.replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*/gi, ''))) {
    return null
  }

  let match = token.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
  if (match) {
    const day = Number(match[1])
    const month = Number(match[2])
    let year = Number(match[3])
    if (year < 100) year += year >= 70 ? 1900 : 2000
    return toIsoDate(year, month, day)
  }

  match = token.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/)
  if (match) {
    return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]))
  }

  match = token.match(/^(\d{1,2})[\/\-.]([A-Za-z]{3,9})[\/\-.](\d{2,4})$/i)
  if (match) {
    const month = MONTH_NAMES[match[2]!.slice(0, 3).toLowerCase()]
    if (!month) return null
    let year = Number(match[3])
    if (year < 100) year += year >= 70 ? 1900 : 2000
    return toIsoDate(year, month, Number(match[1]))
  }

  match = token.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/i)
  if (match) {
    const month = MONTH_NAMES[match[2]!.slice(0, 3).toLowerCase()]
    if (!month) return null
    let year = Number(match[3])
    if (year < 100) year += year >= 70 ? 1900 : 2000
    return toIsoDate(year, month, Number(match[1]))
  }

  return null
}

export function isValidIsoBillDate(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  return toIsoDate(year!, month!, day!) === value
}

export function isPlausibleBillNumber(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim()
  if (v.length < 2 || v.length > 24) return false
  if (!/^[A-Z0-9][A-Z0-9\-\/]*$/i.test(v)) return false
  if (/^[A-Za-z]+$/.test(v)) return false
  if (!/\d/.test(v) && !/^[A-Z]{2,6}[\/-][A-Z0-9]/i.test(v)) return false
  if (REJECT_SUPPLIER_WORDS.test(v)) return false
  if (/^\d{1,2}[\/\-.]\d{1,2}/.test(v)) return false
  return true
}

export function isPlausibleSupplierName(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim()
  if (v.length < 4 || v.length > 80) return false
  if (!/[A-Za-z]{3,}/.test(v)) return false
  if (/^\d+$/.test(v)) return false
  if (REJECT_SUPPLIER_WORDS.test(v)) return false
  if (/^(tax\s*invoice|retail\s*invoice|cash\s*memo)$/i.test(v)) return false
  if (/^\d{1,2}[\/\-.]\d{1,2}/.test(v)) return false
  if (/\b(gstin|invoice\s*no|bill\s*no|party\s*details)\b/i.test(v)) return false
  const words = v.split(/\s+/).filter(Boolean)
  if (words.length === 1 && !COMPANY_SUFFIX_RE.test(v) && v.length < 8) return false
  return true
}

function cleanBillNumberCapture(raw: string): string {
  return raw
    .split(/\s{2,}|\bdate\b|\bdated\b|\bgstin\b|\bparty\b|\bamount\b/i)[0]!
    .trim()
    .replace(/[.,;:]+$/g, '')
    .replace(/\s+/g, '')
}

function scoreTextSignals(text: string, patterns: RegExp[]): number {
  let score = 0
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    if (pattern.test(text)) score += 1
  }
  return score
}

export function classifyPurchaseBillMode(text: string): {
  mode: ExpenseBillMode | null
  confidence: PurchaseScanConfidence
} {
  const gstScore = scoreTextSignals(text, GST_SIGNALS)
  const noGstScore = scoreTextSignals(text, NO_GST_SIGNALS)

  if (gstScore >= 2 && gstScore > noGstScore) return { mode: 'no1', confidence: 'high' }
  if (noGstScore >= 1 && gstScore === 0) return { mode: 'no2', confidence: 'high' }
  if (gstScore >= 1 && noGstScore === 0) return { mode: 'no1', confidence: 'low' }
  if (noGstScore >= 1 && gstScore >= 1) return { mode: null, confidence: 'unknown' }
  if (gstScore === 1) return { mode: 'no1', confidence: 'low' }
  return { mode: null, confidence: 'unknown' }
}

function extractBillDate(text: string): string | undefined {
  const header = text.slice(0, Math.min(text.length, 3200))
  const candidates: DateCandidate[] = []

  for (const { pattern, weight } of DATE_LINE_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of header.matchAll(pattern)) {
      const fragment = (match[1] ?? '').trim().split(/\s{2,}|  /)[0] ?? ''
      const iso = parseDateFragment(fragment)
      if (iso) candidates.push({ iso, score: weight })
    }
  }

  const labeledNumeric =
    /(?:invoice\s*date|bill\s*date|dated?|date)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/gi
  labeledNumeric.lastIndex = 0
  for (const match of header.matchAll(labeledNumeric)) {
    const iso = parseDateFragment(match[1] ?? '')
    if (iso) candidates.push({ iso, score: 28 })
  }

  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.iso
}

function scoreBillNumber(value: string, weight: number): number {
  let score = weight
  if (!isPlausibleBillNumber(value)) return -100
  if (/^[A-Z]{2,6}\d{2,}/i.test(value)) score += 6
  if (/\d{2,}[\/-]\d+/.test(value)) score += 4
  return score
}

function extractBillNumber(text: string): string | undefined {
  const header = text.slice(0, Math.min(text.length, 2800))
  const candidates: BillNumberCandidate[] = []

  for (const { pattern, weight } of BILL_NUMBER_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of header.matchAll(pattern)) {
      const value = cleanBillNumberCapture(match[1] ?? '')
      const score = scoreBillNumber(value, weight)
      if (score > 0) candidates.push({ value, score })
    }
  }

  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.value
}

function findBuyerSectionStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (BUYER_SECTION_RE.test(lines[i] ?? '')) return i
  }
  return lines.length
}

function findItemTableStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (ITEM_TABLE_HEADER_RE.test(lines[i] ?? '')) return i
  }
  return Math.min(lines.length, Math.floor(lines.length * 0.45))
}

function findTotalsSectionStart(lines: string[]): number {
  for (let i = Math.floor(lines.length * 0.35); i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (
      /\b(sub\s*total|taxable|cgst|sgst|igst|grand\s*total|net\s*payable|amount\s*payable)\b/i.test(
        line,
      )
    ) {
      return i
    }
  }
  return Math.max(0, lines.length - 14)
}

function isInvoiceTitleLine(line: string): boolean {
  return /^(tax\s*invoice|retail\s*invoice|invoice|cash\s*memo|bill\s*of\s*supply|debit\s*note|credit\s*note)$/i.test(
    line.trim(),
  )
}

function cleanSupplierLine(line: string): string | undefined {
  const cleaned = stripMsPrefix(
    line
      .replace(SUPPLIER_HINT_RE, '')
      .replace(GSTIN_RE, '')
      .replace(/\bgstin\b.*$/i, '')
      .replace(/\b(?:invoice|bill|inv)\s*(?:no|number).*$/i, '')
      .replace(/\b(?:phone|mobile|tel|email|www\.|http).*/i, '')
      .replace(/[|:,-]+$/g, '')
      .trim(),
  )

  if (!isPlausibleSupplierName(cleaned)) return undefined
  if (isInvoiceTitleLine(cleaned)) return undefined
  return dedupeRepeatedPhrase(cleaned)
}

function extractNameBeforeGstin(line: string): string | undefined {
  const match = line.match(GSTIN_RE)
  if (!match || match.index == null) return undefined
  const before = line.slice(0, match.index).trim()
  if (!before) return undefined
  return cleanSupplierLine(before) ?? cleanSupplierLine(stripMsPrefix(before))
}

function mergeSupplierLines(lines: string[], index: number): string | undefined {
  const parts: string[] = []
  for (let i = Math.max(0, index - 2); i <= index; i++) {
    const line = lines[i] ?? ''
    if (BUYER_SECTION_RE.test(line) || isInvoiceTitleLine(line)) continue
    if (/\bgstin\b/i.test(line) && i !== index) continue
    const piece = extractNameBeforeGstin(line) ?? cleanSupplierLine(line)
    if (piece) parts.push(piece)
  }
  if (parts.length === 0) return undefined
  const merged = dedupeRepeatedPhrase(parts.join(' ').replace(/\s+/g, ' ').trim())
  return isPlausibleSupplierName(merged) ? merged : parts[parts.length - 1]
}

function scoreSupplierCandidate(line: string, index: number, buyerStart: number): number {
  const cleaned = cleanSupplierLine(line)
  if (!cleaned) return -100

  let score = 0
  if (index < buyerStart) score += 24
  if (index < 10) score += 14 - Math.min(index, 10)
  if (COMPANY_SUFFIX_RE.test(cleaned)) score += 16
  if (SUPPLIER_HINT_RE.test(line)) score += 12
  if (/\bgstin\b/i.test(line)) score += 8
  if (cleaned.length >= 8 && cleaned.length <= 55) score += 8
  if (BUYER_SECTION_RE.test(line)) score -= 50
  if (/\b(invoice|bill)\s*no\b/i.test(line)) score -= 20
  return score
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function dedupeRepeatedPhrase(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length < 8) return trimmed

  const words = trimmed.split(' ')
  if (words.length >= 4 && words.length % 2 === 0) {
    const half = words.length / 2
    const first = words.slice(0, half).join(' ')
    const second = words.slice(half).join(' ')
    if (normalizeForMatch(first) === normalizeForMatch(second)) return first
  }

  const compact = trimmed.replace(/\s+/g, '')
  const midpoint = Math.floor(compact.length / 2)
  if (midpoint >= 6) {
    const first = compact.slice(0, midpoint)
    const second = compact.slice(midpoint)
    if (first.toLowerCase() === second.toLowerCase()) {
      return trimmed.slice(0, Math.ceil(trimmed.length / 2)).trim()
    }
  }

  return trimmed
}

export function textsOverlap(a: string | undefined, b: string | undefined): boolean {
  const left = normalizeForMatch(a ?? '')
  const right = normalizeForMatch(b ?? '')
  if (!left || !right) return false
  if (left === right) return true
  if (left.length >= 5 && right.length >= 5) {
    if (left.includes(right) || right.includes(left)) return true
  }
  return false
}

function stripMsPrefix(value: string): string {
  return value.replace(/^(m\/s\.?|messrs\.?)\s*/i, '').trim()
}

/** Only accept supplier text that literally appears on the bill header — never invent from saved list. */
function extractSupplierName(pages: string[]): string | undefined {
  const firstPageLines = linesFromText(pages[0] ?? '')
  const buyerStart = findBuyerSectionStart(firstPageLines)
  const itemStart = findItemTableStart(firstPageLines)
  const headerEnd = Math.min(
    buyerStart,
    itemStart,
    Math.max(18, Math.floor(firstPageLines.length * 0.42)),
  )

  const candidates: Array<{ name: string; score: number }> = []

  for (let i = 0; i < headerEnd; i++) {
    const line = firstPageLines[i] ?? ''
    if (BUYER_SECTION_RE.test(line)) break

    if (GSTIN_RE.test(line) || /\bgstin\b/i.test(line)) {
      const merged = mergeSupplierLines(firstPageLines, i)
      if (merged) candidates.push({ name: merged, score: 90 - Math.min(i, 8) })
      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        const near = mergeSupplierLines(firstPageLines, j)
        if (near) candidates.push({ name: near, score: 82 - Math.min(j, 6) })
      }
    }

    if (SUPPLIER_HINT_RE.test(line)) {
      const hinted = cleanSupplierLine(line.replace(SUPPLIER_HINT_RE, '').trim())
      if (hinted) candidates.push({ name: hinted, score: 70 - Math.min(i, 6) })
    }

    const candidate = cleanSupplierLine(line)
    if (!candidate) continue
    const score = scoreSupplierCandidate(line, i, buyerStart)
    if (score >= 10) candidates.push({ name: candidate, score })
  }

  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (!best || best.score < 12) return undefined
  return dedupeRepeatedPhrase(best.name)
}

function parseTrailingNumbers(line: string): number[] {
  const match = line.match(TRAILING_NUMBERS_RE)
  if (!match) return []
  return (match[1] ?? '')
    .trim()
    .split(/\s+/)
    .map((token) => parseMoneyToken(token))
    .filter((value): value is number => value != null)
}

function cleanItemText(line: string): string {
  return line
    .replace(/^\d+\s+/, '')
    .replace(TRAILING_NUMBERS_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeItemLine(line: string, supplierName?: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length < 3 || trimmed.length > 140) return false
  if (SKIP_LINE_RE.test(trimmed)) return false
  if (NON_ITEM_LINE_RE.test(trimmed)) return false
  if (ADDRESS_LINE_RE.test(trimmed)) return false
  if (/^\d+(\.\d+)?$/.test(trimmed)) return false
  if (/^(rs\.?|₹|inr)\s*\d/i.test(trimmed)) return false
  if (!/[A-Za-z]/.test(trimmed)) return false
  if (/\bgstin\b/i.test(trimmed)) return false
  if (BUYER_SECTION_RE.test(trimmed)) return false
  if (isPlausibleSupplierName(trimmed) && COMPANY_SUFFIX_RE.test(trimmed)) return false
  if (textsOverlap(trimmed, supplierName)) return false
  if (isInvoiceTitleLine(trimmed)) return false
  return true
}

function scoreItemLine(line: string, trailingCount: number): number {
  let score = 0
  if (trailingCount >= 2) score += 18
  else if (trailingCount === 1) score += 8
  if (/\b(fabric|cotton|silk|poly|yarn|cloth|garment|dress|shirt|saree|kurta|piece|meter|mtr|lot|design|color|colour|size|style)\b/i.test(line)) {
    score += 14
  }
  if (COMPANY_SUFFIX_RE.test(line)) score -= 30
  if (ADDRESS_LINE_RE.test(line)) score -= 40
  if (NON_ITEM_LINE_RE.test(line)) score -= 40
  if (line.length >= 4 && line.length <= 80) score += 6
  return score
}

function parseLineItem(line: string, supplierName?: string): PurchaseScanLineItem | null {
  if (!looksLikeItemLine(line, supplierName)) return null

  const trailing = parseTrailingNumbers(line)
  const detail = cleanItemText(line)
  if (detail.length < 2) return null
  if (scoreItemLine(detail, trailing.length) < 0) return null

  let quantity: number | undefined
  let lineAmount: number | undefined

  if (trailing.length >= 3) {
    quantity = trailing[trailing.length - 3]
    lineAmount = trailing[trailing.length - 1]
  } else if (trailing.length === 2) {
    quantity = trailing[0]
    lineAmount = trailing[1]
  } else if (trailing.length === 1) {
    lineAmount = trailing[0]
  }

  if (/^\d+(\.\d+)?$/.test(detail)) return null
  return { name: detail, detail, quantity, lineAmount }
}

function extractLineItems(lines: string[], supplierName?: string): PurchaseScanLineItem[] {
  const start = findItemTableStart(lines) + 1
  const totalsStart = findTotalsSectionStart(lines)
  const items: PurchaseScanLineItem[] = []

  for (let i = start; i < totalsStart; i++) {
    const line = (lines[i] ?? '').trim()
    if (!line) continue
    if (/^(total|sub\s*total|grand\s*total|net\s)/i.test(line)) break
    const item = parseLineItem(line, supplierName)
    if (item) items.push(item)
  }

  return items
}

function pickFirstItemName(lineItems: PurchaseScanLineItem[], supplierName?: string): string | undefined {
  for (const item of lineItems) {
    const detail = item.detail.trim()
    if (!detail) continue
    if (textsOverlap(detail, supplierName)) continue
    if (isPlausibleSupplierName(detail) && COMPANY_SUFFIX_RE.test(detail)) continue
    return detail
  }
  return undefined
}

function isPieceCountContext(line: string, amount: number): boolean {
  if (/\b(pcs|pieces|pce|piece|qty|quantity|units)\b/i.test(line) && amount < 2000) return true
  if (/grand\s*total/i.test(line) && amount < 500 && !/(?:rs\.?|₹|inr)/i.test(line)) return true
  return false
}

function scoreMoneyCandidate(
  line: string,
  amount: number,
  lineIndex: number,
  totalLines: number,
  hasCurrency: boolean,
  pageWeight: number,
): number {
  let score = pageWeight

  if (hasCurrency) score += 30
  if (/\d{1,3}(?:,\d{2,3})+/.test(line)) score += 22
  if (amount >= 1000) score += 20
  else if (amount >= 500) score += 12
  else if (amount >= 100) score += 2
  else score -= 20

  if (/(?:grand\s*total|net\s*(?:amount|payable)|amount\s*payable|invoice\s*total|bill\s*total)/i.test(line)) {
    score += 16
    if (hasCurrency) score += 22
  }

  if (lineIndex >= totalLines * 0.55) score += 12
  if (lineIndex >= totalLines * 0.75) score += 14

  if (isPieceCountContext(line, amount)) score -= 80
  if (/\b(hsn|sac|rate|qty|quantity|pcs|pieces)\b/i.test(line) && !hasCurrency && amount < 2000) {
    score -= 30
  }

  return score
}

function collectMoneyCandidates(lines: string[], pageWeight = 0): MoneyCandidate[] {
  const candidates: MoneyCandidate[] = []
  const totalLines = lines.length

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    MONEY_TOKEN_RE.lastIndex = 0
    for (const match of line.matchAll(MONEY_TOKEN_RE)) {
      const raw = match[1] ?? match[2] ?? ''
      const amount = parseMoneyToken(raw)
      if (amount == null) continue
      const hasCurrency = Boolean(match[1])
      const score = scoreMoneyCandidate(line, amount, i, totalLines, hasCurrency, pageWeight)
      if (score > 0) candidates.push({ amount, score })
    }

    const trailing = parseTrailingNumbers(line)
    const last = trailing[trailing.length - 1]
    if (last != null) {
      const score = scoreMoneyCandidate(line, last, i, totalLines, /(?:rs\.?|₹|inr)/i.test(line), pageWeight)
      if (score > 0) candidates.push({ amount: last, score })
    }
  }

  return candidates
}

function extractTaxLadderTotal(lines: string[]): number | undefined {
  const start = findTotalsSectionStart(lines)
  const footer = lines.slice(start)
  let taxable: number | undefined
  let taxSum = 0
  let finalTotal: number | undefined

  for (const line of footer) {
    const trailing = parseTrailingNumbers(line)
    const last = trailing[trailing.length - 1]
    if (last == null) continue

    if (/(?:taxable|sub\s*total|basic\s*amount)/i.test(line) && !isPieceCountContext(line, last)) {
      taxable = last
    }
    if (/(?:cgst|sgst|igst)/i.test(line)) taxSum += last
    if (
      /(?:grand\s*total|net\s*payable|amount\s*payable|invoice\s*total)/i.test(line) &&
      !isPieceCountContext(line, last) &&
      (/(?:rs\.?|₹|inr)/i.test(line) || last >= 500 || /\d,/.test(line))
    ) {
      finalTotal = last
    }
  }

  if (taxable != null && taxSum > 0 && finalTotal != null) {
    const expected = taxable + taxSum
    if (Math.abs(expected - finalTotal) <= Math.max(50, finalTotal * 0.03)) return finalTotal
  }

  return finalTotal
}

function extractTotalAmount(pages: string[]): number | undefined {
  const lastPageLines = linesFromText(pages[pages.length - 1] ?? '')
  const taxLadderLast = extractTaxLadderTotal(lastPageLines)
  if (taxLadderLast != null && taxLadderLast >= 100) return taxLadderLast

  const taxLadderAll = extractTaxLadderTotal(pages.flatMap((page) => linesFromText(page)))
  if (taxLadderAll != null && taxLadderAll >= 100) return taxLadderAll

  const candidates: MoneyCandidate[] = []
  pages.forEach((page, index) => {
    const pageWeight = index === pages.length - 1 ? 32 : index === 0 ? 0 : 12
    candidates.push(...collectMoneyCandidates(linesFromText(page), pageWeight))
  })

  if (candidates.length > 0) {
    const best = candidates.reduce((top, row) => (row.score > top.score ? row : top))
    if (best.score >= 32) return best.amount
  }

  return undefined
}

function sanitizeScanResult(result: PurchaseScanResult): PurchaseScanResult {
  const partyName = isPlausibleSupplierName(result.partyName)
    ? dedupeRepeatedPhrase(result.partyName!.trim())
    : undefined
  let itemName = result.itemName?.trim() || undefined
  if (itemName && textsOverlap(itemName, partyName)) itemName = undefined
  if (itemName && isPlausibleSupplierName(itemName) && COMPANY_SUFFIX_RE.test(itemName)) {
    itemName = undefined
  }

  return {
    ...result,
    partyName,
    itemName,
    billNumber: isPlausibleBillNumber(result.billNumber) ? result.billNumber!.trim() : undefined,
    billDate: isValidIsoBillDate(result.billDate) ? result.billDate : undefined,
    totalAmount:
      result.totalAmount != null && result.totalAmount >= 1 ? result.totalAmount : undefined,
  }
}

export function parsePurchaseBillText(text: string, _supplierHints: string[] = []): PurchaseScanResult {
  const normalized = normalizeWhitespace(text)
  const pages = splitDocumentPages(normalized)
  const lines = pages.flatMap((page) => linesFromText(page))
  const classification = classifyPurchaseBillMode(normalized)
  const partyName = extractSupplierName(pages)
  const lineItems = extractLineItems(lines, partyName)
  const firstItem = pickFirstItemName(lineItems, partyName)

  const raw: PurchaseScanResult = {
    partyName,
    itemName: firstItem,
    totalAmount: extractTotalAmount(pages),
    billNumber: extractBillNumber(normalized),
    billDate: extractBillDate(normalized),
    billMode: classification.mode ?? undefined,
    billModeConfidence: classification.confidence,
    lineItems,
    rawText: normalized,
  }

  return sanitizeScanResult(raw)
}

/** Match saved supplier only when confirming user selection — not during OCR extract. */
export function matchSupplierName(extracted: string, suppliers: string[]): string | undefined {
  const raw = extracted.trim()
  if (!raw) return undefined
  const key = normalizeForMatch(raw)
  const exact = suppliers.find((name) => normalizeForMatch(name) === key)
  if (exact) return exact
  const contains = suppliers.find((name) => {
    const supplierKey = normalizeForMatch(name)
    return supplierKey.length >= 4 && (key.includes(supplierKey) || supplierKey.includes(key))
  })
  return contains ?? raw
}
