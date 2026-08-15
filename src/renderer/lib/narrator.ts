// Spoken TTS narrator for app events. Full contract, failure modes and the voice-picker rules
// this file exists to satisfy are documented in docs/narrator.md — read that first if you're
// changing behaviour here, not just the code.
//
// Uses the Web Speech API (`speechSynthesis`), which is available in BOTH the Electron renderer
// and the browser Server Edition — so this module is pure renderer code with no IPC, no main
// process, no server process involved. The mobile companion (nodeterm-ios, a separate app with
// its own notification sounds) is out of scope.
//
// Deliberately module-level state (not a zustand store): the queue/cooldown/debounce state is
// process-global exactly like `sfx.ts`'s AudioContext singleton, and every consumer just calls
// the exported functions — there is nothing here a component needs to subscribe to as React
// state except the voice LIST, which `subscribeVoices` hands out as a plain callback.

import type { NarratorLanguage } from '@shared/types'

export type { NarratorLanguage }

/** The two tracks the narrator can speak. 'yue' = Cantonese. */
export type NarratorTrack = 'en' | 'yue'

const LANG_PREFIX: Record<NarratorTrack, string> = { en: 'en', yue: 'zh' }
/** Preferred `lang` tags when picking a Cantonese voice automatically — Hong Kong Cantonese
 *  specifically, never just "any Chinese voice": most `zh-*` voices on a stock OS are Mandarin
 *  (zh-CN/zh-TW), and reading Cantonese narration copy in a Mandarin voice reads every character
 *  with the wrong tones — worse than falling back to English. */
const YUE_PREFERRED_LANGS = ['zh-hk', 'zh-yue', 'yue', 'yue-hk']

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null
}

export function isSynthesisAvailable(): boolean {
  return synth() !== null
}

// ---------------------------------------------------------------------------------------------
// Voice enumeration — THE LATE-ARRIVAL TRAP.
//
// `speechSynthesis.getVoices()` commonly returns an EMPTY array on the very first call and fills
// in a moment later, signalled by the `voiceschanged` event — sometimes more than once, as
// different voice providers register. A caller that reads it once and stops looking reports "no
// voices installed" on a machine with forty. We keep one shared, lazily-bound listener plus a
// short poll fallback (some Chromium builds are known to never fire `voiceschanged` at all when
// the list was ready synchronously), and every UI subscriber gets the live list, not a snapshot.
// ---------------------------------------------------------------------------------------------

let voiceCache: SpeechSynthesisVoice[] = []
const voiceListeners = new Set<() => void>()
let bound = false
let pollTimer: ReturnType<typeof setInterval> | null = null

function notifyVoiceListeners(): void {
  for (const cb of voiceListeners) {
    try {
      cb()
    } catch {
      // A subscriber's own error must never break enumeration for the others.
    }
  }
}

function refreshVoiceCache(): void {
  const s = synth()
  if (!s) return
  const next = s.getVoices()
  // Voice objects are stable per engine call in every browser/Electron build we've seen; a length
  // compare is enough to detect "the list changed" without a per-voice deep-equal on a timer.
  if (next.length === voiceCache.length && next.length > 0) return
  voiceCache = next
  notifyVoiceListeners()
}

function ensureVoiceWatcherBound(): void {
  const s = synth()
  if (!s || bound) return
  bound = true
  s.addEventListener('voiceschanged', refreshVoiceCache)
  refreshVoiceCache()
  if (voiceCache.length > 0) return
  // Fallback poll: stops the moment we have a non-empty list, or after 8s regardless (a machine
  // with genuinely zero TTS voices installed should not poll forever).
  pollTimer = setInterval(() => {
    refreshVoiceCache()
    if (voiceCache.length > 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }, 500)
  setTimeout(() => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }, 8000)
}

/**
 * Subscribe to the live platform voice list. Calls `cb` once immediately (possibly with an empty
 * list, if the platform hasn't answered yet) and again every time the list changes, including the
 * late fill-in. Returns an unsubscribe — callers MUST call it on teardown, or the component keeps
 * re-rendering after it's gone.
 */
