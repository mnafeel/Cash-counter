import { XMLParser } from 'fast-xml-parser'

export type TallyDateScope = 'today' | 'week' | 'month'

export interface TallyBill {
  id: string
  billAmount: number
  customerName?: string
  createdAt?: string
}

const toArray = <T>(x: T | T[] | null | undefined): T[] =>
  x == null ? [] : Array.isArray(x) ? x : [x]

function ymd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function dateRange(scope: TallyDateScope): { from: string; to: string } {
  const now = new Date()
  if (scope === 'week') {
    const from = new Date(now)
    from.setDate(now.getDate() - 6)
    return { from: ymd(from), to: ymd(now) }
  }
  if (scope === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: ymd(from), to: ymd(now) }
  }
  return { from: ymd(now), to: ymd(now) }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c,
  )
}

function buildDayBookRequest(from: string, to: string, company?: string): string {
  const companyTag = company ? `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>` : ''
  return `<ENVELOPE>
 <HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Data</TYPE>
  <ID>Day Book</ID>
 </HEADER>
 <BODY>
  <DESC>
   <STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVFROMDATE>${from}</SVFROMDATE>
    <SVTODATE>${to}</SVTODATE>
    ${companyTag}
   </STATICVARIABLES>
  </DESC>
 </BODY>
</ENVELOPE>`
}

function decodeTallyBody(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  if (bytes.length >= 2 && bytes[1] === 0x00) {
    const decoder = new TextDecoder('utf-16le')
    return decoder.decode(buf)
  }
  const decoder = new TextDecoder('utf-8')
  return decoder.decode(buf)
}

/** Same-origin /__tally-api proxy (vite dev/preview) when Tally is on another host/port. */
async function postTallyXml(apiUrl: string, xml: string): Promise<string> {
  const target = apiUrl.replace(/\/+$/, '')
  let useProxy = false
  try {
    useProxy = new URL(target).origin !== window.location.origin
  } catch {
    useProxy = true
  }

  const url = useProxy ? '/__tally-api' : target
  const headers: Record<string, string> = { 'Content-Type': 'text/xml' }
  if (useProxy) headers['X-Tally-Target'] = target

  const res = await fetch(url, { method: 'POST', headers, body: xml, cache: 'no-store' })
  if (!res.ok) throw new Error(`Tally responded HTTP ${res.status}`)
  return decodeTallyBody(await res.arrayBuffer())
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
})

function extractVouchers(xml: string): Record<string, unknown>[] {
  let parsed: Record<string, unknown>
  try {
    parsed = parser.parse(xml) as Record<string, unknown>
  } catch {
    return []
  }
  const envelope = parsed.ENVELOPE as Record<string, unknown> | undefined
  const body = (envelope?.BODY ?? parsed.BODY ?? parsed) as Record<string, unknown>
  const importData = body.IMPORTDATA as Record<string, unknown> | undefined
  const data = (body.DATA ?? importData?.REQUESTDATA ?? body) as Record<string, unknown>
  const vouchers: Record<string, unknown>[] = []
  for (const msg of toArray(data.TALLYMESSAGE)) {
    const msgObj = msg as Record<string, unknown>
    for (const v of toArray(msgObj.VOUCHER)) {
      vouchers.push(v as Record<string, unknown>)
    }
  }
  if (vouchers.length === 0) {
    for (const v of toArray(data.VOUCHER)) {
      vouchers.push(v as Record<string, unknown>)
    }
  }
  return vouchers
}

function isSalesVoucher(type: string): boolean {
  const t = type.toLowerCase()
  if (/credit|debit|payment|receipt|journal|contra|purchase/i.test(t)) return false
  return /sales|invoice|retail/i.test(t)
}

function extractAmount(v: Record<string, unknown>, party: string): number {
  const entries = [
    ...toArray(v['ALLLEDGERENTRIES.LIST'] as Record<string, unknown> | undefined),
    ...toArray(v['LEDGERENTRIES.LIST'] as Record<string, unknown> | undefined),
  ]
  let partyAmt = 0
  let positiveSum = 0
  for (const entry of entries) {
    const e = entry as Record<string, unknown>
    const name = String(e.LEDGERNAME ?? '').trim()
    const raw = parseFloat(String(e.AMOUNT ?? '0')) || 0
    if (name && party && name === party) partyAmt = Math.max(partyAmt, Math.abs(raw))
    if (raw > 0) positiveSum += raw
  }
  if (partyAmt > 0) return partyAmt
  if (positiveSum > 0) return positiveSum
  return Math.abs(parseFloat(String(v.AMOUNT ?? '0')) || 0)
}

function ymdToIso(s: string): string {
  if (!/^\d{8}$/.test(s)) return new Date().toISOString()
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`).toISOString()
}

function docIdFor(guid: string, voucherNumber: string, dateRaw: string): string {
  const base = guid || `${voucherNumber}-${dateRaw}`
  return base.replace(/[/.#$[\]\s]+/g, '_').slice(0, 200) || `v-${Date.now()}`
}

export async function collectTallyBills(
  apiUrl: string,
  scope: TallyDateScope,
  company = '',
): Promise<TallyBill[]> {
  const trimmed = apiUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return []

  const { from, to } = dateRange(scope)
  const xml = buildDayBookRequest(from, to, company)
  const raw = await postTallyXml(trimmed, xml)

  return extractVouchers(raw)
    .map((v) => {
      const party = String(v.PARTYLEDGERNAME ?? v.PARTYNAME ?? '').trim()
      const type = String(v.VOUCHERTYPENAME ?? '').trim()
      const guid = String(v.GUID ?? v.MASTERID ?? '').trim()
      const dateRaw = String(v.DATE ?? '').trim()
      const voucherNumber = String(v.VOUCHERNUMBER ?? '').trim()
      const canceled = String(v.ISCANCELLED ?? '').toLowerCase() === 'yes'
      const optional = String(v.ISOPTIONAL ?? '').toLowerCase() === 'yes'
      const amount = extractAmount(v, party)
      return { party, type, guid, dateRaw, voucherNumber, amount, canceled, optional }
    })
    .filter((v) => !v.canceled && !v.optional)
    .filter((v) => v.amount > 0)
    .filter((v) => isSalesVoucher(v.type))
    .map((v) => ({
      id: docIdFor(v.guid, v.voucherNumber, v.dateRaw),
      billAmount: v.amount,
      customerName: v.party || undefined,
      createdAt: v.dateRaw ? ymdToIso(v.dateRaw) : undefined,
    }))
}

export async function testTallyApi(
  apiUrl: string,
  scope: TallyDateScope,
): Promise<{ connected: boolean; billCount: number; error?: string }> {
  const trimmed = apiUrl.trim()
  if (!trimmed) {
    return { connected: false, billCount: 0, error: 'Enter the Tally API URL first.' }
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return { connected: false, billCount: 0, error: 'URL must start with http://' }
  }
  try {
    const bills = await collectTallyBills(trimmed, scope)
    return { connected: true, billCount: bills.length }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection failed'
    if (/failed to fetch|network|cors/i.test(msg)) {
      return {
        connected: false,
        billCount: 0,
        error:
          'Cannot reach Tally. Run npm run dev on the Tally PC, enable Tally HTTP server (F12), and use http://localhost:9999',
      }
    }
    return { connected: false, billCount: 0, error: msg }
  }
}
