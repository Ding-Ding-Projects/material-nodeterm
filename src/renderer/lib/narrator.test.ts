// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null
  lang = ''
  rate = 1
  pitch = 1
  onend: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly text: string) {}
}

function voice(
  voiceURI: string,
  lang: string,
  options: { default?: boolean; localService?: boolean } = {}
): SpeechSynthesisVoice {
  return {
    voiceURI,
    name: voiceURI,
    lang,
    default: options.default ?? false,
    localService: options.localService ?? true
  }
}

function installSynth(voices: SpeechSynthesisVoice[]): {
  synth: SpeechSynthesis & { speaking: boolean; pending: boolean }
  speak: ReturnType<typeof vi.fn>
  fireVoicesChanged: () => void
} {
  let voicesChanged: (() => void) | null = null
  const speak = vi.fn()
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: vi.fn(() => voices),
    speak,
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    addEventListener: vi.fn((event: string, cb: () => void) => {
      if (event === 'voiceschanged') voicesChanged = cb
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    onvoiceschanged: null
  } as unknown as SpeechSynthesis & { speaking: boolean; pending: boolean }
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth })
  return { synth, speak, fireVoicesChanged: () => voicesChanged?.() }
}

function request(
  patch: Partial<{
    category: string
    language: 'en' | 'yue' | 'both'
    en: string
    yue: string
    important: boolean
  }> = {}
) {
  return {
    category: patch.category ?? 'event',
    language: patch.language ?? ('en' as const),
    en: patch.en ?? 'English line',
    yue: patch.yue,
    rate: 1,
    pitch: 1,
    voiceEn: null,
    voiceYue: null,
    important: patch.important ?? true
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Narrator voices and queue', () => {
  it('admits real Cantonese tags but rejects Mandarin zh-CN/zh-TW voices', async () => {
    installSynth([
      voice('english', 'en-US'),
      voice('mandarin-cn', 'zh-CN', { default: true }),
      voice('mandarin-tw', 'zh-TW'),
      voice('cantonese-hk', 'zh-HK'),
      voice('cantonese-script-hk', 'zh-Hant-HK'),
      voice('cantonese-yue', 'yue-HK'),
      voice('cantonese-extlang', 'zh-yue-HK')
    ])
    const { pickAutomaticVoice, voicesForTrack } = await import('./narrator')
    expect(voicesForTrack('yue').map((v) => v.voiceURI)).toEqual([
      'cantonese-hk',
      'cantonese-script-hk',
      'cantonese-yue',
      'cantonese-extlang'
    ])
    expect(pickAutomaticVoice('yue')?.voiceURI).toBe('cantonese-hk')
  })

  it('refreshes a same-length inventory when the provider changes the default voice', async () => {
    const voices = [voice('one', 'en-US', { default: true }), voice('two', 'en-GB')]
    const harness = installSynth(voices)
    const { pickAutomaticVoice, subscribeVoices } = await import('./narrator')
    const unsubscribe = subscribeVoices(() => undefined)
    expect(pickAutomaticVoice('en')?.voiceURI).toBe('one')
    voices.splice(0, voices.length, voice('one', 'en-US'), voice('two', 'en-GB', { default: true }))
    harness.fireVoicesChanged()
    expect(pickAutomaticVoice('en')?.voiceURI).toBe('two')
    unsubscribe()
  })

  it('does not hand a no-voice Cantonese track to the browser default, including Preview', async () => {
    const { speak } = installSynth([voice('mandarin-default', 'zh-CN', { default: true })])
    const { narrate, previewVoice } = await import('./narrator')
    narrate(request({ language: 'yue', yue: '粵語內容' }))
    await Promise.resolve()
    previewVoice('yue', null, 1, 1)
    expect(speak).not.toHaveBeenCalled()
  })

  it('uses the platform default voice within the requested track for automatic selection', async () => {
    const { speak } = installSynth([
      voice('english-first', 'en-US'),
      voice('english-default', 'en-GB', { default: true })
    ])
    const { narrate } = await import('./narrator')
    narrate(request())
    expect((speak.mock.calls[0][0] as FakeUtterance).voice?.voiceURI).toBe('english-default')
  })

  it('continues to the next queued track when speechSynthesis.speak throws synchronously', async () => {
    const { speak } = installSynth([voice('english', 'en-US'), voice('cantonese', 'zh-HK')])
    speak.mockImplementationOnce(() => {
      throw new Error('provider rejected utterance synchronously')
    })
    const { narrate } = await import('./narrator')
    narrate(request({ language: 'both', yue: '第二句' }))
    await Promise.resolve()
    expect(speak).toHaveBeenCalledTimes(2)
    expect((speak.mock.calls[1][0] as FakeUtterance).text).toBe('第二句')
  })

  it('preserves distinct important errors queued behind a busy shared speech channel', async () => {
    const { synth, speak } = installSynth([voice('english', 'en-US')])
    synth.speaking = true
    const { narrate } = await import('./narrator')
    narrate(request({ category: 'app-error', en: 'First failure' }))
    narrate(request({ category: 'app-error', en: 'Second failure' }))

    synth.speaking = false
    await vi.advanceTimersByTimeAsync(250)
    expect((speak.mock.calls[0][0] as FakeUtterance).text).toBe('First failure')
    ;(speak.mock.calls[0][0] as FakeUtterance).onend?.()
    expect(speak).toHaveBeenCalledTimes(2)
    expect((speak.mock.calls[1][0] as FakeUtterance).text).toBe('Second failure')
  })
})
