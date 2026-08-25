import type { NotificationSoundMode } from '../types'

export type ReminderSoundStyle = 'normal' | 'urgent'

let audioContext: AudioContext | null = null
let htmlAudioByStyle = new Map<ReminderSoundStyle, HTMLAudioElement>()
let listenersAttached = false
let audioUnlocked = false

type SoundSession = {
  mode: NotificationSoundMode
  stopRequested: boolean
  timerId: ReturnType<typeof setTimeout> | null
  intervalId: ReturnType<typeof setInterval> | null
}

let activeSession: SoundSession | null = null
let soundPlayingListeners = new Set<() => void>()

function notifySoundPlayingChanged() {
  for (const listener of soundPlayingListeners) listener()
}

export function subscribeReminderSoundPlaying(listener: () => void): () => void {
  soundPlayingListeners.add(listener)
  return () => soundPlayingListeners.delete(listener)
}

export function isReminderSoundPlaying(): boolean {
  return activeSession != null && !activeSession.stopRequested
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctx =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  if (!audioContext) audioContext = new Ctx()
  return audioContext
}

function encodeWav(samples: Float32Array, sampleRate: number): string {
  const numChannels = 1
  const bitsPerSample = 16
  const blockAlign = (numChannels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }

  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return `data:audio/wav;base64,${btoa(binary)}`
}

function synthesizeToneBuffer(
  tones: { freq: number; start: number; len: number; volume?: number }[],
  totalDuration: number,
): Float32Array {
  const sampleRate = 44100
  const numSamples = Math.floor(sampleRate * totalDuration)
  const buffer = new Float32Array(numSamples)

  for (const tone of tones) {
    const startSample = Math.floor(tone.start * sampleRate)
    const endSample = Math.min(numSamples, startSample + Math.floor(tone.len * sampleRate))
    const vol = tone.volume ?? 0.35
    for (let i = startSample; i < endSample; i += 1) {
      const t = (i - startSample) / sampleRate
      const attack = Math.min(1, t / 0.012)
      const release = Math.max(0.0001, 1 - t / tone.len)
      buffer[i] += Math.sin((2 * Math.PI * tone.freq * t)) * attack * release * vol
    }
  }

  return buffer
}

function buildWavDataUri(style: ReminderSoundStyle): string {
  const tones =
    style === 'urgent'
      ? [
          { freq: 523.25, start: 0, len: 0.16, volume: 0.42 },
          { freq: 659.25, start: 0.18, len: 0.16, volume: 0.42 },
          { freq: 783.99, start: 0.36, len: 0.18, volume: 0.45 },
          { freq: 987.77, start: 0.58, len: 0.2, volume: 0.48 },
          { freq: 1174.66, start: 0.82, len: 0.24, volume: 0.5 },
        ]
      : [
          { freq: 698.46, start: 0, len: 0.11, volume: 0.35 },
          { freq: 880, start: 0.12, len: 0.11, volume: 0.35 },
          { freq: 987.77, start: 0.24, len: 0.14, volume: 0.35 },
        ]
  const totalDuration = style === 'urgent' ? 1.15 : 0.45
  return encodeWav(synthesizeToneBuffer(tones, totalDuration), 44100)
}

function soundDurationMs(style: ReminderSoundStyle): number {
  return style === 'urgent' ? 1200 : 550
}

function getHtmlAudio(style: ReminderSoundStyle): HTMLAudioElement {
  const cached = htmlAudioByStyle.get(style)
  if (cached) return cached
  const audio = new Audio(buildWavDataUri(style))
  audio.preload = 'auto'
  htmlAudioByStyle.set(style, audio)
  return audio
}

async function unlockAudioContext(): Promise<boolean> {
  const ctx = getAudioContext()
  if (!ctx) return false
  if (ctx.state === 'running') {
    audioUnlocked = true
    return true
  }
  try {
    await ctx.resume()
  } catch {
    // fall through to HTML audio unlock
  }
  if ((ctx.state as string) === 'running') {
    audioUnlocked = true
    return true
  }

  try {
    const audio = getHtmlAudio('normal')
    audio.volume = 0.01
    audio.currentTime = 0
    await audio.play()
    audio.pause()
    audio.currentTime = 0
    audioUnlocked = true
    return true
  } catch {
    return false
  }
}

