// site/app/features/narrator.js
//
// A spoken narrator built on window.speechSynthesis. OFF by default.
// Language choice is English / Cantonese / Both, where Both speaks English
// then Cantonese STRICTLY SERIALIZED (never overlapping). ONE voice picker
// PER LANGUAGE — never a shared picker, because choosing an English voice
// says nothing about which Cantonese voice should read the other half of a
// bilingual line.
//
// THE LATE-LIST TRAP: speechSynthesis.getVoices() commonly returns [] on
// the very first call and fills in a moment later behind the
// 'voiceschanged' event. A picker that reads the list once will report "no
// voices installed" on a machine that has forty of them. Every picker here
// subscribes to that event, re-reads, and unsubscribes on teardown — see
// `watchVoices()` below and docs/site-features.md, which calls this out by
// name as the trap every other narrator-picker implementation on this site
// must not reintroduce.

import { h, injectStyleOnce } from '../shared/dom.js'
import { asMountable } from '../shared/mountable.js'
import { guardPanel } from '../shared/lockGate.js'
import { t, subscribeI18n } from '../shared/i18n.js'
import { recordHistoryEntry } from '../shared/history-state.js'
import {
  isEnabled,
  setEnabled,
  getLanguage,
  setLanguage,
  getVoiceUri,
  setVoiceUri,
  getRate,
  setRate,
  getPitch,
  setPitch,
  subscribeNarratorState,
} from '../shared/narrator-state.js'

injectStyleOnce(
  'site-narrator-style',
  `
  .site-narrator { display: flex; flex-direction: column; gap: 16px; }
  .site-narrator__row { display: flex; flex-direction: column; gap: 6px; }
  .site-narrator__toggle-row { display: flex; align-items: center; gap: 10px; min-height: var(--touch-target, 44px); }
  .site-narrator__voice-picker { display: flex; flex-direction: column; gap: 6px; }
  .site-narrator__voice-picker select {
    height: var(--touch-target, 44px); border-radius: var(--md-shape-sm, 8px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container-low, #f5f1f8);
    color: var(--md-on-surface, #1c1b1f); padding: 0 8px; font: inherit;
  }
  .site-narrator__status { font-size: 12px; opacity: 0.85; }
  .site-narrator__status--warn { color: var(--md-error, #ba1a1a); opacity: 1; }
  .site-narrator__sliders { display: flex; gap: 20px; flex-wrap: wrap; }
  .site-narrator__slider { display: flex; flex-direction: column; gap: 4px; min-width: 160px; }
  .site-narrator__btn {
    min-height: var(--touch-target, 44px); padding: 0 14px; border-radius: var(--md-shape-full, 999px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container, #efeaf2);
    color: var(--md-on-surface, #1c1b1f); cursor: pointer; font: inherit; align-self: flex-start;
  }
  `,
)

const supportsSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window

/** Subscribes to the browser's voice list, calling cb(voices) immediately
 * with whatever is currently known AND again every time 'voiceschanged'
 * fires. Returns an unsubscribe function. */
function watchVoices(cb) {
  if (!supportsSpeech) {
    cb([])
    return () => {}
  }
  const synth = window.speechSynthesis
  const fire = () => cb(synth.getVoices() || [])
  fire()
  synth.addEventListener('voiceschanged', fire)
  return () => synth.removeEventListener('voiceschanged', fire)
}

function isEnglishVoice(v) {
  return /^en/i.test(v.lang || '')
}
function isCantoneseVoice(v) {
  return /^(yue|zh-hant-hk|zh-hk)/i.test((v.lang || '').replace(/_/g, '-'))
}
function isAnyChineseVoice(v) {
  return /^zh/i.test(v.lang || '')
}

// --- A strictly-serialized speech queue --------------------------------
const queue = []
let speaking = false

function pump() {
  if (speaking || queue.length === 0) return
  const next = queue.shift()
  speaking = true
  try {
    window.speechSynthesis.speak(next)
    next.addEventListener('end', () => {
      speaking = false
      pump()
    })
    next.addEventListener('error', () => {
      speaking = false
      pump()
    })
  } catch (_err) {
    speaking = false
    pump()
  }
}