export function subscribeVoices(cb: (voices: SpeechSynthesisVoice[]) => void): () => void {
  ensureVoiceWatcherBound()
  const wrapped = (): void => cb(voiceCache)
  voiceListeners.add(wrapped)
  wrapped()
  return () => {
    voiceListeners.delete(wrapped)
  }
}

/** Current cached voice list, synchronously — for one-off reads (e.g. inside `narrate()`). May be
 *  empty if nothing has subscribed yet or the platform hasn't answered; prefer `subscribeVoices`
 *  in UI. */
export function currentVoices(): SpeechSynthesisVoice[] {
  ensureVoiceWatcherBound()
  return voiceCache
}

/** Voices whose `lang` matches the narrated track ('en' or 'yue', where 'yue' means any `zh-*`
 *  voice — narrowed further by `pickAutomaticVoice` when picking automatically). */
export function voicesForTrack(track: NarratorTrack): SpeechSynthesisVoice[] {
  const prefix = LANG_PREFIX[track]
  return currentVoices().filter((v) => v.lang.toLowerCase().startsWith(prefix))
}

/** Best-guess voice when the user has chosen "Choose automatically" — the shipped default for
 *  both tracks. Cantonese specifically prefers a `zh-HK`/`zh-yue` voice over a same-prefix
 *  Mandarin one; English takes the platform's own default English voice, else the first. */
export function pickAutomaticVoice(track: NarratorTrack): SpeechSynthesisVoice | null {
  const pool = voicesForTrack(track)
  if (pool.length === 0) return null
  if (track === 'yue') {
    const hk = pool.find((v) =>
      YUE_PREFERRED_LANGS.some((p) => {
        const lang = v.lang.toLowerCase()
        return lang === p || lang.startsWith(`${p}-`)
      })
    )
    if (hk) return hk
  }
  return pool.find((v) => v.default) ?? pool[0]
}

/** Resolve a saved `voiceURI` (or `null` = automatic) to a live voice for `track`. A saved
 *  voiceURI that is no longer installed on this machine falls back to automatic WITHOUT clearing
 *  the saved setting — see `voiceStatus` below and docs/narrator.md "kept, not reset". */
export function resolveVoice(voiceURI: string | null, track: NarratorTrack): SpeechSynthesisVoice | null {
  if (voiceURI) {
    const match = currentVoices().find((v) => v.voiceURI === voiceURI)
    if (match) return match
  }
  return pickAutomaticVoice(track)
}

export interface NarratorVoiceStatus {
  /** The voice that will actually speak for this track, or null if none is available at all. */
  voice: SpeechSynthesisVoice | null
  /** The user chose a specific voice (not "automatic") that is not installed on THIS machine, so
   *  we fell back to automatic — the choice itself stays saved, unchanged. */
  missingChosen: boolean
  /** The resolved voice is not a local OS voice (`localService === false`) — it needs a network
   *  connection and will go silent offline. */
  networkOnly: boolean
  /** No voice at all is available for this track on this machine. */
  noVoiceForTrack: boolean
}

/** What is ACTUALLY in effect for `track` right now, beneath the picker — the honest-status
 *  contract from docs/narrator.md. */
export function voiceStatus(voiceURI: string | null, track: NarratorTrack): NarratorVoiceStatus {
  const resolved = resolveVoice(voiceURI, track)
  const chosenInstalled = voiceURI ? currentVoices().some((v) => v.voiceURI === voiceURI) : true
  return {
    voice: resolved,
    missingChosen: Boolean(voiceURI) && !chosenInstalled,
    networkOnly: resolved ? !resolved.localService : false,
    noVoiceForTrack: resolved === null
  }
}

// ---------------------------------------------------------------------------------------------
// Queue: one utterance at a time, ever — REPLACE a superseded queued line for the same category
// rather than stacking it, debounce rapid repeats, and cool down how often one category can
// actually speak.
// ---------------------------------------------------------------------------------------------

function clampRate(r: number): number {
  return Math.min(10, Math.max(0.1, Number.isFinite(r) ? r : 1))
}
function clampPitch(p: number): number {
  return Math.min(2, Math.max(0, Number.isFinite(p) ? p : 1))
}

interface QueueEntry {
  category: string
  track: NarratorTrack
  text: string
  rate: number
  pitch: number
  voiceURI: string | null
}