/** Call once so the first user tap can unlock audio on iOS/Safari. */
export function initReminderNotificationSound() {
  if (listenersAttached || typeof window === 'undefined') return
  listenersAttached = true
  const unlock = () => {
    void unlockAudioContext()
  }
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true })
  document.addEventListener('touchstart', unlock, { capture: true, passive: true })
  document.addEventListener('keydown', unlock, { capture: true })
  document.addEventListener('click', unlock, { capture: true, passive: true })
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  volume: number,
) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(frequency, startTime)
  gain.gain.setValueAtTime(0.0001, startTime)
  gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0001), startTime + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.03)
}

async function playViaWebAudio(style: ReminderSoundStyle): Promise<boolean> {
  const ctx = getAudioContext()
  if (!ctx) return false
  const unlocked = audioUnlocked || (await unlockAudioContext())
  if (!unlocked || (ctx.state as string) !== 'running') return false

  const t = ctx.currentTime
  if (style === 'urgent') {
    const vol = 0.28
    playTone(ctx, 523.25, t, 0.16, vol)
    playTone(ctx, 659.25, t + 0.18, 0.16, vol)
    playTone(ctx, 783.99, t + 0.36, 0.18, vol + 0.03)
    playTone(ctx, 987.77, t + 0.58, 0.2, vol + 0.06)
    playTone(ctx, 1174.66, t + 0.82, 0.24, vol + 0.08)
  } else {
    const vol = 0.22
    playTone(ctx, 698.46, t, 0.11, vol)
    playTone(ctx, 880, t + 0.12, 0.11, vol)
    playTone(ctx, 987.77, t + 0.24, 0.14, vol)
  }
  return true
}

async function playViaHtmlAudio(style: ReminderSoundStyle): Promise<boolean> {
  try {
    const audio = getHtmlAudio(style)
    audio.volume = 1
    audio.currentTime = 0
    await audio.play()
    return true
  } catch {
    return false
  }
}

/** Short notification ping — normal (3 tones) or urgent (5 longer tones). */
export async function playReminderNotificationSound(style: ReminderSoundStyle = 'normal'): Promise<void> {
  if (await playViaWebAudio(style)) return
  await playViaHtmlAudio(style)
}

export function stopReminderNotificationSound() {
  if (!activeSession) return
  activeSession.stopRequested = true
  if (activeSession.timerId != null) clearTimeout(activeSession.timerId)
  if (activeSession.intervalId != null) clearInterval(activeSession.intervalId)
  activeSession = null
  notifySoundPlayingChanged()
}

async function startReminderSoundSession(
  style: ReminderSoundStyle,
  mode: NotificationSoundMode,
  repeatSeconds: number,
): Promise<void> {
  stopReminderNotificationSound()

  if (mode === 'once') {
    await playReminderNotificationSound(style)
    return
  }

  const session: SoundSession = {
    mode,
    stopRequested: false,
    timerId: null,
    intervalId: null,
  }
  activeSession = session
  notifySoundPlayingChanged()

  const playOnce = async () => {
    if (session.stopRequested) return
    await playReminderNotificationSound(style)
  }

  await playOnce()

  if (session.stopRequested) {
    activeSession = null
    notifySoundPlayingChanged()
    return
  }

  if (mode === 'continuous') {
    const gapMs = soundDurationMs(style) + 200
    const scheduleNext = () => {
      if (session.stopRequested) {
        activeSession = null
        notifySoundPlayingChanged()
        return
      }
      session.timerId = setTimeout(async () => {
        await playOnce()
        scheduleNext()
      }, gapMs)
    }
    scheduleNext()
    return
  }

  if (mode === 'interval') {
    session.intervalId = setInterval(() => {
      if (session.stopRequested) {
        stopReminderNotificationSound()
        return
      }
      void playOnce()
    }, Math.max(5, repeatSeconds) * 1000)
  }
}

/** Play from a button tap — always unlocks audio first. Supports once, interval, or continuous. */
export async function testReminderNotificationSound(
  style: ReminderSoundStyle = 'normal',
  mode: NotificationSoundMode = 'once',
  repeatSeconds = 30,
): Promise<void> {
  await unlockAudioContext()
  await startReminderSoundSession(style, mode, repeatSeconds)
}

/** Start alert sound session based on saved settings (used by ReminderAlertsNotifier). */
export async function startAlertReminderSound(
  style: ReminderSoundStyle,
  mode: NotificationSoundMode,
  repeatSeconds: number,
): Promise<void> {
  await unlockAudioContext()
  await startReminderSoundSession(style, mode, repeatSeconds)
}
