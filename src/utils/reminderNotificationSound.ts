let audioContext: AudioContext | null = null
let htmlAudio: HTMLAudioElement | null = null
let listenersAttached = false
let audioUnlocked = false

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

function buildTriToneWavDataUri(): string {
  const sampleRate = 44100
  const tones = [
    { freq: 698.46, start: 0, len: 0.11 },
    { freq: 880, start: 0.12, len: 0.11 },
    { freq: 987.77, start: 0.24, len: 0.14 },
  ]
  const totalDuration = 0.45
  const numSamples = Math.floor(sampleRate * totalDuration)
  const buffer = new Float32Array(numSamples)

  for (const tone of tones) {
    const startSample = Math.floor(tone.start * sampleRate)
    const endSample = Math.min(numSamples, startSample + Math.floor(tone.len * sampleRate))
    for (let i = startSample; i < endSample; i += 1) {
      const t = (i - startSample) / sampleRate
      const attack = Math.min(1, t / 0.012)
      const release = Math.max(0.0001, 1 - t / tone.len)
      buffer[i] += Math.sin((2 * Math.PI * tone.freq * t)) * attack * release * 0.35
    }
  }

  return encodeWav(buffer, sampleRate)
}

function getHtmlAudio(): HTMLAudioElement {
  if (!htmlAudio) {
    htmlAudio = new Audio(buildTriToneWavDataUri())
    htmlAudio.preload = 'auto'
  }
  return htmlAudio
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
    const audio = getHtmlAudio()
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

async function playViaWebAudio(): Promise<boolean> {
  const ctx = getAudioContext()
  if (!ctx) return false
  const unlocked = audioUnlocked || (await unlockAudioContext())
  if (!unlocked || (ctx.state as string) !== 'running') return false

  const t = ctx.currentTime
  const vol = 0.22
  playTone(ctx, 698.46, t, 0.11, vol)
  playTone(ctx, 880, t + 0.12, 0.11, vol)
  playTone(ctx, 987.77, t + 0.24, 0.14, vol)
  return true
}

async function playViaHtmlAudio(): Promise<boolean> {
  try {
    const audio = getHtmlAudio()
    audio.volume = 1
    audio.currentTime = 0
    await audio.play()
    return true
  } catch {
    return false
  }
}

/** Short tri-tone ping for reminder alerts. */
export async function playReminderNotificationSound(): Promise<void> {
  if (await playViaWebAudio()) return
  await playViaHtmlAudio()
}

/** Play from a button tap — always unlocks audio first. */
export async function testReminderNotificationSound(): Promise<void> {
  await unlockAudioContext()
  await playReminderNotificationSound()
}
