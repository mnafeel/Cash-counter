// At most 600 KB of UTF-8 per part, leaving room for Firestore metadata.
const CHUNK_CHARACTERS = 200_000

export interface BackupStorage {
  format: 'json-chunks-v1'
  backupId: string
  chunkCount: number
  byteLength: number
  sha256?: string
}

export function encodeBackup(data: unknown, backupId: string): { storage: BackupStorage; chunks: string[] } {
  const json = JSON.stringify(data)
  if (!json) throw new Error('Cannot back up empty data.')
  const chunks: string[] = []
  for (let start = 0; start < json.length;) {
    let end = Math.min(start + CHUNK_CHARACTERS, json.length)
    // Keep surrogate pairs together so Firestore's UTF-8 encoding is lossless.
    const last = json.charCodeAt(end - 1)
    if (end < json.length && last >= 0xd800 && last <= 0xdbff) end--
    chunks.push(json.slice(start, end))
    start = end
  }
  return {
    storage: {
      format: 'json-chunks-v1', backupId, chunkCount: chunks.length,
      byteLength: new TextEncoder().encode(json).byteLength,
    },
    chunks,
  }
}

export function parseBackupStorage(value: unknown): BackupStorage {
  const storage = value as Partial<BackupStorage> | null
  if (!storage || storage.format !== 'json-chunks-v1'
    || typeof storage.backupId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(storage.backupId)
    || !Number.isSafeInteger(storage.chunkCount) || storage.chunkCount! < 1
    || !Number.isSafeInteger(storage.byteLength) || storage.byteLength! < 1) {
    throw new Error('Unsupported or damaged cloud backup. Update the app or retry the backup.')
  }
  return storage as BackupStorage
}

export function decodeBackup(storage: BackupStorage, chunks: unknown[]): Record<string, unknown> {
  if (chunks.length !== storage.chunkCount || chunks.some((part) => typeof part !== 'string')) {
    throw new Error('Cloud backup is incomplete. Retry loading; local data has not been replaced.')
  }
  const json = chunks.join('')
  if (new TextEncoder().encode(json).byteLength !== storage.byteLength) {
    throw new Error('Cloud backup size did not match. Retry loading; local data has not been replaced.')
  }
  const data: unknown = JSON.parse(json)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid cloud backup data.')
  }
  return data as Record<string, unknown>
}

export async function backupChecksum(chunks: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chunks.join('')))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyBackupChecksum(storage: BackupStorage, chunks: unknown[]): Promise<void> {
  if (storage.sha256 === undefined) return // Legacy chunk backups predate checksums.
  if (!/^[a-f0-9]{64}$/.test(storage.sha256)
    || chunks.some((chunk) => typeof chunk !== 'string')
    || await backupChecksum(chunks as string[]) !== storage.sha256) {
    throw new Error('Cloud backup integrity check failed. Local data has not been replaced.')
  }
}

export function assertBackupData(data: unknown): asserts data is Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid backup data.')
  const record = data as Record<string, unknown>
  if (!Array.isArray(record.sales) || !Array.isArray(record.expenses)) {
    throw new Error('Backup is missing sales or expenses. Local data has not been replaced.')
  }
}
