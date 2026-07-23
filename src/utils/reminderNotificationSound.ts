let audioContext: AudioContext | null = null
let listenersAttached = false

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  if (!audioContext) audioContext = new Ctx()
  return audioContext
}

function unlockAudioContext() {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
}

/** Call once so the first user tap can unlock audio on iOS/Safari. */
export function initReminderNotificationSound() {
  if (listenersAttached || typeof window === 'undefined') return
  listenersAttached = true
  const unlock = () => unlockAudioContext()
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock)
  window.addEventListener('touchstart', unlock, { passive: true })
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
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startTime)
  osc.stop(startTime + duration + 0.03)
}

/** Short iPhone-style tri-tone ping for reminder alerts. */
export async function playReminderNotificationSound(): Promise<void> {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      return
    }
  }

  const t = ctx.currentTime
  const vol = 0.07
  playTone(ctx, 698.46, t, 0.11, vol)
  playTone(ctx, 880, t + 0.12, 0.11, vol)
  playTone(ctx, 987.77, t + 0.24, 0.14, vol)
}
