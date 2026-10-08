import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeBackup, decodeBackup, parseBackupStorage } from '../src/firebase/backupChunks.ts'

test('multi-megabyte backup round trips without oversized documents', () => {
  const data = { sales: Array.from({ length: 20000 }, (_, id) => ({ id, note: 'invoice '.repeat(20) })), expenses: [] }
  const { storage, chunks } = encodeBackup(data, 'backup_123')
  assert.ok(storage.byteLength > 1048576)
  assert.ok(chunks.length > 1)
  for (const body of chunks) assert.ok(Buffer.byteLength(body) <= 600000)
  assert.deepEqual(decodeBackup(storage, chunks), data)
})

test('Unicode and surrogate pairs survive UTF-8 storage at chunk boundaries', () => {
  const data = { note: 'x'.repeat(199990) + '😀हिंदी தமிழ்'.repeat(80000), loneSurrogate: '\ud800' }
  const { storage, chunks } = encodeBackup(data, 'unicode')
  const stored = chunks.map((part) => Buffer.from(part).toString('utf8'))
  for (const body of stored) assert.ok(Buffer.byteLength(body) <= 600000)
  assert.deepEqual(decodeBackup(storage, stored), data)
})

test('missing and truncated chunks fail rather than returning partial data', () => {
  const { storage, chunks } = encodeBackup({ note: 'a'.repeat(600000) }, 'missing')
  assert.throws(() => decodeBackup(storage, chunks.slice(1)), /incomplete/)
  assert.throws(() => decodeBackup(storage, chunks.map((v, i) => i ? v : undefined)), /incomplete/)
  assert.throws(() => decodeBackup(storage, chunks.map((v, i) => i ? v : v.slice(1))), /size did not match/)
})

test('manifest rejects unsupported formats and unsafe chunk paths/counts', () => {
  const { storage } = encodeBackup({ sales: [] }, 'valid')
  assert.deepEqual(parseBackupStorage(storage), storage)
  for (const invalid of [null, {}, { ...storage, format: 'future' }, { ...storage, backupId: '../other' }, { ...storage, chunkCount: 0 }, { ...storage, chunkCount: 1.5 }]) {
    assert.throws(() => parseBackupStorage(invalid))
  }
})

test('checksum rejects same-length corruption and accepts previous checksum-free backups', async () => {
  const { backupChecksum, verifyBackupChecksum } = await import('../src/firebase/backupChunks.ts')
  const { storage, chunks } = encodeBackup({ sales: [{ amount: 100 }], expenses: [] }, 'checksum')
  await verifyBackupChecksum(storage, chunks)
  storage.sha256 = await backupChecksum(chunks)
  await verifyBackupChecksum(storage, chunks)
  await assert.rejects(verifyBackupChecksum(storage, chunks.map((part) => part.replace('100', '900'))), /integrity/)
})

test('manifest-only and malformed data cannot be normalized into an empty account', async () => {
  const { assertBackupData } = await import('../src/firebase/backupChunks.ts')
  for (const data of [{ _storage: {} }, { sales: [], expenses: null }, [], null]) assert.throws(() => assertBackupData(data))
  assert.doesNotThrow(() => assertBackupData({ sales: [], expenses: [] }))
})
