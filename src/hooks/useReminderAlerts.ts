import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCash } from '../context/CashContext'
import {
  buildBillReminders,
  getReminderAlertSettings,
  type BillReminderItem,
  type BillReminderPhase,
} from '../utils/billReminders'
import { buildLoanReminders, type LoanReminderItem } from '../utils/loanReminders'
import { useCashSnapshot } from './useCashSnapshot'
import {
  buildReminderNavigationPath,
  shouldStorePendingReminderNavigation,
  storePendingReminderNavigation,
} from '../utils/reminderNavigation'
import {
  isReminderSoundPlaying,
  playReminderNotificationSound,
  startAlertReminderSound,
  stopReminderNotificationSound,
  subscribeReminderSoundPlaying,
  type ReminderSoundStyle,
} from '../utils/reminderNotificationSound'

const DISMISSED_STORAGE_KEY = 'cash-counter-dismissed-reminder-alerts'
const SOUND_PLAYED_STORAGE_KEY = 'cash-counter-reminder-sound-played'
const SOUND_MUTED_STORAGE_KEY = 'cash-counter-reminder-sound-muted'

/** Gap between one toast leaving and the next arriving. */
export const REMINDER_TOAST_STAGGER_MS = 3200
/** How long each toast stays on screen. */
export const REMINDER_TOAST_SHOW_MS = 6000

export type UnifiedReminderAlert = {
  dismissKey: string
  kind: 'credit' | 'cheque' | 'other' | 'loan'
  title: string
  amount: number
  alertLabel: string
  reminderDateLabel: string
  reminderSortAt: string
  reminderNote?: string
  isDue: boolean
  isOverdue: boolean
  isAlertActive: boolean
  phase: BillReminderPhase
  soundStyle: ReminderSoundStyle
  saleId?: string
  loanId?: string
}

function readSoundMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_MUTED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeSoundMuted(muted: boolean) {
  try {
    if (muted) localStorage.setItem(SOUND_MUTED_STORAGE_KEY, '1')
    else localStorage.removeItem(SOUND_MUTED_STORAGE_KEY)
  } catch {
    // ignore quota errors
  }
}

function readLastSoundPlayedAt(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SOUND_PLAYED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const next: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof value === 'number') next[key] = value
    }
    return next
  } catch {
    return {}
  }
}

function writeLastSoundPlayedAt(map: Record<string, number>) {
  try {
    localStorage.setItem(SOUND_PLAYED_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota errors
  }
}

function useNow(tickMs = 5000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), tickMs)
    return () => window.clearInterval(id)
  }, [tickMs])
  return now
}

function billAlert(item: BillReminderItem): UnifiedReminderAlert {
  return {
    dismissKey: `bill|${item.saleId}|${item.reminderAt}`,
    kind: item.kind,
    title: item.customerName,
    amount: item.amount,
    alertLabel: item.alertLabel,
    reminderDateLabel: item.reminderDateLabel,
    reminderSortAt: item.reminderAt,
    reminderNote: item.reminderNote,
    isDue: item.isDue,
    isOverdue: item.isOverdue,
    isAlertActive: item.isAlertActive,
    phase: item.phase,
    soundStyle: 'normal',
    saleId: item.saleId,
  }
}

function loanAlert(item: LoanReminderItem): UnifiedReminderAlert {
  return {
    dismissKey: `loan|${item.loanId}|${item.reminderAt}`,
    kind: 'loan',
    title: item.personName,
    amount: item.amount,
    alertLabel: item.alertLabel,
    reminderDateLabel: item.reminderDateLabel,
    reminderSortAt: item.reminderAt,
    reminderNote: item.reminderNote,
    isDue: item.isDue,
    isOverdue: item.isOverdue,
    isAlertActive: item.isAlertActive,
    phase: item.phase,
    soundStyle: item.soundStyle,
    loanId: item.loanId,
  }
}

function readDismissedKeys(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((key) => typeof key === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function writeDismissedKeys(keys: Set<string>) {
  sessionStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...keys]))
}

export function reminderKindIcon(kind: UnifiedReminderAlert['kind']): string {
  if (kind === 'credit') return '💳'
  if (kind === 'cheque') return '🧾'
  if (kind === 'loan') return '🤝'
  return '🔔'
}

