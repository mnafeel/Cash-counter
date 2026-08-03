import type { AppData } from '../types'
import { buildBackupDownloadName, createDataBackupFile } from '../utils/dataBackup'
import { loadData } from './database'

const SETTINGS_KEY = 'cash-counter-folder-daily-backup'
const HANDLE_DB = 'cash-counter-folder-backup'
const HANDLE_STORE = 'handles'
const HANDLE_KEY = 'daily-folder'

export interface FolderDailyBackupSettings {
  enabled: boolean
  /** Local 24h time `HH:MM` when the daily file is written. */
  time: string
  folderName: string
  /** Local calendar day `YYYY-MM-DD` of the last successful folder save. */
  lastBackupDate: string
  lastBackupAt: string | null
  lastError: string | null
}

type DirectoryHandle = FileSystemDirectoryHandle

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string
      mode?: 'read' | 'readwrite'
      startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
    }) => Promise<DirectoryHandle>
  }

  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite'
  }

  interface FileSystemHandle {
    queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>
    requestPermission?: (
      descriptor?: FileSystemHandlePermissionDescriptor,
    ) => Promise<PermissionState>
  }
}

const DEFAULT_SETTINGS: FolderDailyBackupSettings = {
  enabled: false,
  time: '21:00',
  folderName: '',
  lastBackupDate: '',
  lastBackupAt: null,
  lastError: null,
}

let checkTimer: ReturnType<typeof setInterval> | null = null
let running = false

function localDayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function normalizeTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return DEFAULT_SETTINGS.time
  const hour = Math.min(23, Math.max(0, Number(match[1])))
  const minute = Math.min(59, Math.max(0, Number(match[2])))
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function isFolderBackupSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export function getFolderDailyBackupSettings(): FolderDailyBackupSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<FolderDailyBackupSettings>
    return {
      enabled: Boolean(parsed.enabled),
      time: normalizeTime(typeof parsed.time === 'string' ? parsed.time : DEFAULT_SETTINGS.time),
      folderName: typeof parsed.folderName === 'string' ? parsed.folderName : '',
      lastBackupDate: typeof parsed.lastBackupDate === 'string' ? parsed.lastBackupDate : '',
      lastBackupAt: typeof parsed.lastBackupAt === 'string' ? parsed.lastBackupAt : null,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(next: FolderDailyBackupSettings): FolderDailyBackupSettings {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  return next
}

export function setFolderDailyBackupEnabled(enabled: boolean): FolderDailyBackupSettings {
  const current = getFolderDailyBackupSettings()
  return saveSettings({ ...current, enabled: Boolean(enabled), lastError: null })
}

export function setFolderDailyBackupTime(time: string): FolderDailyBackupSettings {
  const current = getFolderDailyBackupSettings()
  return saveSettings({ ...current, time: normalizeTime(time), lastError: null })
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1)
    request.onerror = () => reject(request.error ?? new Error('Could not open folder backup storage'))
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function storeDirectoryHandle(handle: DirectoryHandle): Promise<void> {
  const db = await openHandleDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Could not save folder'))
  })
}

async function loadDirectoryHandle(): Promise<DirectoryHandle | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openHandleDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readonly')
      const request = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY)
      request.onsuccess = () => resolve((request.result as DirectoryHandle | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('Could not read folder'))
    })
  } catch {
    return null
  }
}

async function ensureWritePermission(handle: DirectoryHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' }
  try {
    if (handle.queryPermission) {
      const current = await handle.queryPermission(opts)
      if (current === 'granted') return true
    }
    if (handle.requestPermission) {
      const next = await handle.requestPermission(opts)
      return next === 'granted'
    }
    return true
  } catch {
    return false
  }
}

export async function chooseFolderDailyBackupDir(): Promise<FolderDailyBackupSettings> {
  if (!isFolderBackupSupported() || !window.showDirectoryPicker) {
    throw new Error('Folder backup needs Chrome or Edge on this device.')
  }

  const handle = await window.showDirectoryPicker({
    id: 'cash-counter-daily-backup',
    mode: 'readwrite',
    startIn: 'documents',
  })

  const allowed = await ensureWritePermission(handle)
  if (!allowed) {
    throw new Error('Permission denied for that folder. Choose it again and allow edit access.')
  }

  await storeDirectoryHandle(handle)
  const current = getFolderDailyBackupSettings()
  return saveSettings({
    ...current,
    folderName: handle.name,
    lastError: null,
  })
}

export async function clearFolderDailyBackupDir(): Promise<FolderDailyBackupSettings> {
  try {
    const db = await openHandleDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite')
      tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Could not clear folder'))
    })
  } catch {
    // ignore
  }
  const current = getFolderDailyBackupSettings()
  return saveSettings({
    ...current,
    enabled: false,
    folderName: '',
    lastError: null,
  })
}

async function writeBackupToHandle(handle: DirectoryHandle, data: AppData): Promise<string> {
  const payload = createDataBackupFile(data)
  const filename = buildBackupDownloadName(new Date(payload.exportedAt))
  const fileHandle = await handle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(payload, null, 2))
  await writable.close()
  return filename
}

export async function runFolderDailyBackupNow(
  source?: AppData,
  options?: { force?: boolean },
): Promise<{ filename: string; settings: FolderDailyBackupSettings }> {
  const settings = getFolderDailyBackupSettings()
  const handle = await loadDirectoryHandle()
  if (!handle) {
    const next = saveSettings({
      ...settings,
      lastError: 'No backup folder selected.',
    })
    throw new Error(next.lastError ?? 'No backup folder selected.')
  }

  const allowed = await ensureWritePermission(handle)
  if (!allowed) {
    const next = saveSettings({
      ...settings,
      lastError: 'Folder permission expired. Choose the folder again.',
    })
    throw new Error(next.lastError ?? 'Folder permission expired.')
  }

  const today = localDayKey()
  if (!options?.force && settings.lastBackupDate === today) {
    return { filename: '', settings }
  }

  const data = source ?? loadData()
  const filename = await writeBackupToHandle(handle, data)
  const next = saveSettings({
    ...settings,
    folderName: handle.name || settings.folderName,
    lastBackupDate: today,
    lastBackupAt: new Date().toISOString(),
    lastError: null,
  })
  return { filename, settings: next }
}

function minutesNow(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes()
}

function minutesFromTime(time: string): number {
  const normalized = normalizeTime(time)
  const [h, m] = normalized.split(':').map(Number)
  return h * 60 + m
}

export async function checkFolderDailyBackupDue(source?: AppData): Promise<boolean> {
  if (running) return false
  const settings = getFolderDailyBackupSettings()
  if (!settings.enabled) return false
  if (!settings.folderName) return false
  if (!isFolderBackupSupported()) return false

  const today = localDayKey()
  if (settings.lastBackupDate === today) return false
  if (minutesNow() < minutesFromTime(settings.time)) return false

  running = true
  try {
    await runFolderDailyBackupNow(source, { force: true })
    return true
  } catch {
    return false
  } finally {
    running = false
  }
}

export function startFolderDailyBackupScheduler(): void {
  if (typeof window === 'undefined') return
  if (checkTimer) return

  const tick = () => {
    void checkFolderDailyBackupDue()
  }

  tick()
  checkTimer = setInterval(tick, 30_000)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick()
  })
}

export function formatFolderBackupTimeLabel(time: string): string {
  const normalized = normalizeTime(time)
  const [h, m] = normalized.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