export interface NarrateRequest {
  /** Groups related narrations for cooldown/debounce/replace purposes — e.g. `agent-done:<nodeId>`
   *  so two different nodes finishing never suppress each other, while the SAME node flapping
   *  through several state changes debounces down to one line. */
  category: string
  /** Which language(s) to speak, from settings. */
  language: NarratorLanguage
  /** English text. Always required — it's also the fallback when Cantonese narration is
   *  requested for dynamic content with no translation (see `yue` below). */
  en: string
  /** Cantonese text. Omit for genuinely dynamic runtime content that has no hand-authored
   *  translation (e.g. a free-text error message) — every BUILT-IN category
   *  (turn-finished/needs-input) always supplies both. When 'yue' or 'both' is requested and this
   *  is missing: 'yue' falls back to speaking the English line rather than staying silent (losing
   *  the information is worse than the language mismatch); 'both' just skips the missing half
   *  instead of saying the English line twice. */
  yue?: string
  rate: number
  pitch: number
  voiceEn: string | null
  voiceYue: string | null
  /** Minimum ms between two narrations of this category actually starting to speak. */
  cooldownMs?: number
  /** If another narrate() for this category arrives within this window, only the latest survives. */
  debounceMs?: number
  /** Error/failure narration: content must never be dropped by the rate limiter (the rate limiter
   *  exists to keep routine chatter infrequent, not to swallow a failure the user needs to hear
   *  about). Skips debounce + cooldown; still goes through the serialized queue like everything
   *  else, so it never talks over another utterance. */
  important?: boolean
}

let queue: QueueEntry[] = []
let speaking = false
// Bumped every time we deliberately interrupt whatever's currently speaking (stopNarrator /
// previewVoice) or start a new utterance. An in-flight utterance's onend/onerror captures the
// generation it was started under; if that no longer matches by the time the callback fires, the
// callback is for an utterance we've since cancelled/superseded and must NOT touch `speaking` or
// re-enter pump() — without this guard, cancelling utterance A to immediately start preview
// utterance B races: A's async 'canceled' error can still land after B starts speaking, which
// would incorrectly flip `speaking` back to false mid-preview and let a queued narration jump in
// on top of it (the exact "never overlapping" invariant this whole module exists to keep).
let gen = 0
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const lastSpokenAt = new Map<string, number>()

const DEFAULT_DEBOUNCE_MS = 600
const DEFAULT_COOLDOWN_MS = 8000

/** Which (track, text) pairs to actually speak for one narrate() call — pure, so the fallback
 *  rules above are unit-testable without a synthesis engine. */
export function planUtterances(
  req: Pick<NarrateRequest, 'language' | 'en' | 'yue'>
): { track: NarratorTrack; text: string }[] {
  const out: { track: NarratorTrack; text: string }[] = []
  if (req.language === 'en') {
    out.push({ track: 'en', text: req.en })
  } else if (req.language === 'yue') {
    out.push(req.yue ? { track: 'yue', text: req.yue } : { track: 'en', text: req.en })
  } else {
    out.push({ track: 'en', text: req.en })
    if (req.yue) out.push({ track: 'yue', text: req.yue })
  }
  return out.filter((e) => e.text.trim() !== '')
}

function removeQueued(category: string): void {
  if (queue.some((e) => e.category === category)) queue = queue.filter((e) => e.category !== category)
}

function doEnqueue(
  category: string,
  utterances: { track: NarratorTrack; text: string }[],
  req: NarrateRequest
): void {
  for (const u of utterances) {
    queue.push({
      category,
      track: u.track,
      text: u.text,
      rate: req.rate,
      pitch: req.pitch,
      voiceURI: u.track === 'en' ? req.voiceEn : req.voiceYue
    })
  }
  pump()
}

/** Queue (or replace-in-queue) a narration. Never throws — a narration failure must never break
 *  the caller (agent-status handling, error toasts, ...). */
