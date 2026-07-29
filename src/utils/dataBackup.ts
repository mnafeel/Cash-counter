import type { AppData } from '../types'
import { normalizeData } from '../storage/database'

export const BACKUP_FORMAT = 'cash-counter-backup'
export const BACKUP_VERSION = 1

export interface DataBackupFile {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  summary: {
    salesCount: number
    expensesCount: number
    pendingCount: number
    loansCount: number
    openingCash: number
    openingBank: number
  }
  data: AppData
}

function backupSummary(data: AppData): DataBackupFile['summary'] {
  return {
    salesCount: data.sales.length,
    expensesCount: data.expenses.length,
    pendingCount: data.sales.filter((sale) => sale.status === 'pending').length,
    loansCount: data.loans?.length ?? 0,
    openingCash: data.openingBalance,
    openingBank: data.openingBankBalance ?? 0,
  }
}

export function createDataBackupFile(data: AppData): DataBackupFile {
  const normalized = normalizeData(data)
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    summary: backupSummary(normalized),
    data: normalized,
  }
}

export function buildBackupDownloadName(exportedAt = new Date()): string {
  const stamp = exportedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `cash-counter-backup-${stamp}.json`
}

function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadDataBackup(data: AppData): DataBackupFile {
  const payload = createDataBackupFile(data)
  const json = JSON.stringify(payload, null, 2)
  triggerDownload(buildBackupDownloadName(new Date(payload.exportedAt)), json, 'application/json')
  return payload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function looksLikeAppData(value: unknown): value is AppData {
  if (!isRecord(value)) return false
  return Array.isArray(value.sales) && Array.isArray(value.expenses)
}

export function parseDataBackupText(raw: string): AppData {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Backup file is not valid JSON.')
  }

  if (!isRecord(parsed)) {
    throw new Error('Backup file is empty or invalid.')
  }

  if (parsed.format === BACKUP_FORMAT) {
    if (!looksLikeAppData(parsed.data)) {
      throw new Error('Backup file is missing sales or expenses data.')
    }
    return normalizeData(parsed.data)
  }

  if (looksLikeAppData(parsed)) {
    return normalizeData(parsed as AppData)
  }

  throw new Error('Unrecognized backup file format.')
}

export async function readBackupFile(file: File): Promise<AppData> {
  const text = await file.text()
  return parseDataBackupText(text)
}

export function formatBackupSummary(data: AppData): string {
  const summary = backupSummary(normalizeData(data))
  const loansPart = summary.loansCount > 0 ? ` · ${summary.loansCount} loans` : ''
  return `${summary.salesCount} bills · ${summary.expensesCount} records · ${summary.pendingCount} pending${loansPart}`
}