export function useReminderAlerts() {
  const { data } = useCash()
  const { homeUnlocked } = useCashSnapshot(true)
  const navigate = useNavigate()
  const mightHaveReminders = useMemo(() => {
    if (data.sales.some((sale) => sale.reminderAt)) return true
    if ((data.loans ?? []).some((loan) => !loan.settledAt && loan.reminderAt)) return true
    const customerReminders = data.customerReminders
    if (customerReminders && Object.keys(customerReminders).length > 0) return true
    return false
  }, [data])
  const now = useNow(mightHaveReminders ? 5000 : 60000)
  const alertSettings = useMemo(() => getReminderAlertSettings(data), [data])
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(readDismissedKeys)
  const [soundPlaying, setSoundPlaying] = useState(false)
  const [soundMuted, setSoundMuted] = useState(readSoundMuted)
  const [activeToast, setActiveToast] = useState<UnifiedReminderAlert | null>(null)
  const [toastQueueLength, setToastQueueLength] = useState(0)
  const [incomingKeys, setIncomingKeys] = useState<Set<string>>(new Set())
  const [deliveredKeys, setDeliveredKeys] = useState<Set<string>>(new Set())
  const prevAlertStateRef = useRef<Record<string, { visible: boolean; due: boolean }>>({})
  const lastSoundPlayedRef = useRef<Record<string, number>>(readLastSoundPlayedAt())
  const hasSyncedAlertsRef = useRef(false)
  const toastQueueRef = useRef<string[]>([])
  const toastShownRef = useRef<Set<string>>(new Set())
  const toastPumpRef = useRef(false)
  const activeToastRef = useRef<UnifiedReminderAlert | null>(null)
  const toastHideTimerRef = useRef<number | null>(null)
  const toastGapTimerRef = useRef<number | null>(null)
  const visibleActiveAlertsRef = useRef<UnifiedReminderAlert[]>([])
  const pumpToastQueueRef = useRef<() => void>(() => {})

  useEffect(() => {
    setSoundPlaying(isReminderSoundPlaying())
    return subscribeReminderSoundPlaying(() => setSoundPlaying(isReminderSoundPlaying()))
  }, [])

  const queuedReminders = useMemo(() => {
    const bills = buildBillReminders(data, now).map(billAlert)
    const loans = buildLoanReminders(data, now).map(loanAlert)
    return [...bills, ...loans].sort(
      (a, b) => new Date(a.reminderSortAt).getTime() - new Date(b.reminderSortAt).getTime(),
    )
  }, [data, now])

  const activeAlerts = useMemo(
    () => queuedReminders.filter((item) => item.isAlertActive),
    [queuedReminders],
  )

  const visibleActiveAlerts = useMemo(
    () => activeAlerts.filter((item) => !dismissedKeys.has(item.dismissKey)),
    [activeAlerts, dismissedKeys],
  )

  visibleActiveAlertsRef.current = visibleActiveAlerts

  const visibleAlertKeys = useMemo(
    () => visibleActiveAlerts.map((item) => item.dismissKey).sort().join('|'),
    [visibleActiveAlerts],
  )

  const clearToastTimers = useCallback(() => {
    if (toastHideTimerRef.current !== null) {
      window.clearTimeout(toastHideTimerRef.current)
      toastHideTimerRef.current = null
    }
    if (toastGapTimerRef.current !== null) {
      window.clearTimeout(toastGapTimerRef.current)
      toastGapTimerRef.current = null
    }
  }, [])

  pumpToastQueueRef.current = () => {
    if (toastPumpRef.current || activeToastRef.current) return
    const nextKey = toastQueueRef.current.shift()
    setToastQueueLength(toastQueueRef.current.length)
    if (!nextKey) return

    const alert = visibleActiveAlertsRef.current.find((item) => item.dismissKey === nextKey)
    if (!alert) {
      window.setTimeout(() => pumpToastQueueRef.current(), 0)
      return
    }

    toastPumpRef.current = true
    toastShownRef.current.add(nextKey)
    activeToastRef.current = alert
    setActiveToast(alert)
    setDeliveredKeys((prev) => new Set(prev).add(nextKey))
    setIncomingKeys(new Set([nextKey]))
    window.setTimeout(() => setIncomingKeys(new Set()), 900)

    toastHideTimerRef.current = window.setTimeout(() => {
      activeToastRef.current = null
      setActiveToast(null)
      toastHideTimerRef.current = null
      toastGapTimerRef.current = window.setTimeout(() => {
        toastPumpRef.current = false
        toastGapTimerRef.current = null
        pumpToastQueueRef.current()
      }, REMINDER_TOAST_STAGGER_MS)
    }, REMINDER_TOAST_SHOW_MS)
  }

  const enqueueToasts = useCallback((keys: string[]) => {
    let added = false
    for (const key of keys) {
      if (toastShownRef.current.has(key)) continue
      if (toastQueueRef.current.includes(key)) continue
      toastQueueRef.current.push(key)
      added = true
    }
    if (!added) return
    setToastQueueLength(toastQueueRef.current.length)
    if (!activeToastRef.current && !toastPumpRef.current) {
      pumpToastQueueRef.current()
    }
  }, [])

  useEffect(() => {
    writeDismissedKeys(dismissedKeys)
  }, [dismissedKeys])

  useEffect(() => {
    const fresh = visibleActiveAlerts
      .map((item) => item.dismissKey)
      .filter((key) => !toastShownRef.current.has(key) && !toastQueueRef.current.includes(key))
    if (fresh.length > 0) enqueueToasts(fresh)
  }, [visibleAlertKeys, visibleActiveAlerts, enqueueToasts])

  useEffect(() => {
    return () => clearToastTimers()
  }, [clearToastTimers])

  useEffect(() => {
    if (!alertSettings.notificationSoundEnabled || soundMuted) {
      stopReminderNotificationSound()
      return
    }

    const dueAlerts = visibleActiveAlerts.filter((item) => item.isDue || item.isOverdue)
    if (dueAlerts.length === 0) {
      stopReminderNotificationSound()
      prevAlertStateRef.current = {}
      return
    }

    const nowMs = Date.now()
    const repeatMs = Math.max(1, alertSettings.notificationSoundRepeatSeconds) * 1000
    let shouldPlay = false
    const nextState: Record<string, { visible: boolean; due: boolean }> = {}

    for (const item of visibleActiveAlerts) {
      const due = item.isDue || item.isOverdue
      const prev = prevAlertStateRef.current[item.dismissKey]
      nextState[item.dismissKey] = { visible: true, due }

      if (!due) continue
      if (!hasSyncedAlertsRef.current) continue

      const lastPlayed = lastSoundPlayedRef.current[item.dismissKey] ?? 0
      if (!prev?.due) {
        if (nowMs - lastPlayed >= repeatMs) shouldPlay = true
      } else if (alertSettings.notificationSoundMode !== 'once' && nowMs - lastPlayed >= repeatMs) {
        shouldPlay = true
      }
    }

    prevAlertStateRef.current = nextState
    hasSyncedAlertsRef.current = true

    if (!shouldPlay) return

    for (const item of dueAlerts) {
      lastSoundPlayedRef.current[item.dismissKey] = nowMs
    }
    writeLastSoundPlayedAt(lastSoundPlayedRef.current)

    const useUrgent = dueAlerts.some((item) => item.soundStyle === 'urgent' || item.isOverdue)
    const style = useUrgent ? 'urgent' : 'normal'
    const mode = alertSettings.notificationSoundMode
    if (mode === 'once') {
      void playReminderNotificationSound(style)
    } else {
      void startAlertReminderSound(style, mode, alertSettings.notificationSoundRepeatSeconds)
    }

    if (mode === 'once') {
      return () => stopReminderNotificationSound()
    }
    return undefined
  }, [
    visibleActiveAlerts,
    alertSettings.notificationSoundEnabled,
    alertSettings.notificationSoundMode,
    alertSettings.notificationSoundRepeatSeconds,
    soundMuted,
  ])

  const openAlert = useCallback(
    (alert: UnifiedReminderAlert) => {
      const path = buildReminderNavigationPath(alert)
      if (shouldStorePendingReminderNavigation(path, homeUnlocked)) {
        storePendingReminderNavigation(path)
      }
      navigate(path)
    },
    [navigate, homeUnlocked],
  )

  const dismissAlert = useCallback((item: UnifiedReminderAlert, event?: MouseEvent) => {
    event?.stopPropagation()
    event?.preventDefault()
    setDismissedKeys((prev) => {
      const next = new Set(prev)
      next.add(item.dismissKey)
      return next
    })
    if (activeToastRef.current?.dismissKey === item.dismissKey) {
      clearToastTimers()
      activeToastRef.current = null
      setActiveToast(null)
      toastPumpRef.current = false
      pumpToastQueueRef.current()
    }
  }, [clearToastTimers])

  const dismissAll = useCallback(
    (event?: MouseEvent) => {
      event?.stopPropagation()
      event?.preventDefault()
      setDismissedKeys((prev) => {
        const next = new Set(prev)
        for (const item of visibleActiveAlerts) next.add(item.dismissKey)
        return next
      })
    },
    [visibleActiveAlerts],
  )

  const dismissActiveToast = useCallback(() => {
    if (!activeToastRef.current) return
    clearToastTimers()
    activeToastRef.current = null
    setActiveToast(null)
    toastPumpRef.current = false
    pumpToastQueueRef.current()
  }, [clearToastTimers])

  const stopSound = useCallback(() => {
    stopReminderNotificationSound()
  }, [])

  const muteSound = useCallback(() => {
    setSoundMuted(true)
    writeSoundMuted(true)
    stopReminderNotificationSound()
  }, [])

  const unmuteSound = useCallback(() => {
    setSoundMuted(false)
    writeSoundMuted(false)
  }, [])

  const toggleSoundMuted = useCallback(() => {
    if (soundMuted) unmuteSound()
    else muteSound()
  }, [muteSound, soundMuted, unmuteSound])

  const stopAll = useCallback(
    (event?: MouseEvent) => {
      event?.stopPropagation()
      event?.preventDefault()
      clearToastTimers()
      toastQueueRef.current = []
      setToastQueueLength(0)
      activeToastRef.current = null
      setActiveToast(null)
      toastPumpRef.current = false
      stopReminderNotificationSound()
      dismissAll()
    },
    [clearToastTimers, dismissAll],
  )

  return {
    queuedReminders,
    activeAlerts,
    visibleActiveAlerts,
    incomingKeys,
    deliveredKeys,
    activeToast,
    toastQueueLength,
    soundPlaying,
    soundMuted,
    openAlert,
    dismissAlert,
    dismissAll,
    dismissActiveToast,
    stopSound,
    muteSound,
    unmuteSound,
    toggleSoundMuted,
    stopAll,
  }
}
