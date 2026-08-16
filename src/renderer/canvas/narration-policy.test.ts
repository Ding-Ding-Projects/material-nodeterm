// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NarrateRequest } from '@renderer/lib/narrator'
import {
  narrate,
  planUtterances,
  stopNarrator,
  suppressNarratorTrack
} from '@renderer/lib/narrator'
import {
  bindCanvasNarrationToSchoolMode,
  decideCanvasNarration,
  executeAgentStatusNarration,
  executeAppErrorNarration,
  executeNarratorPreview,
  type CanvasNarratorSettings
} from './narration-policy'

const SETTINGS: CanvasNarratorSettings = {
  narratorEnabled: true,
  narratorLanguage: 'both',
  narratorRate: 1.25,
  narratorPitch: 0.8,
  narratorVoiceEn: 'english-voice',
  narratorVoiceYue: 'cantonese-voice'
}

const UNKNOWN = { hydrated: false, enabled: false }
const ENABLED = { hydrated: true, enabled: true }
const DISABLED = { hydrated: true, enabled: false }

class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null
  lang = ''
  rate = 1
  pitch = 1
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly text: string) {}
}

let synthSpeak: ReturnType<typeof vi.fn>
let synthCancel: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  synthSpeak = vi.fn()
  synthCancel = vi.fn()
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speaking: false,
      pending: false,
      getVoices: () => [
        { voiceURI: 'english-voice', name: 'English', lang: 'en-US', default: true, localService: true },
        { voiceURI: 'cantonese-voice', name: 'Cantonese', lang: 'zh-HK', default: false, localService: true }
      ],
      speak: synthSpeak,
      cancel: synthCancel,
      addEventListener: vi.fn()
    }
  })
  stopNarrator()
  synthCancel.mockClear()
})