export function narrate(req: NarrateRequest): void {
  try {
    if (!isSynthesisAvailable()) return
    const utterances = planUtterances(req)
    if (utterances.length === 0) return

    const existingTimer = debounceTimers.get(req.category)
    if (existingTimer) clearTimeout(existingTimer)
    removeQueued(req.category)

    if (req.important) {
      debounceTimers.delete(req.category)
      lastSpokenAt.set(req.category, Date.now())
      doEnqueue(req.category, utterances, req)
      return
    }

    const debounceMs = req.debounceMs ?? DEFAULT_DEBOUNCE_MS
    const cooldownMs = req.cooldownMs ?? DEFAULT_COOLDOWN_MS
    const timer = setTimeout(() => {
      debounceTimers.delete(req.category)
      const now = Date.now()
      const last = lastSpokenAt.get(req.category) ?? 0
      if (now - last < cooldownMs) return // still cooling down for this category — drop it
      lastSpokenAt.set(req.category, now)
      doEnqueue(req.category, utterances, req)
    }, debounceMs)
    debounceTimers.set(req.category, timer)
  } catch {
    // Never let a bad narration request break the caller.
  }
}

function pump(): void {
  if (speaking) return
  const s = synth()
  if (!s) {
    queue = []
    return
  }
  const next = queue.shift()
  if (!next) return
  // Yield to anything already speaking through the SHARED speechSynthesis engine — this is the
  // one real signal a web page has for "something else wants this channel" (see docs/narrator.md
  // for the honest limits: it does NOT detect a native OS screen reader, which speaks outside the
  // browser entirely; it does catch another page feature, or a browser-extension reader, using
  // the same API). Re-check shortly rather than forcing our line in ahead of it.
  if (s.speaking || s.pending) {
    queue.unshift(next)
    setTimeout(pump, 250)
    return
  }
  speaking = true
  const myGen = ++gen
  const voice = resolveVoice(next.voiceURI, next.track)
  const utter = new SpeechSynthesisUtterance(next.text)
  utter.rate = clampRate(next.rate)
  utter.pitch = clampPitch(next.pitch)
  if (voice) utter.voice = voice
  utter.lang = voice?.lang ?? (next.track === 'yue' ? 'zh-HK' : 'en-US')
  const done = (): void => {
    if (myGen !== gen) return // superseded (stopNarrator/previewVoice) — not our turn to react
    speaking = false
    pump()
  }
  utter.onend = done
  utter.onerror = done
  try {
    s.speak(utter)
  } catch {
    speaking = false
  }
}

/** Stop everything: clears the queue, every pending debounce timer, and cancels any in-flight
 *  utterance. Called when the user turns the narrator off (and internally before a preview, so
 *  a preview always starts from silence). */
export function stopNarrator(): void {
  queue = []
  for (const t of debounceTimers.values()) clearTimeout(t)
  debounceTimers.clear()
  gen++ // invalidate whatever onend/onerror is about to land for the utterance we're cancelling
  const s = synth()
  if (s) {
    try {
      s.cancel()
    } catch {
      // Nothing to do.
    }
  }
  speaking = false
}

const PREVIEW_TEXT: Record<NarratorTrack, string> = {
  en: 'This is how the narrator sounds.',
  yue: '呢個係旁述員把聲。'
}

/**
 * Speak a short sample immediately with the given voice/rate/pitch, bypassing the queue/cooldown
 * — used by the settings picker's "Preview" button. Interrupts whatever the narrator was
 * currently saying (an explicit user action testing a voice takes priority over queued chatter).
 */
export function previewVoice(
  track: NarratorTrack,
  voiceURI: string | null,
  rate: number,
  pitch: number
): void {
  const s = synth()
  if (!s) return
  stopNarrator()
  const voice = resolveVoice(voiceURI, track)
  const utter = new SpeechSynthesisUtterance(PREVIEW_TEXT[track])
  utter.rate = clampRate(rate)
  utter.pitch = clampPitch(pitch)
  if (voice) utter.voice = voice
  utter.lang = voice?.lang ?? (track === 'yue' ? 'zh-HK' : 'en-US')
  speaking = true
  const myGen = ++gen
  const done = (): void => {
    if (myGen !== gen) return
    speaking = false
  }
  utter.onend = done
  utter.onerror = done
  try {
    s.speak(utter)
  } catch {
    speaking = false
  }
}