function buildUtterance(text, lang) {
  const u = new window.SpeechSynthesisUtterance(text)
  u.rate = getRate()
  u.pitch = getPitch()
  const uri = getVoiceUri(lang)
  if (uri) {
    const voices = window.speechSynthesis.getVoices() || []
    const match = voices.find((v) => v.voiceURI === uri)
    if (match) u.voice = match
    // If not found, the choice is KEPT (never reset) and we fall back to
    // the browser's default for this utterance's lang.
  }
  u.lang = lang === 'yue' ? 'yue' : 'en'
  return u
}

function speakSerialized(text, lang) {
  if (!supportsSpeech || !text) return
  queue.push(buildUtterance(text, lang))
  pump()
}

export function narrate(enTexOrPair) {
  if (!isEnabled() || !supportsSpeech) return
  const lang = getLanguage()
  const pair = typeof enTexOrPair === 'string' ? { en: enTexOrPair, yue: enTexOrPair } : enTexOrPair
  if (lang === 'en') speakSerialized(pair.en, 'en')
  else if (lang === 'yue') speakSerialized(pair.yue, 'yue')
  else {
    // Both — English then Cantonese, strictly serialized by the shared
    // queue (never spoken concurrently).
    speakSerialized(pair.en, 'en')
    speakSerialized(pair.yue, 'yue')
  }
}

function buildVoicePicker(lang, filterFn) {
  const select = h('select', { 'aria-label': `Narrator voice for ${lang === 'yue' ? 'Cantonese' : 'English'}` })
  const status = h('div', { class: 'site-narrator__status' })
  let currentVoices = []

  function render() {
    const chosen = getVoiceUri(lang)
    select.textContent = ''
    select.appendChild(h('option', { value: '' }, t('narrator.voice.auto')))
    const matches = currentVoices.filter(filterFn)
    const list = matches.length > 0 ? matches : lang === 'yue' ? currentVoices.filter(isAnyChineseVoice) : []
    for (const v of list) {
      select.appendChild(h('option', { value: v.voiceURI, selected: v.voiceURI === chosen }, `${v.name} (${v.lang})`))
    }
    if (list.length === 0) {
      select.disabled = true
      status.textContent = t('narrator.no.voices')
      status.className = 'site-narrator__status site-narrator__status--warn'
      return
    }
    select.disabled = false
    if (chosen && !list.some((v) => v.voiceURI === chosen)) {
      status.textContent = t('narrator.voice.missing')
      status.className = 'site-narrator__status site-narrator__status--warn'
    } else {
      status.textContent = chosen ? 'Using the selected voice.' : 'Using the browser’s default voice for this language.'
      status.className = 'site-narrator__status'
    }
  }

  const stop = watchVoices((voices) => {
    currentVoices = voices
    render()
  })

  select.addEventListener('change', () => setVoiceUri(lang, select.value))

  const wrap = h('div', { class: 'site-narrator__voice-picker' }, [
    h('label', {}, lang === 'yue' ? 'Cantonese voice' : 'English voice'),
    select,
    status,
  ])
  wrap.__stop = stop
  return wrap
}

