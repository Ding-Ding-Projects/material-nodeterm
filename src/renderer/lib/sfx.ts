// Retro sound effects for the two agent edges you actually wait on: a turn FINISHING and a session
// NEEDING YOU (permission prompt / question). Synthesized with WebAudio — no audio assets, so
// there's nothing to bundle, license or keep in sync, and the tone is tunable in code.
//
// Two distinct voices on purpose (owner's call): "done" is a short rising 8-bit arpeggio (the
// pac-man pellet register), "needs you" is a crackly glitch bleep — you can tell them apart without
// looking at the screen. Both are < 300 ms and deliberately quiet.
//
// Three surfaces: this is pure renderer, so desktop AND the browser Server Edition get it for free.
// The mobile companion is a separate app with its own notification sounds, not applicable here.

import { useSettings } from '../state/settings'
import type { CustomAlertSound } from '@shared/types'

export type SfxKind = 'done' | 'needsYou'

/** Custom files are intentionally small and short: these are alert cues, not media playback. */
export const CUSTOM_SFX_MAX_BYTES = 8 * 1024 * 1024
export const CUSTOM_SFX_MAX_SECONDS = 30

/** One scheduled voice. `noise` is a filtered white-noise burst; everything else is an oscillator. */
export interface SfxVoice {
  kind: 'tone' | 'noise'
  /** Seconds from the start of the effect. */
  at: number
  /** Seconds. */
  dur: number
  /** Start frequency (Hz). For `noise`, the band-pass center. */
  freq: number
  /** Optional end frequency — the voice sweeps freq → freqTo over `dur`. */
  freqTo?: number
  /** Peak gain, relative to the master volume (0..1). */
  gain: number
  wave?: OscillatorType
}

/**
 * The score for an effect. PURE — no WebAudio, so the shape of each effect is unit-testable and
 * tweaking a sound never means booting a renderer.
 */
export function sfxScore(kind: SfxKind): SfxVoice[] {
  if (kind === 'done') {
    // Four square blips climbing a major-ish arpeggio, the last one bent upward — bright, brief,
    // unmistakably "finished".
    const notes = [784, 988, 1319, 1568]
    return notes.map((freq, i) => ({
      kind: 'tone' as const,
      at: i * 0.045,
      dur: i === notes.length - 1 ? 0.11 : 0.06,
      freq,
      ...(i === notes.length - 1 ? { freqTo: 1976 } : {}),
      gain: 0.55,
      wave: 'square' as const
    }))
  }
  // "Needs you": two crackle-and-drop pairs — a band-passed noise burst (the computer crackle)
  // over a saw tone falling in pitch, which reads as a question/alert rather than a success.
  return [
    { kind: 'noise', at: 0, dur: 0.05, freq: 1400, gain: 0.35 },
    { kind: 'tone', at: 0.01, dur: 0.1, freq: 320, freqTo: 180, gain: 0.5, wave: 'sawtooth' },
    { kind: 'noise', at: 0.14, dur: 0.05, freq: 1100, gain: 0.3 },
    { kind: 'tone', at: 0.15, dur: 0.12, freq: 300, freqTo: 150, gain: 0.45, wave: 'sawtooth' }
  ]
}

/** Master trim on top of the user's volume — these are notification chirps, not music. */
const MASTER = 0.22

let ctx: AudioContext | null = null
let noiseBuf: AudioBuffer | null = null
const customCache: Partial<Record<SfxKind, { sound: CustomAlertSound; buffer: AudioBuffer }>> = {}
const customLoads: Partial<Record<SfxKind, Promise<AudioBuffer | null>>> = {}

function audio(): AudioContext | null {
  if (ctx) return ctx
  const Ctor: typeof AudioContext | undefined =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

/**
 * Resume the audio context. Browsers (Server Edition) start it `suspended` until a user gesture;
 * Electron does not care. Safe to call repeatedly — it's a no-op once running.
 */
export function primeSfx(): void {
  const c = audio()
  if (c && c.state === 'suspended') void c.resume()
}

function noise(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf
  const len = Math.floor(c.sampleRate * 0.25)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  noiseBuf = buf
  return buf
}

function validCustomSound(value: unknown): value is CustomAlertSound {
  if (!value || typeof value !== 'object') return false
  const sound = value as Partial<CustomAlertSound>
  if (typeof sound.name !== 'string' || !sound.name.trim() || sound.name.length > 255) return false
  if (typeof sound.mime !== 'string' || sound.mime.length > 128) return false
  if (typeof sound.dataBase64 !== 'string' || sound.dataBase64.length === 0) return false
  if (sound.dataBase64.length > Math.ceil((CUSTOM_SFX_MAX_BYTES * 4) / 3) + 4) return false
  return /^[A-Za-z0-9+/]*={0,2}$/.test(sound.dataBase64)
}

function sameSound(a: CustomAlertSound, b: CustomAlertSound): boolean {
  return a.name === b.name && a.mime === b.mime && a.dataBase64 === b.dataBase64
}

function decodeBase64(dataBase64: string): ArrayBuffer | null {
  try {
    const binary = atob(dataBase64)
    if (binary.length === 0 || binary.length > CUSTOM_SFX_MAX_BYTES) return null
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
  } catch {
    return null
  }
}

async function loadCustomBuffer(kind: SfxKind, sound: CustomAlertSound): Promise<AudioBuffer | null> {
  const cached = customCache[kind]
  if (cached && sameSound(cached.sound, sound)) return cached.buffer
  const inFlight = customLoads[kind]
  if (inFlight) return inFlight
  const c = audio()
  if (!c) return null
  const run = (async (): Promise<AudioBuffer | null> => {
    const bytes = decodeBase64(sound.dataBase64)
    if (!bytes) return null
    try {
      const buffer = await c.decodeAudioData(bytes)
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > CUSTOM_SFX_MAX_SECONDS) return null
      customCache[kind] = { sound, buffer }
      return buffer
    } catch {
      return null
    }
  })()
  customLoads[kind] = run
  try {
    return await run
  } finally {
    if (customLoads[kind] === run) delete customLoads[kind]
  }
}