afterEach(() => {
  stopNarrator()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function spokenRequest(speak: ReturnType<typeof vi.fn>): NarrateRequest {
  expect(speak).toHaveBeenCalledTimes(1)
  return speak.mock.calls[0][0] as NarrateRequest
}

describe('Canvas narrator School Mode decision', () => {
  it('permits configured language only after a real OFF record has hydrated', () => {
    expect(decideCanvasNarration(SETTINGS, UNKNOWN)).toMatchObject({
      language: 'en', cantoneseAllowed: false, voiceYue: null
    })
    expect(decideCanvasNarration(SETTINGS, { hydrated: false, enabled: true })).toMatchObject({
      language: 'en', cantoneseAllowed: false, voiceYue: null
    })
    expect(decideCanvasNarration(SETTINGS, ENABLED)).toMatchObject({
      language: 'en', cantoneseAllowed: false, voiceYue: null
    })
    expect(decideCanvasNarration(SETTINGS, DISABLED)).toMatchObject({
      language: 'both', cantoneseAllowed: true, voiceYue: 'cantonese-voice'
    })
  })

  it('fails a hand-edited invalid narrator language closed to English', () => {
    expect(decideCanvasNarration({ ...SETTINGS, narratorLanguage: 'unexpected' }, DISABLED).language)
      .toBe('en')
  })

  it('keeps English but drops Cantonese when an OFF-policy request crosses a live ON transition', async () => {
    const listeners: Array<(state: typeof DISABLED, previous: typeof DISABLED) => void> = []
    let schoolMode = DISABLED
    const unsubscribe = bindCanvasNarrationToSchoolMode((next) => {
      listeners.push(next)
      return vi.fn()
    }, () => suppressNarratorTrack('yue'))

    executeAgentStatusNarration(SETTINGS, () => schoolMode, {
      sound: 'done', nodeId: 'queued', agentLabel: 'Agent', context: 'project'
    }, narrate)
    expect(synthSpeak).not.toHaveBeenCalled()

    expect(listeners).toHaveLength(1)
    schoolMode = ENABLED
    listeners[0](ENABLED, DISABLED)
    await vi.advanceTimersByTimeAsync(1000)
    expect(synthSpeak).toHaveBeenCalledTimes(1)
    expect((synthSpeak.mock.calls[0][0] as FakeUtterance).text).toBe('Agent finished in project.')
    ;(synthSpeak.mock.calls[0][0] as FakeUtterance).onend?.()
    await Promise.resolve()
    expect(synthSpeak).toHaveBeenCalledTimes(1)
    expect(synthCancel).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('degrades a queued Cantonese-only event to English across a live ON transition', async () => {
    const listeners: Array<(state: typeof DISABLED, previous: typeof DISABLED) => void> = []
    let schoolMode = DISABLED
    bindCanvasNarrationToSchoolMode((next) => {
      listeners.push(next)
      return vi.fn()
    }, () => suppressNarratorTrack('yue'))

    executeAgentStatusNarration({ ...SETTINGS, narratorLanguage: 'yue' }, () => schoolMode, {
      sound: 'needsYou', nodeId: 'queued-yue', agentLabel: 'Agent', context: 'project'
    }, narrate)
    expect(synthSpeak).not.toHaveBeenCalled()

    schoolMode = ENABLED
    listeners[0](ENABLED, DISABLED)
    await vi.advanceTimersByTimeAsync(1000)
    expect(synthSpeak).toHaveBeenCalledTimes(1)
    expect((synthSpeak.mock.calls[0][0] as FakeUtterance).text).toBe('Agent needs you in project.')
    expect(synthCancel).not.toHaveBeenCalled()
  })

  it('keeps the Cantonese-only English fallback dormant while School Mode stays off', async () => {
    executeAgentStatusNarration({ ...SETTINGS, narratorLanguage: 'yue' }, () => DISABLED, {
      sound: 'done', nodeId: 'yue-only', agentLabel: 'Agent', context: 'project'
    }, narrate)

    await vi.advanceTimersByTimeAsync(1000)
    expect(synthSpeak).toHaveBeenCalledTimes(1)
    expect((synthSpeak.mock.calls[0][0] as FakeUtterance).text).toContain('做完')
    ;(synthSpeak.mock.calls[0][0] as FakeUtterance).onend?.()
    await Promise.resolve()
    expect(synthSpeak).toHaveBeenCalledTimes(1)
  })

  it('selectively cancels an active Cantonese track on a live ON transition', async () => {
    const listeners: Array<(state: typeof DISABLED, previous: typeof DISABLED) => void> = []
    let schoolMode = DISABLED
    bindCanvasNarrationToSchoolMode((next) => {
      listeners.push(next)
      return vi.fn()
    }, () => suppressNarratorTrack('yue'))
    executeAgentStatusNarration(SETTINGS, () => schoolMode, {
      sound: 'done', nodeId: 'active', agentLabel: 'Agent', context: 'project'
    }, narrate)

    await vi.advanceTimersByTimeAsync(1000)
    expect(synthSpeak).toHaveBeenCalledTimes(1)
    ;(synthSpeak.mock.calls[0][0] as FakeUtterance).onend?.()
    expect(synthSpeak).toHaveBeenCalledTimes(2)
    expect((synthSpeak.mock.calls[1][0] as FakeUtterance).text).toContain('做完')

    schoolMode = ENABLED
    listeners[0](ENABLED, DISABLED)
    expect(synthCancel).toHaveBeenCalledTimes(1)
  })
})

describe('Narrator Preview School Mode execution', () => {
  it('re-checks a captured Cantonese Preview when the shared mode changes before its click runs', () => {
    let schoolMode = DISABLED
    const preview = vi.fn()
    const capturedClick = () => executeNarratorPreview('yue', () => schoolMode, preview)

    schoolMode = ENABLED
    expect(capturedClick()).toBe(false)
    expect(preview).not.toHaveBeenCalled()
  })

  it('keeps English Preview available under the reduced policy', () => {
    const preview = vi.fn()
    expect(executeNarratorPreview('en', () => ENABLED, preview)).toBe(true)
    expect(preview).toHaveBeenCalledTimes(1)
  })
})

describe('Canvas app-error narration execution', () => {
  it.each([UNKNOWN, ENABLED])('speaks only English while School Mode is unknown or enabled', (state) => {
    const speak = vi.fn()
    expect(executeAppErrorNarration(SETTINGS, () => state, 'Something broke.', speak)).toBe(true)
    const request = spokenRequest(speak)
    expect(request).toMatchObject({
      category: 'app-error',
      language: 'en',
      en: 'Something broke.',
      voiceYue: null,
      important: true
    })
    expect(planUtterances(request)).toEqual([{ track: 'en', text: 'Something broke.' }])
  })

  it('preserves the confirmed-OFF request fields and content fallback', () => {
    const speak = vi.fn()
    executeAppErrorNarration(SETTINGS, () => DISABLED, 'Something broke.', speak)
    const request = spokenRequest(speak)
    expect(request).toMatchObject({
      category: 'app-error',
      language: 'both',
      en: 'Something broke.',
      rate: 1.25,
      pitch: 0.8,
      voiceEn: 'english-voice',
      voiceYue: 'cantonese-voice',
      important: true
    })
    expect(planUtterances(request)).toEqual([{ track: 'en', text: 'Something broke.' }])
  })

  it('does nothing when narration is disabled', () => {
    const speak = vi.fn()
    expect(executeAppErrorNarration({ ...SETTINGS, narratorEnabled: false }, () => DISABLED, 'Error', speak))
      .toBe(false)
    expect(speak).not.toHaveBeenCalled()
  })

  it('fails malformed runtime settings and event details closed', () => {
    const speak = vi.fn()
    const invalidEnabled = { ...SETTINGS, narratorEnabled: 'yes' as unknown as boolean }
    expect(executeAppErrorNarration(invalidEnabled, () => DISABLED, 'Error', speak)).toBe(false)
    expect(executeAppErrorNarration(SETTINGS, () => DISABLED, { message: 'Error' }, speak)).toBe(false)
    expect(speak).not.toHaveBeenCalled()
  })
})

describe('Canvas agent-status narration execution', () => {
  const input = { sound: 'done' as const, nodeId: 'node-1', agentLabel: 'Agent', context: 'project' }

  it.each([UNKNOWN, ENABLED])('removes the Cantonese track while School Mode is unknown or enabled', (state) => {
    const speak = vi.fn()
    expect(executeAgentStatusNarration(SETTINGS, () => state, input, speak)).toBe(true)
    const request = spokenRequest(speak)
    expect(request).toMatchObject({
      category: 'agent-done:node-1',
      language: 'en',
      en: 'Agent finished in project.',
      voiceYue: null
    })
    expect(request).not.toHaveProperty('yue')
    expect(planUtterances(request)).toEqual([{ track: 'en', text: 'Agent finished in project.' }])
  })

  it('restores the persisted bilingual request only after School Mode is confirmed off', () => {
    const speak = vi.fn()
    executeAgentStatusNarration(SETTINGS, () => DISABLED, input, speak)
    const request = spokenRequest(speak)
    expect(request).toMatchObject({
      language: 'both',
      yue: 'project 嗰個 Agent 做完喇。',
      rate: 1.25,
      pitch: 0.8,
      voiceEn: 'english-voice',
      voiceYue: 'cantonese-voice'
    })
    expect(planUtterances(request)).toEqual([
      { track: 'en', text: 'Agent finished in project.' },
      { track: 'yue', text: 'project 嗰個 Agent 做完喇。' }
    ])
  })

  it('uses the needs-you phrase on that execution branch', () => {
    const speak = vi.fn()
    executeAgentStatusNarration({ ...SETTINGS, narratorLanguage: 'en' }, () => DISABLED, {
      ...input,
      sound: 'needsYou'
    }, speak)
    const request = spokenRequest(speak)
    expect(request).toMatchObject({
      category: 'agent-needsYou:node-1',
      language: 'en',
      en: 'Agent needs you in project.'
    })
  })

  it('does nothing when narration is disabled', () => {
    const speak = vi.fn()
    expect(executeAgentStatusNarration({ ...SETTINGS, narratorEnabled: false }, () => DISABLED, input, speak))
      .toBe(false)
    expect(speak).not.toHaveBeenCalled()
  })
})