function buildPanel() {
  const wrap = h('div', { class: 'site-narrator' })

  function rebuild() {
    wrap.textContent = ''
    wrap.appendChild(h('h3', {}, t('narrator.section.title')))

    if (!supportsSpeech) {
      wrap.appendChild(h('p', {}, 'This browser does not support speech synthesis.'))
      return
    }

    const enabled = isEnabled()
    const toggle = h('input', {
      type: 'checkbox',
      id: 'site-narrator-enabled',
      checked: enabled,
      onChange: (e) => {
        setEnabled(e.target.checked)
        recordHistoryEntry(`Narrator turned ${e.target.checked ? 'on' : 'off'}.`)
      },
    })
    wrap.appendChild(
      h('div', { class: 'site-narrator__toggle-row' }, [toggle, h('label', { for: 'site-narrator-enabled' }, 'Enable narrator')]),
    )

    if (!enabled) {
      wrap.appendChild(h('p', { class: 'site-narrator__status' }, t('narrator.off')))
      return
    }

    const langRow = h('div', { class: 'site-narrator__row' })
    langRow.appendChild(h('span', {}, 'Narrated language'))
    const radios = h('div', {}, [])
    const currentLang = getLanguage()
    ;[
      ['en', 'English'],
      ['yue', 'Cantonese'],
      ['both', 'Both (English, then Cantonese)'],
    ].forEach(([value, label]) => {
      const id = 'site-narrator-lang-' + value
      const radio = h('input', {
        type: 'radio',
        name: 'site-narrator-lang',
        id,
        checked: currentLang === value,
        onChange: () => setLanguage(value),
      })
      radios.appendChild(h('label', { for: id, style: { marginRight: '12px' } }, [radio, ' ' + label]))
    })
    langRow.appendChild(radios)
    wrap.appendChild(langRow)

    const enPicker = buildVoicePicker('en', isEnglishVoice)
    const yuePicker = buildVoicePicker('yue', isCantoneseVoice)
    wrap.appendChild(enPicker)
    wrap.appendChild(yuePicker)

    const sliders = h('div', { class: 'site-narrator__sliders' })
    const rateVal = h('span', {}, String(getRate()))
    const rateSlider = h('input', {
      type: 'range',
      min: '0.5',
      max: '2',
      step: '0.1',
      value: String(getRate()),
      'aria-label': 'Narrator speaking rate',
      onInput: (e) => {
        setRate(e.target.value)
        rateVal.textContent = e.target.value
      },
    })
    const pitchVal = h('span', {}, String(getPitch()))
    const pitchSlider = h('input', {
      type: 'range',
      min: '0',
      max: '2',
      step: '0.1',
      value: String(getPitch()),
      'aria-label': 'Narrator pitch',
      onInput: (e) => {
        setPitch(e.target.value)
        pitchVal.textContent = e.target.value
      },
    })
    sliders.appendChild(h('div', { class: 'site-narrator__slider' }, [h('label', {}, 'Rate'), rateSlider, rateVal]))
    sliders.appendChild(h('div', { class: 'site-narrator__slider' }, [h('label', {}, 'Pitch'), pitchSlider, pitchVal]))
    wrap.appendChild(sliders)

    wrap.appendChild(
      h(
        'button',
        {
          type: 'button',
          class: 'site-narrator__btn',
          onClick: () =>
            narrate({
              en: 'This is nodeterm’s narrator, speaking a short test line.',
              yue: '呢個係 nodeterm 嘅讀稿員，講緊一句簡短嘅測試句子。',
            }),
        },
        'Test narrate',
      ),
    )
  }

  rebuild()
  subscribeNarratorState(rebuild)
  subscribeI18n(rebuild)
  return wrap
}

export function registerNarrator(api) {
  // Wired as a real lockable surface (features/locks.js can lock this
  // panel behind its own independent password).
  const guarded = guardPanel('narrator', 'Narrator panel', buildPanel)

  if (typeof api.registerTab === 'function') {
    api.registerTab({ id: 'narrator', title: 'Narrator', icon: '🔊', group: 'settings', render: asMountable(guarded) })
  }
  if (typeof api.registerSetting === 'function') {
    api.registerSetting({
      id: 'narrator-enabled',
      tabId: 'narrator',
      title: 'Narrator (spoken, off by default)',
      describe: () => 'English, Cantonese, or both, strictly serialized. One voice picker per language.',
      control: asMountable(guarded),
    })
  }
  if (typeof api.registerCommand === 'function') {
    api.registerCommand({
      id: 'narrator-test',
      title: 'Narrator: speak a test line',
      run: () => narrate({ en: 'Test line.', yue: '測試句子。' }),
    })
  }
}