function playBuffer(c: AudioContext, buffer: AudioBuffer, volume: number): void {
  const vol = Math.max(0, Math.min(1, volume)) * MASTER
  if (vol <= 0) return
  const source = c.createBufferSource()
  const gain = c.createGain()
  gain.gain.value = vol
  source.buffer = buffer
  source.connect(gain).connect(c.destination)
  source.start()
}

function currentCustomSound(kind: SfxKind): CustomAlertSound | null {
  const candidate = useSettings.getState().settings.customAlertSounds?.[kind]
  return validCustomSound(candidate) ? candidate : null
}

/** Read and validate a selected local file before it is persisted in settings.json. */
export async function readCustomAlertSound(
  file: File
): Promise<{ sound: CustomAlertSound } | { error: string }> {
  if (!file || file.size <= 0) return { error: 'The selected sound file is empty.' }
  if (file.size > CUSTOM_SFX_MAX_BYTES) return { error: 'The selected sound file is larger than 8 MB.' }
  const hasAudioType = file.type.startsWith('audio/')
  const hasAudioExtension = /\.(aac|flac|m4a|mp3|oga|ogg|wav|webm)$/i.test(file.name)
  if (!hasAudioType && !hasAudioExtension) return { error: 'Choose an audio file, such as WAV, MP3, OGG, or M4A.' }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      const end = Math.min(i + chunk, bytes.length)
      binary += String.fromCharCode(...bytes.subarray(i, end))
    }
    const dataBase64 = btoa(binary)
    const sound: CustomAlertSound = { name: file.name, mime: file.type || 'audio/*', dataBase64 }
    if (!validCustomSound(sound)) return { error: 'The selected sound file could not be read safely.' }
    const c = audio()
    if (c) {
      const decoded = await loadCustomBuffer('done', sound)
      if (!decoded) return { error: 'This audio file could not be decoded or is longer than 30 seconds.' }
      delete customCache.done
    }
    return { sound }
  } catch {
    return { error: 'The selected sound file could not be read.' }
  }
}

function playBuiltInSfx(kind: SfxKind, volume: number): void {
  const c = audio()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  const vol = Math.max(0, Math.min(1, volume)) * MASTER
  if (vol <= 0) return
  const t0 = c.currentTime + 0.01
  try {
    for (const v of sfxScore(kind)) {
      const g = c.createGain()
      const peak = vol * v.gain
      g.gain.setValueAtTime(0, t0 + v.at)
      g.gain.linearRampToValueAtTime(peak, t0 + v.at + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + v.at + v.dur)
      g.connect(c.destination)
      if (v.kind === 'noise') {
        const src = c.createBufferSource()
        src.buffer = noise(c)
        const bp = c.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = v.freq
        bp.Q.value = 1.2
        src.connect(bp).connect(g)
        src.start(t0 + v.at)
        src.stop(t0 + v.at + v.dur)
      } else {
        const osc = c.createOscillator()
        osc.type = v.wave ?? 'square'
        osc.frequency.setValueAtTime(v.freq, t0 + v.at)
        if (v.freqTo) osc.frequency.exponentialRampToValueAtTime(v.freqTo, t0 + v.at + v.dur)
        osc.connect(g)
        osc.start(t0 + v.at)
        osc.stop(t0 + v.at + v.dur)
      }
    }
  } catch {
    // Losing a cue is always safer than surfacing an audio error on the alert path.
  }
}

/**
 * Play an effect. Never throws and never blocks: an unavailable/blocked audio context is simply
 * silence, and a missing or corrupt custom file falls back to the built-in cue.
 */
export function playSfx(kind: SfxKind, volume = 0.5): void {
  if (volume <= 0) return
  const custom = currentCustomSound(kind)
  if (!custom) {
    playBuiltInSfx(kind, volume)
    return
  }
  const c = audio()
  if (!c) {
    playBuiltInSfx(kind, volume)
    return
  }
  if (c.state === 'suspended') void c.resume()
  void loadCustomBuffer(kind, custom).then((buffer) => {
    if (buffer) {
      try {
        playBuffer(c, buffer, volume)
      } catch {
        playBuiltInSfx(kind, volume)
      }
    } else {
      playBuiltInSfx(kind, volume)
    }
  })
}
